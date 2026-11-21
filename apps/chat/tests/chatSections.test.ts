import { describe, expect, it } from "vitest";
import { blankChat } from "../src/chat/chats";
import { DEFAULT_SETTINGS } from "../src/settings";
import type { Chat, Folder, VideoAttachment } from "../src/types";
import { groupChats, matchesSearch, sectionChats } from "../src/ui/chatSections";

const NOW = new Date(2026, 10, 19, 15, 0).getTime();
const DAY = 24 * 60 * 60 * 1000;

const BEACH: VideoAttachment = {
  name: "beach-trip.mp4",
  fileKey: "beach",
  durationSeconds: 60,
  width: 640,
  height: 360,
};

const TRIPS: Folder = { id: "trips", name: "Trips", createdAt: 1 };
const COOKING: Folder = { id: "cooking", name: "Cooking", createdAt: 2 };

function chatAt(id: string, updatedAt: number, extra: Partial<Chat> = {}): Chat {
  return { ...blankChat(DEFAULT_SETTINGS.defaultModelId, id, updatedAt), ...extra };
}

describe("grouping chats by date", () => {
  it("puts chats under Today, Yesterday, the previous 7 and 30 days, and Older", () => {
    const chats = [
      chatAt("today", NOW - 60 * 60 * 1000),
      chatAt("yesterday", NOW - DAY),
      chatAt("week", NOW - 5 * DAY),
      chatAt("month", NOW - 20 * DAY),
      chatAt("older", NOW - 90 * DAY),
    ];
    expect(
      groupChats(chats, NOW).map((group) => [group.label, group.chats.map((chat) => chat.id)]),
    ).toEqual([
      ["Today", ["today"]],
      ["Yesterday", ["yesterday"]],
      ["Previous 7 days", ["week"]],
      ["Previous 30 days", ["month"]],
      ["Older", ["older"]],
    ]);
  });

  it("counts calendar days, so late last night is yesterday", () => {
    const lastNight = new Date(2026, 10, 18, 23, 30).getTime();
    expect(groupChats([chatAt("a", lastNight)], NOW)[0]?.label).toBe("Yesterday");
  });
});

describe("searching chats", () => {
  it("matches the title or the video name, ignoring case", () => {
    const chat = chatAt("a", 1, { title: "Holiday", video: BEACH });
    expect(matchesSearch(chat, "holi")).toBe(true);
    expect(matchesSearch(chat, "BEACH")).toBe(true);
    expect(matchesSearch(chat, "  ")).toBe(true);
    expect(matchesSearch(chat, "mountain")).toBe(false);
  });
});

describe("sectioning chats into folders", () => {
  it("puts filed chats under their folder, by name, and the rest under date groups", () => {
    const chats = [
      chatAt("pasta", NOW - 1000, { folderId: COOKING.id }),
      chatAt("beach", NOW - 2000, { folderId: TRIPS.id }),
      chatAt("orphan", NOW - 3000, { folderId: "gone" }),
      chatAt("loose", NOW - 5 * DAY),
    ];
    const { folders, groups } = sectionChats(chats, [TRIPS, COOKING], "", NOW);
    expect(
      folders.map(({ folder, chats: inside }) => [folder.id, inside.map((c) => c.id)]),
    ).toEqual([
      ["cooking", ["pasta"]],
      ["trips", ["beach"]],
    ]);
    expect(groups.map((group) => [group.label, group.chats.map((c) => c.id)])).toEqual([
      ["Today", ["orphan"]],
      ["Previous 7 days", ["loose"]],
    ]);
  });

  it("expands every folder with a match while searching and hides the rest", () => {
    const chats = [chatAt("beach", 1, { title: "Beach", folderId: TRIPS.id })];
    const collapsed = { ...TRIPS, collapsed: true };
    expect(sectionChats(chats, [collapsed, COOKING], "", NOW).folders).toEqual([
      { folder: COOKING, chats: [], expanded: true },
      { folder: collapsed, chats, expanded: false },
    ]);
    expect(sectionChats(chats, [collapsed, COOKING], "bea", NOW).folders).toEqual([
      { folder: collapsed, chats, expanded: true },
    ]);
  });
});
