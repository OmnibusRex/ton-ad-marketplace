import pg from 'pg';
const { Client } = pg;
import * as dotenv from 'dotenv';
import pkg from 'grammy';
const { Bot, Context, session, InlineKeyboard } = pkg;
import type { SessionFlavor } from 'grammy';
import { toNano } from '@ton/core';
import axios from 'axios';

dotenv.config();

// YOUR VERIFIED TESTNET WALLET
const MASTER_WALLET = "UQCbTW0NWPyE28ltt2GvN5nS0XwVYyf4johavHU2fZQqhRfD"; 

interface SessionData {
  step: 'IDLE' | 'AWAITING_CHANNEL_NAME' | 'AWAITING_PRICE' | 'AWAITING_AD_TEXT';
  tempChannelName?: string;
  tempChatId?: number | string;
  tempMemberCount?: number;
  activePurchaseId?: string;
  activePurchasePrice?: string;
}
type MyContext = Context & SessionFlavor<SessionData>;

const client = new Client({ connectionString: process.env.DATABASE_URL });
const bot = new Bot<MyContext>(process.env.TELEGRAM_BOT_TOKEN || '');

bot.use(session({ initial: (): SessionData => ({ step: 'IDLE' }) }));

/**
 * Verified On-chain Watcher
 * Checks Toncenter API for specific AdID comments and amounts
 */
async function verifyTonPayment(amountTon: string, adId: string) {
  const url = `https://testnet.toncenter.com/api/v2/getTransactions?address=${MASTER_WALLET}&limit=10`;
  try {
    const response = await axios.get(url);
    const txs = response.data.result;
    for (const tx of txs) {
      const msg = tx.in_msg.message;
      const value = tx.in_msg.value;
      const hash = tx.transaction_id.hash;
      
      if (msg === `AdID_${adId}` && parseFloat(value) >= Number(toNano(amountTon))) {
        return hash; 
      }
    }
  } catch (e) { console.error("Blockchain verification error:", e); }
  return null;
}

