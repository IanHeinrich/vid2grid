import { describe, expect, it } from "vitest";
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  chatToMarkdown,
  exportBackup,
  importBackup,
  type Backup,
} from "../src/chat/exportChat";
import { blobToDataUrl } from "../src/chat/dataUrl";
import { createMemoryStore } from "../src/chat/store";
import type {
  Chat,
  ChatMessage,
  ChatStore,
  ImageRef,
  VideoCast,
  VideoTimeline,
} from "../src/types";

const video = {
  name: "clip.mp4",
  fileKey: "clip.mp4|100|1",
  durationSeconds: 125,
  width: 1280,
  height: 720,
};

function chat(id: string, overrides: Partial<Chat> = {}): Chat {
  return {
    id,
    title: `Chat ${id}`,
    createdAt: 1,
    updatedAt: 1,
    settings: {
      systemPrompt: "Watch closely.\nBe brief.",
      modelId: "qwen",
      sheetResolution: "auto",
    },
    video,
    sceneLog: [
      { timeSeconds: 70, text: "she leaves" },
      { timeSeconds: 12, text: "door opens" },
    ],
    ...overrides,
  };
}

function sheetRef(id: string): ImageRef {
  return {
    id,
    pinned: false,
    source: {
      kind: "sheet",
      call: "look(60, 90)",
      name: "grid_0001",
      startSeconds: 60,
      endSeconds: 90,
      frameCount: 9,
    },
  };
}

const upload: ImageRef = {
  id: "upload-1",
  pinned: true,
  source: { kind: "upload", name: "poster.png" },
};

const messages: ChatMessage[] = [
  { id: "u1", createdAt: 1, role: "user", text: "What happens?", images: [upload] },
  {
    id: "a1",
    createdAt: 2,
    role: "assistant",
    text: "",
    toolCalls: [
      { id: "c1", name: "look", arguments: '{"start":60,"end":90,"frames":9,"perSheet":9}' },
      { id: "c2", name: "frames", arguments: '{"times":[42]}' },
    ],
  },
  {
    id: "t1",
    createdAt: 3,
    role: "tool",
    toolCallId: "c1",
    text: "Rendered 9 frames.",
    images: [sheetRef("sheet-1")],
  },
  { id: "t2", createdAt: 4, role: "tool", toolCallId: "c2", text: "Rendered 1 frame.", images: [] },
  {
    id: "a2",
    createdAt: 5,
    role: "assistant",
    text: "Noted.",
    toolCalls: [{ id: "c3", name: "note", arguments: '{"t":70,"text":"she leaves"}' }],
  },
  { id: "t3", createdAt: 6, role: "tool", toolCallId: "c3", text: "Noted.", images: [] },
  { id: "a3", createdAt: 7, role: "assistant", text: "At [1:10] she leaves.", toolCalls: [] },
];

describe("chatToMarkdown", () => {
  it("exports only the shown reply, not swiped-away alternates", () => {
    const first = messages[0];
    if (first?.role !== "user") throw new Error("expected a user message");
    const swiped: ChatMessage = {
      ...first,
      alternates: [
        {
          createdAt: 1,
          messages: [
            { id: "old", createdAt: 2, role: "assistant", text: "Old reply.", toolCalls: [] },
          ],
        },
      ],
    };
    const markdown = chatToMarkdown(chat("c"), [swiped, ...messages.slice(1)]);
    expect(markdown).toContain("At [1:10] she leaves.");
    expect(markdown).not.toContain("Old reply.");
  });

  it("writes a readable transcript", () => {
    expect(chatToMarkdown(chat("c"), messages)).toBe(
      [
        "# Chat c",
        "- Model: qwen\n- Video: clip.mp4 (2:05)",
        "> Watch closely.\n> Be brief.",
        "## User",
        "What happens?",
        "[image: poster.png]",
        "## Assistant",
        "_Looked at 1:00 to 1:30, 0:42 frames, 1 note_",
        "_Before looking:_ Noted.",
        "At [1:10] she leaves.",
        "## Scene log\n- [0:12] door opens\n- [1:10] she leaves",
      ].join("\n\n") + "\n",
    );
  });
});

describe("chatToMarkdown captions", () => {
  it("uses the chat's names, captions sheets and skips empty parts", () => {
    const named: Chat = {
      id: "c",
      title: "Chat c",
      createdAt: 1,
      updatedAt: 1,
      settings: {
        systemPrompt: "",
        modelId: "qwen",
        sheetResolution: "auto",
        characterName: "Mara",
        userName: "Sam",
      },
      sceneLog: [],
    };
    const markdown = chatToMarkdown(named, [
      { id: "u1", createdAt: 1, role: "user", text: "Look", images: [sheetRef("s")] },
      {
        id: "a1",
        createdAt: 2,
        role: "assistant",
        text: "Hi.",
        toolCalls: [{ id: "x", name: "look", arguments: "{" }],
      },
    ]);
    expect(markdown).toBe(
      "# Chat c\n\n- Model: qwen\n\n## Sam\n\nLook\n\n[image: grid_0001 from look(60, 90), 1:00 to 1:30]\n\n## Mara\n\n_Looked at the video_\n\n_Before looking:_ Hi.\n",
    );
  });
});

