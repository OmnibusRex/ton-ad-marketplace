import { toNano } from "@ton/core";
import pkg from "grammy";
import type { Context, SessionFlavor } from "grammy";
import { MarketplaceError } from "./domain/errors.js";
import { Marketplace } from "./domain/marketplace.js";
import { findPaymentForComment } from "./adapters/toncenter-payments.js";
import type { PostgresStore } from "./adapters/postgres-store.js";

const { Bot, session, InlineKeyboard } = pkg;

export type SessionData = {
  step: "IDLE" | "AWAITING_CHANNEL_NAME" | "AWAITING_PRICE" | "AWAITING_AD_TEXT";
  tempChannelName?: string;
  tempTitle?: string;
  tempChatId?: string;
  tempMemberCount?: number;
  activeOrderId?: string;
};

type MyContext = Context & SessionFlavor<SessionData>;

type TelegramApi = {
  getChat(handle: string): Promise<{
    id: number | string;
    type: string;
    title?: string;
    username?: string;
  }>;
  getMe(): Promise<{ id: number }>;
  getChatMember(
    handle: string,
    userId: number,
  ): Promise<{ status: string }>;
  getChatMemberCount(handle: string): Promise<number>;
};

export type BotRuntimeOptions = {
  token: string;
  marketplace: Marketplace;
  users?: Pick<PostgresStore, "upsertUser">;
  escrowWalletAddress: string;
  toncenterApiUrl: string;
  toncenterApiKey?: string;
};

function errorText(error: unknown): string {
  if (error instanceof MarketplaceError) {
    return error.message;
  }
  return "Something went wrong. Please try again.";
}

async function verifyChannelAdmin(
  api: TelegramApi,
  handle: string,
): Promise<{
  handle: string;
  title: string;
  telegramChatId: string;
  memberCount: number;
  botIsAdmin: boolean;
}> {
  const chat = await api.getChat(handle);
  if (chat.type !== "channel" || !("username" in chat) || !chat.username) {
    throw new MarketplaceError("INVALID_HANDLE", "Only public Telegram channels can be listed.");
  }
  const me = await api.getMe();
  let botIsAdmin = false;
  try {
    const member = await api.getChatMember(handle, me.id);
    botIsAdmin = member.status === "administrator" || member.status === "creator";
  } catch {
    botIsAdmin = false;
  }
  const memberCount = await api.getChatMemberCount(handle);
  return {
    handle: `@${chat.username}`,
    title: chat.title ?? `@${chat.username}`,
    telegramChatId: String(chat.id),
    memberCount,
    botIsAdmin,
  };
}

