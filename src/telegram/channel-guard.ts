import { MarketplaceError } from "../domain/errors.js";

const ADMIN_STATUSES = new Set(["creator", "administrator"]);

export type TelegramChannelApi = {
  getChat(handle: string): Promise<{
    id: number | string;
    type: string;
    title?: string;
    username?: string;
  }>;
  getMe(): Promise<{ id: number }>;
  getChatMember(handle: string, userId: number): Promise<{ status: string }>;
  getChatMemberCount(handle: string): Promise<number>;
};

export type VerifiedChannel = {
  handle: string;
  title: string;
  telegramChatId: string;
  memberCount: number;
  botIsAdmin: boolean;
};

export function escapeMarkdown(text: string): string {
  return text.replace(/[*_`\[]/g, "\\$&");
}

/**
 * The listing user must be a channel creator or administrator, and the chat
 * must be a public channel. The bot's own admin flag is returned separately.
 */
export async function verifyChannelAdmin(
  api: TelegramChannelApi,
  handle: string,
  listingUserId: number,
): Promise<VerifiedChannel> {
  const trimmed = handle.trim();
  const chat = await api.getChat(trimmed);
  if (chat.type !== "channel" || !chat.username) {
    throw new MarketplaceError("INVALID_HANDLE", "Only public Telegram channels can be listed.");
  }

  let listerStatus = "left";
  try {
    listerStatus = (await api.getChatMember(trimmed, listingUserId)).status;
  } catch {
    listerStatus = "left";
  }
  if (!ADMIN_STATUSES.has(listerStatus)) {
    throw new MarketplaceError(
      "NOT_CHANNEL_ADMIN",
      "Only a channel creator or administrator can list this channel.",
    );
  }

  const me = await api.getMe();
  let botIsAdmin = false;
  try {
    const member = await api.getChatMember(trimmed, me.id);
    botIsAdmin = ADMIN_STATUSES.has(member.status);
  } catch {
    botIsAdmin = false;
  }

  const memberCount = await api.getChatMemberCount(trimmed);
  return {
    handle: `@${chat.username}`,
    title: chat.title ?? `@${chat.username}`,
    telegramChatId: String(chat.id),
    memberCount,
    botIsAdmin,
  };
}