function jpeg(bytes: number[]): Blob {
  return new Blob([new Uint8Array(bytes)], { type: "image/jpeg" });
}

const timeline: VideoTimeline = {
  fileKey: video.fileKey,
  modelId: "qwen",
  entries: [{ startSeconds: 0, endSeconds: 5, text: "an empty room" }],
  nextWindow: 1,
  windowCount: 1,
  updatedAt: 1,
};

async function seededStore(): Promise<{ store: ChatStore; uploadId: string; sheetId: string }> {
  const store = createMemoryStore();
  const uploadId = await store.putImage(jpeg([1, 2, 3]));
  const sheetId = await store.putImage(jpeg([255, 216, 255]));
  await store.putChat(chat("c1"));
  const stored = messages.map((message): ChatMessage => {
    if (message.role === "assistant") return message;
    const images = message.images.map((ref) => ({
      ...ref,
      id: ref.source.kind === "upload" ? uploadId : sheetId,
    }));
    return { ...message, images };
  });
  for (const message of stored) await store.putMessage("c1", message);
  await store.putTimeline(timeline);
  await store.putTimeline({ ...timeline, fileKey: "unrelated" });
  return { store, uploadId, sheetId };
}

// jsdom's Blob has no text(); a browser File does, and so does the Blob a Response makes.
function readText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsText(blob);
  });
}

async function backupOf(blob: Blob): Promise<Backup> {
  return JSON.parse(await readText(blob)) as Backup;
}

async function asFile(blob: Blob): Promise<Blob> {
  return new Response(await readText(blob)).blob();
}

describe("exportBackup", () => {
  it("writes chats, messages, their timelines and their images", async () => {
    const { store, uploadId } = await seededStore();
    const blob = await exportBackup(store, { now: 42 });
    expect(blob.type).toBe("application/json");
    const backup = await backupOf(blob);
    expect(backup.format).toBe(BACKUP_FORMAT);
    expect(backup.version).toBe(BACKUP_VERSION);
    expect(backup.exportedAt).toBe(42);
    expect(backup.chats).toHaveLength(1);
    expect(backup.chats[0]?.messages).toHaveLength(messages.length);
    expect(backup.timelines).toEqual([timeline]);
    expect(backup.images).toHaveLength(2);
    expect(backup.images).toContainEqual({ id: uploadId, type: "image/jpeg", base64: "AQID" });
  });

  it("leaves images out when asked", async () => {
    const { store } = await seededStore();
    const backup = await backupOf(await exportBackup(store, { includeImages: false }));
    expect(backup.images).toEqual([]);
  });
});

describe("importBackup", () => {
  it("restores into an empty store, remapping image ids", async () => {
    const { store, uploadId } = await seededStore();
    const blob = await asFile(await exportBackup(store));
    const target = createMemoryStore();
    expect(await importBackup(target, blob)).toEqual({
      chats: 1,
      messages: 7,
      images: 2,
      timelines: 1,
      casts: 0,
    });
    expect((await target.getChat("c1"))?.title).toBe("Chat c1");
    const restored = await target.listMessages("c1");
    const first = restored[0];
    const newId = first?.role === "user" ? first.images[0]?.id : undefined;
    expect(newId).toBeDefined();
    expect(newId).not.toBe(uploadId);
    const image = await target.getImage(newId ?? "");
    expect(image === undefined ? "" : await blobToDataUrl(image)).toBe(
      "data:image/jpeg;base64,AQID",
    );
    expect(await target.getTimeline(video.fileKey)).toEqual(timeline);
  });

  it("imports a chat that already exists under a new id instead of overwriting it", async () => {
    const { store } = await seededStore();
    const blob = await asFile(await exportBackup(store, { includeImages: false }));
    const counts = await importBackup(store, blob, { newId: () => "c1-copy" });
    expect(counts).toEqual({ chats: 1, messages: 7, images: 0, timelines: 0, casts: 0 });
    expect((await store.getChat("c1"))?.title).toBe("Chat c1");
    expect((await store.getChat("c1-copy"))?.title).toBe("Chat c1 (imported)");
    expect(await store.listMessages("c1-copy")).toHaveLength(7);
  });
});