export function createBot(options: BotRuntimeOptions) {
  const bot = new Bot<MyContext>(options.token);
  bot.use(session({ initial: (): SessionData => ({ step: "IDLE" }) }));

  bot.command("start", async (ctx) => {
    if (ctx.from && options.users) {
      await options.users.upsertUser(String(ctx.from.id), ctx.from.username);
    }
    await ctx.reply(
      `Welcome to TrustLayer Global! 🚀\n\n` +
        `The first verified ad marketplace on TON.\n\n` +
        `/explore - Find verified channels\n` +
        `/register_channel - List your channel`,
    );
  });

  bot.command("explore", async (ctx) => {
    const channels = await options.marketplace.listChannels();
    if (channels.length === 0) {
      await ctx.reply("No channels found. Be the first to /register_channel!");
      return;
    }

    for (const channel of channels.slice(0, 5)) {
      const keyboard = new InlineKeyboard()
        .url("View Channel", `https://t.me/${channel.handle.replace("@", "")}`)
        .text("💎 Buy Ad", `buy_${channel.id}`);

      await ctx.reply(
        `📺 **${channel.title}**\n` +
          `👥 Verified Members: ${channel.memberCount}\n` +
          `💰 Price: ${channel.priceTon} TON`,
        { reply_markup: keyboard, parse_mode: "Markdown" },
      );
    }
  });

  bot.callbackQuery(/^buy_(.+)$/, async (ctx) => {
    try {
      const channelId = ctx.match[1];
      const order = await options.marketplace.createOrder({
        channelId,
        advertiserId: String(ctx.from.id),
      });
      ctx.session.activeOrderId = order.id;
      ctx.session.step = "IDLE";

      const paymentLink = `https://app.tonkeeper.com/transfer/${options.escrowWalletAddress}?amount=${toNano(
        order.amountTon,
      )}&text=${encodeURIComponent(order.paymentComment)}`;
      const keyboard = new InlineKeyboard()
        .url("Pay with Wallet", paymentLink)
        .row()
        .text("✅ I have paid", `confirm_${order.id}`);

      await ctx.reply(
        `🛡️ **Secure Escrow Payment**\n\n` +
          `Order: \`${order.id}\`\n` +
          `Amount: **${order.amountTon} TON**\n` +
          `Comment: \`${order.paymentComment}\`\n\n` +
          `Click below to pay. Funds stay locked to this order until the ad is published or the order is refunded.`,
        { reply_markup: keyboard, parse_mode: "Markdown" },
      );
    } catch (error) {
      await ctx.reply(`❌ ${errorText(error)}`);
    } finally {
      await ctx.answerCallbackQuery();
    }
  });

  bot.callbackQuery(/^confirm_(.+)$/, async (ctx) => {
    const orderId = ctx.match[1];
    await ctx.answerCallbackQuery("Verifying on the blockchain...");
    try {
      const order = await options.marketplace.getOrder(orderId);
      const observed = await findPaymentForComment(
        {
          walletAddress: options.escrowWalletAddress,
          apiUrl: options.toncenterApiUrl,
          apiKey: options.toncenterApiKey,
        },
        order.paymentComment,
        order.amountTon,
      );
      if (!observed) {
        await ctx.reply(
          "❌ Payment not detected yet. Please wait 1-2 minutes or check if you used the correct payment comment.",
        );
        return;
      }

      const locked = await options.marketplace.matchPayment({
        paymentComment: observed.comment,
        amountTon: observed.amountTon,
        txHash: observed.txHash,
      });
      ctx.session.activeOrderId = locked.id;
      ctx.session.step = "AWAITING_AD_TEXT";
      const receiptKeyboard = new InlineKeyboard().url(
        "View Transaction",
        `https://testnet.tonviewer.com/transaction/${observed.txHash}`,
      );
      await ctx.reply(
        "✅ **Payment Verified!**\n\nYour deposit was found and locked to this order. Please send the **text/link** for your advertisement below:",
        { reply_markup: receiptKeyboard, parse_mode: "Markdown" },
      );
    } catch (error) {
      await ctx.reply(`❌ ${errorText(error)}`);
    }
  });

  bot.command("register_channel", async (ctx) => {
    ctx.session.step = "AWAITING_CHANNEL_NAME";
    await ctx.reply("📍 Step 1: Send your public channel handle (e.g., @mychannel).");
  });

  bot.on("message:text", async (ctx) => {
    const step = ctx.session.step;
    if (step === "AWAITING_CHANNEL_NAME") {
      try {
        const verified = await verifyChannelAdmin(ctx.api, ctx.msg.text.trim());
        if (!verified.botIsAdmin) {
          await ctx.reply("❌ Verification failed. Ensure the bot is an ADMIN in the channel.");
          return;
        }
        ctx.session.tempChannelName = verified.handle;
        ctx.session.tempTitle = verified.title;
        ctx.session.tempChatId = verified.telegramChatId;
        ctx.session.tempMemberCount = verified.memberCount;
        ctx.session.step = "AWAITING_PRICE";
        await ctx.reply(
          `✅ Verified: ${verified.title}\n👥 Members: ${verified.memberCount}\n\n📍 Step 2: Set your price in TON:`,
        );
      } catch {
        await ctx.reply("❌ Verification failed. Ensure the bot is an ADMIN in the channel.");
      }
      return;
    }

    if (step === "AWAITING_PRICE") {
      try {
        await options.marketplace.registerChannel({
          handle: ctx.session.tempChannelName!,
          title: ctx.session.tempTitle ?? ctx.session.tempChannelName!,
          ownerId: String(ctx.from!.id),
          telegramChatId: ctx.session.tempChatId!,
          memberCount: ctx.session.tempMemberCount!,
          priceTon: ctx.msg.text.replace(",", ".").trim(),
          botIsAdmin: true,
        });
        ctx.session.step = "IDLE";
        await ctx.reply("🎉 Channel listed successfully! Try /explore.");
      } catch (error) {
        await ctx.reply(`❌ ${errorText(error)}`);
      }
      return;
    }

    if (step === "AWAITING_AD_TEXT") {
      const orderId = ctx.session.activeOrderId;
      if (!orderId) {
        ctx.session.step = "IDLE";
        await ctx.reply("❌ No active order. Use /explore to buy a slot.");
        return;
      }
      try {
        await options.marketplace.submitAdCopy({
          orderId,
          advertiserId: String(ctx.from!.id),
          text: ctx.msg.text,
        });
        const published = await options.marketplace.publish(orderId, {
          publish: async (telegramChatId, text) => {
            try {
              await ctx.api.sendMessage(telegramChatId, text);
              return { ok: true };
            } catch (error) {
              return { ok: false, error: error instanceof Error ? error.message : String(error) };
            }
          },
        });
        if (published.status === "released") {
          ctx.session.step = "IDLE";
          await ctx.reply("🚀 **AD PUBLISHED!** Your campaign is now live on the target channel.");
          return;
        }
        if (published.status === "refunded") {
          ctx.session.step = "IDLE";
          await ctx.reply("❌ This order timed out. Funds were not released to the channel owner and are marked for refund.");
          return;
        }
        await ctx.reply(
          "❌ Error publishing ad. The bot might have been removed from the channel. Funds were not released to the owner. Send the ad text again, or wait for the automatic refund path.",
        );
      } catch (error) {
        await ctx.reply(`❌ ${errorText(error)}`);
      }
    }
  });

  return bot;
}
