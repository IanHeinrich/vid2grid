import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initConversation } from "../src/ui/conversation/conversation";
import { beach, deps, els, resetConversation, setView, spies } from "./support/conversation";
import { assistant, user } from "./support/factories";

beforeEach(resetConversation);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ready and empty states", () => {
  it("shows the hint only for an empty chat with no video", () => {
    setView({ video: undefined, url: null });
    const conversation = initConversation(els, deps());
    conversation.reset([]);
    expect(els.conversation.empty.hidden).toBe(false);
    setView({ video: beach, url: "blob:beach" });
    conversation.refreshVideos();
    expect(els.conversation.empty.hidden).toBe(true);
  });

  it("offers starters once the overview is ready and fills the composer", () => {
    const conversation = initConversation(els, deps());
    const card = els.conversation.scroller.querySelector<HTMLElement>(".ready-card");
    expect(card?.hidden).toBe(true);
    conversation.setReady(beach);
    expect(card?.hidden).toBe(false);
    expect(card?.textContent).not.toContain("is ready");
    const starters = [...(card?.querySelectorAll<HTMLButtonElement>("button.starter") ?? [])];
    expect(starters.length).toBeGreaterThanOrEqual(2);
    starters[1]?.click();
    expect(spies.onPrefill).toHaveBeenCalledWith("Who is in this?");
    conversation.setReady(undefined);
    expect(card?.hidden).toBe(true);
  });

  it("shows the Study and thoroughness note once ever", () => {
    const card = els.conversation.readyCard;
    const note = () => card.querySelector<HTMLElement>(".ready-note");
    const conversation = initConversation(els, deps());
    conversation.setReady(beach);
    expect(note()?.hidden).toBe(false);
    conversation.refreshVideos();
    expect(note()?.hidden).toBe(false);
    conversation.setReady(undefined);
    const later = { ...beach, fileKey: "dunes-key", name: "dunes.mp4" };
    conversation.setReady(later);
    expect(note()?.hidden).toBe(true);
    expect(card.hidden).toBe(false);
  });

  it("drops the starters once the chat has messages, and hides a card left empty", () => {
    localStorage.setItem("vid2grid-chat-ready-note-seen", "seen");
    const card = els.conversation.readyCard;
    const conversation = initConversation(els, deps());
    conversation.reset([user("u1", "Hi"), assistant("a1", "Hello")]);
    conversation.setReady(beach);
    expect(card.querySelector<HTMLElement>(".ready-suggestions")?.hidden).toBe(true);
    expect(card.hidden).toBe(true);
  });
});
