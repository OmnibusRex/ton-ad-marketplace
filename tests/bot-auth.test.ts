import { describe, expect, it } from "vitest";
import { escapeMarkdown, verifyChannelAdmin, type TelegramChannelApi } from "../src/telegram/channel-guard.js";

function api(memberStatus: (userId: number) => string): TelegramChannelApi {
  return {
    async getChat() {
      return { id: -100, type: "channel", title: "News *Desk*", username: "NewsDesk" };
    },
    async getMe() {
      return { id: 1 };
    },
    async getChatMember(_handle, userId) {
      return { status: memberStatus(userId) };
    },
    async getChatMemberCount() {
      return 10;
    },
  };
}

describe("channel listing auth", () => {
  it("requires the listing user to be a channel admin and escapes titles", async () => {
    const verified = await verifyChannelAdmin(
      api((userId) => (userId === 42 || userId === 1 ? "administrator" : "member")),
      "@NewsDesk",
      42,
    );
    expect(verified).toMatchObject({
      handle: "@NewsDesk",
      botIsAdmin: true,
      memberCount: 10,
    });
    await expect(
      verifyChannelAdmin(
        api((userId) => (userId === 1 ? "administrator" : "member")),
        "@NewsDesk",
        99,
      ),
    ).rejects.toMatchObject({ code: "NOT_CHANNEL_ADMIN" });
    expect(escapeMarkdown(verified.title)).toBe("News \\*Desk\\*");
  });

  it("rejects a private chat and a missing bot admin is reported without listing", async () => {
    const privateApi: TelegramChannelApi = {
      ...api(() => "creator"),
      async getChat() {
        return { id: 5, type: "private", title: "dm" };
      },
    };
    await expect(verifyChannelAdmin(privateApi, "@missing", 7)).rejects.toMatchObject({ code: "INVALID_HANDLE" });

    const noBot = await verifyChannelAdmin(
      api((userId) => (userId === 7 ? "creator" : "member")),
      "@NewsDesk",
      7,
    );
    expect(noBot.botIsAdmin).toBe(false);
  });
});
