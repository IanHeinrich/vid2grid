import type { readFrameTimes } from "@vid2grid/browser";
import type { VideoInfo } from "@vid2grid/core";
import type { SheetSource } from "../../app/toolContext";
import type { AnalyseAudio } from "../../audio/videoAudio";
import type { AppElements } from "../../dom";
import { pendingFor, pendingVideo, shownVideo, type AppState } from "../../state";
import type { ChatStore, ImageRef, VideoAttachment } from "../../types";
import { fileKey, type probeAttachment, type renderSheets } from "../../video/render";
import type { renderOverview } from "../../video/tools";
import type { StatusLine } from "../status";
import type { CoverageStrip } from "./coverageStrip";
import type { MiniPlayer } from "./miniPlayer";

export interface VideoView {
  video: VideoAttachment | undefined;
  url: string | null;
}

export interface VideoPanelDeps {
  store: ChatStore;
  status: StatusLine;
  onChatChanged(): void;
  onVideoChanged(): void;
  onOverview(chatId: string, refs: ImageRef[]): void;
  onOverviewProgress(): void;
  studyStatus(): string;
  copyStatus(fileKey: string): string;
  loadCopy(fileKey: string): Promise<File | undefined>;
  onAttached(file: File, video: VideoAttachment): void;
  onCommitted(file: File, video: VideoAttachment, replaced: VideoAttachment | undefined): void;
  probe?: typeof probeAttachment;
  renderOverview?: typeof renderOverview;
  renderSheets?: typeof renderSheets;
  readFrameTimes?: typeof readFrameTimes;
  audioWanted(): boolean;
  analyseAudio?: AnalyseAudio;
}

export interface LoadedFile {
  file: File;
  info: VideoInfo;
}

export interface PendingFile extends LoadedFile {
  video: VideoAttachment;
  handle: FileSystemFileHandle | undefined;
}

export interface Render {
  fileKey: string;
  done: Promise<void>;
}

export interface OlderVideo {
  video: VideoAttachment;
  file: File;
  url: string;
}

export interface AudioPrep {
  chatId: string;
  fileKey: string;
  controller: AbortController;
  text: string;
}

export interface VideoPanelContext {
  els: Pick<AppElements, "video" | "miniPlayer">;
  state: AppState;
  deps: VideoPanelDeps;
  objectUrl: string | null;
  files: Map<string, LoadedFile>;
  // Dropped into the message being written, by chat, until sent or removed.
  pendingFiles: Map<string, PendingFile>;
  pendingUrl: { file: File; url: string } | null;
  renders: Map<string, Render>;
  // Keyed by File, so a changed video never reuses the old frame times and they go with it.
  frameTimes: WeakMap<File, number[] | undefined>;
  // Chats whose saved handle is stale or refused, so Reattach goes straight to the picker.
  skipHandle: Set<string>;
  // Every file loaded this session, by file key, so an earlier video can play without a copy.
  sessionFiles: Map<string, File>;
  // An earlier video of the chat playing in the mini-player in place of the current one.
  playing: { older: OlderVideo | undefined };
  seekToken: number;
  audioPrep: AudioPrep | undefined;
  player: MiniPlayer;
  coverage: CoverageStrip;
  render(): void;
}

export function isCurrent(ctx: VideoPanelContext, chatId: string): boolean {
  return ctx.state.currentChat?.id === chatId;
}

export function committedLoaded(ctx: VideoPanelContext): boolean {
  const chat = ctx.state.currentChat;
  return chat !== null && ctx.state.video?.chatId === chat.id;
}

export function isMissing(ctx: VideoPanelContext): boolean {
  const chat = ctx.state.currentChat;
  return (
    chat?.video !== undefined && !committedLoaded(ctx) && currentPendingFile(ctx) === undefined
  );
}

export function attachedVideo(ctx: VideoPanelContext, chatId: string): VideoAttachment | undefined {
  return ctx.state.chats.find((chat) => chat.id === chatId)?.video;
}

export function currentShownVideo(ctx: VideoPanelContext): VideoAttachment | undefined {
  const chat = ctx.state.currentChat;
  return chat ? shownVideo(ctx.state, chat.id) : undefined;
}

export function pendingFileOf(ctx: VideoPanelContext, chatId: string): PendingFile | undefined {
  const pending = ctx.pendingFiles.get(chatId);
  const wanted = pendingVideo(pendingFor(ctx.state, chatId));
  return pending && wanted?.fileKey === pending.video.fileKey ? pending : undefined;
}

export function currentPendingFile(ctx: VideoPanelContext): PendingFile | undefined {
  const chat = ctx.state.currentChat;
  return chat ? pendingFileOf(ctx, chat.id) : undefined;
}

// Null until render has made the URL for this file, so another chat's revoked URL is never used.
export function pendingUrlOf(ctx: VideoPanelContext, file: File): string | null {
  return ctx.pendingUrl?.file === file ? ctx.pendingUrl.url : null;
}

export function showingPending(ctx: VideoPanelContext): boolean {
  const url = ctx.pendingUrl?.url;
  return url !== undefined && ctx.els.miniPlayer.video.getAttribute("src") === url;
}

export function sheetSource(ctx: VideoPanelContext, chatId: string): SheetSource | undefined {
  const pending = pendingFileOf(ctx, chatId);
  if (pending) return pending;
  const video = attachedVideo(ctx, chatId);
  const loaded = ctx.files.get(chatId);
  return video && loaded && fileKey(loaded.file) === video.fileKey
    ? { ...loaded, video }
    : undefined;
}

export function currentRender(ctx: VideoPanelContext): Render | undefined {
  const chat = ctx.state.currentChat;
  const pending = chat ? ctx.renders.get(chat.id) : undefined;
  return pending && pending.fileKey === currentShownVideo(ctx)?.fileKey ? pending : undefined;
}