async function startProject() {
  try {
    await client.connect();
    console.log("✅ TrustLayer Backend: Operational on TON Testnet");

    // Welcome Message
    bot.command("start", async (ctx) => {
      const { id, username } = ctx.from!;
      await client.query(`INSERT INTO users (id, username) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET username = $2`, [id, username]);
      ctx.reply(
        `Welcome to TrustLayer Global! 🚀\n\n` +
        `The first verified ad marketplace on TON.\n\n` +
        `/explore - Find verified channels\n` +
        `/register_channel - List your channel`
      );
    });

    // Marketplace Explorer
    bot.command("explore", async (ctx) => {
      const res = await client.query(`SELECT id, title, subscriber_count, price_per_post_ton FROM channels ORDER BY subscriber_count DESC LIMIT 5`);
      if (res.rows.length === 0) return ctx.reply("No channels found. Be the first to /register_channel!");
      
      for (const channel of res.rows) {
        const keyboard = new InlineKeyboard()
          .url("View Channel", `https://t.me/${channel.title.replace('@', '')}`)
          .text("💎 Buy Ad", `buy_${channel.id}_${channel.price_per_post_ton}`);
        
        ctx.reply(
          `📺 **${channel.title}**\n` +
          `👥 Verified Members: ${channel.subscriber_count}\n` +
          `💰 Price: ${channel.price_per_post_ton} TON`, 
          { reply_markup: keyboard, parse_mode: "Markdown" }
        );
      }
    });

    // Escrow Payment Initialization
    bot.callbackQuery(/^buy_(\d+)_([\d.]+)$/, async (ctx) => {
      const channelId = ctx.match[1];
      const price = ctx.match[2];
      ctx.session.activePurchaseId = channelId;
      ctx.session.activePurchasePrice = price;
      
      const paymentLink = `https://app.tonkeeper.com/transfer/${MASTER_WALLET}?amount=${toNano(price)}&text=AdID_${channelId}`;
      const keyboard = new InlineKeyboard()
        .url("Pay with Wallet", paymentLink)
        .row()
        .text("✅ I have paid", "confirm_payment");
      
      await ctx.reply(
        `🛡️ **Secure Escrow Payment**\n\n` +
        `Target Channel: #${channelId}\n` +
        `Amount: **${price} TON**\n` +
        `Comment: \`AdID_${channelId}\`\n\n` +
        `Click below to pay. Our bot verifies the transaction on the blockchain.`, 
        { reply_markup: keyboard, parse_mode: "Markdown" }
      );
    });

    // Transaction Confirmation
    bot.callbackQuery("confirm_payment", async (ctx) => {
      await ctx.answerCallbackQuery("Verifying on the blockchain...");
      const txHash = await verifyTonPayment(ctx.session.activePurchasePrice!, ctx.session.activePurchaseId!);
      
      if (txHash) {
        ctx.session.step = 'AWAITING_AD_TEXT';
        const receiptKeyboard = new InlineKeyboard().url("View Transaction", `https://testnet.tonviewer.com/transaction/${txHash}`);
        ctx.reply("✅ **Payment Verified!**\n\nYour deposit was found. Please send the **text/link** for your advertisement below:", { reply_markup: receiptKeyboard });
      } else {
        ctx.reply("❌ Payment not detected yet. Please wait 1-2 minutes or check if you used the correct AdID comment.");
      }
    });

    // Seller Registration
    bot.command("register_channel", (ctx) => {
      ctx.session.step = 'AWAITING_CHANNEL_NAME';
      ctx.reply("📍 Step 1: Send your public channel handle (e.g., @mychannel).");
    });

    // Input Handling Logic
    bot.on("message:text", async (ctx) => {
      const step = ctx.session.step;
      if (step === 'AWAITING_CHANNEL_NAME') {
        try {
          const handle = ctx.msg.text.trim();
          const chat = await ctx.api.getChat(handle);
          const members = await ctx.api.getChatMemberCount(handle);
          ctx.session.tempChannelName = handle;
          ctx.session.tempChatId = chat.id;
          ctx.session.tempMemberCount = members;
          ctx.session.step = 'AWAITING_PRICE';
          ctx.reply(`✅ Verified: ${chat.title}\n👥 Members: ${members}\n\n📍 Step 2: Set your price in TON:`);
        } catch (e) { ctx.reply("❌ Verification failed. Ensure the bot is an ADMIN in the channel."); }
      } 
      else if (step === 'AWAITING_PRICE') {
        const price = parseFloat(ctx.msg.text.replace(',', '.'));
        if (isNaN(price)) return ctx.reply("❌ Please send a valid number.");
        await client.query(`INSERT INTO channels (title, owner_id, price_per_post_ton, telegram_id, subscriber_count) VALUES ($1, $2, $3, $4, $5)`,
          [ctx.session.tempChannelName, ctx.from!.id, price, ctx.session.tempChatId, ctx.session.tempMemberCount]);
        ctx.session.step = 'IDLE';
        ctx.reply("🎉 Channel listed successfully! Try /explore.");
      }
      else if (step === 'AWAITING_AD_TEXT') {
        const adText = ctx.msg.text;
        try {
            const res = await client.query(`SELECT telegram_id FROM channels WHERE id = $1`, [ctx.session.activePurchaseId]);
            await ctx.api.sendMessage(res.rows[0].telegram_id, adText);
            ctx.session.step = 'IDLE';
            ctx.reply("🚀 **AD PUBLISHED!** Your campaign is now live on the target channel.");
        } catch (e) { ctx.reply("❌ Error publishing ad. The bot might have been removed from the channel."); }
      }
    });

    console.log("🤖 TrustLayer v1.2 Global & On-chain is Online!");
    bot.start();
  } catch (err) { console.error("Critical Start Error:", err); }
}

startProject();