describe("importing malformed backups", () => {
  it("rejects malformed files with a clear message", async () => {
    const store = createMemoryStore();
    const file = (value: unknown) =>
      new Response(typeof value === "string" ? value : JSON.stringify(value)).blob();
    const valid = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: 1,
      chats: [],
      timelines: [],
      images: [],
    };
    await expect(importBackup(store, await file("{oops"))).rejects.toThrow(
      "not a valid vid2grid chat backup: it is not JSON",
    );
    await expect(importBackup(store, await file({ chats: [] }))).rejects.toThrow(
      "the format is missing",
    );
    await expect(importBackup(store, await file({ ...valid, version: 7 }))).rejects.toThrow(
      "This backup is version 7, but this app reads version 1.",
    );
    await expect(
      importBackup(store, await file({ ...valid, chats: [{ chat: { id: 1 }, messages: [] }] })),
    ).rejects.toThrow("a chat is damaged");
    await expect(
      importBackup(
        store,
        await file({ ...valid, images: [{ id: "i", type: "image/jpeg", base64: "!!" }] }),
      ),
    ).rejects.toThrow("an image is damaged");
    expect(await store.listChats()).toEqual([]);
  });
});

describe("backups with casts and earlier videos", () => {
  const earlierVideo = { ...video, name: "first.mp4", fileKey: "first.mp4|50|1" };
  const cast = (fileKey: string, name: string): VideoCast => ({
    fileKey,
    cards: [{ id: name, name, description: "in a coat" }],
    updatedAt: 1,
  });

  async function storeWithTwoVideos(): Promise<ChatStore> {
    const store = createMemoryStore();
    await store.putChat(chat("c1"));
    await store.putMessage("c1", {
      id: "u0",
      createdAt: 0,
      role: "user",
      text: "First clip.",
      images: [],
      video: earlierVideo,
    });
    await store.putTimeline(timeline);
    await store.putTimeline({ ...timeline, fileKey: earlierVideo.fileKey });
    await store.putTimeline({ ...timeline, fileKey: "unrelated" });
    await store.putCast(cast(video.fileKey, "Mara"));
    await store.putCast(cast(earlierVideo.fileKey, "Ines"));
    await store.putCast(cast("unrelated", "Nobody"));
    return store;
  }

  it("round-trips the casts and timelines of every video the chats used", async () => {
    const blob = await asFile(await exportBackup(await storeWithTwoVideos()));
    const target = createMemoryStore();
    const counts = await importBackup(target, blob);
    expect(counts).toMatchObject({ timelines: 2, casts: 2 });
    expect(await target.getCast(video.fileKey)).toEqual(cast(video.fileKey, "Mara"));
    expect(await target.getCast(earlierVideo.fileKey)).toEqual(cast(earlierVideo.fileKey, "Ines"));
    expect(await target.getTimeline(earlierVideo.fileKey)).toBeDefined();
    expect(await target.getCast("unrelated")).toBeUndefined();
    expect(await target.getTimeline("unrelated")).toBeUndefined();
  });

  it("keeps a cast already in the store", async () => {
    const blob = await asFile(await exportBackup(await storeWithTwoVideos()));
    const target = createMemoryStore();
    await target.putCast(cast(video.fileKey, "Edited"));
    expect(await importBackup(target, blob)).toMatchObject({ casts: 1 });
    expect(await target.getCast(video.fileKey)).toEqual(cast(video.fileKey, "Edited"));
  });

  it("still reads a backup written without casts", async () => {
    const backup = await backupOf(await exportBackup(await storeWithTwoVideos()));
    delete backup.casts;
    const file = await new Response(JSON.stringify(backup)).blob();
    expect(await importBackup(createMemoryStore(), file)).toMatchObject({ casts: 0 });
  });
});

describe("backups with alternate replies", () => {
  it("backs up and remaps images inside alternate replies", async () => {
    const store = createMemoryStore();
    const altId = await store.putImage(jpeg([9, 9, 9]));
    await store.putChat(chat("c1"));
    await store.putMessage("c1", {
      id: "u1",
      createdAt: 1,
      role: "user",
      text: "What happens?",
      images: [],
      alternates: [
        {
          createdAt: 2,
          messages: [
            { id: "old-a", createdAt: 2, role: "assistant", text: "", toolCalls: [] },
            {
              id: "old-t",
              createdAt: 3,
              role: "tool",
              toolCallId: "x",
              text: "",
              images: [sheetRef(altId)],
            },
          ],
        },
      ],
    });
    const blob = await exportBackup(store);
    expect((await backupOf(blob)).images.map((image) => image.id)).toEqual([altId]);
    const target = createMemoryStore();
    expect((await importBackup(target, await asFile(blob))).images).toBe(1);
    const [restored] = await target.listMessages("c1");
    const reply = restored?.role === "user" ? restored.alternates?.[0]?.messages[1] : undefined;
    const newId = reply?.role === "tool" ? reply.images[0]?.id : undefined;
    expect(newId).toBeDefined();
    expect(newId).not.toBe(altId);
    const image = await target.getImage(newId ?? "");
    expect(image === undefined ? "" : await blobToDataUrl(image)).toBe(
      "data:image/jpeg;base64,CQkJ",
    );
  });
});
