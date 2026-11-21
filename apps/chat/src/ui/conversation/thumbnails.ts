import type { ImageRef, UserMessage } from "../../types";
import { imageCaption } from "./captions";
import type { ConversationContext, Entry } from "./context";
import type { LightboxItem } from "./lightbox";

export function togglePin(ctx: ConversationContext, message: UserMessage, index: number): void {
  const updated: UserMessage = {
    ...message,
    images: message.images.map((ref, i) => (i === index ? { ...ref, pinned: !ref.pinned } : ref)),
  };
  ctx.deps.onMessageChanged(updated);
  ctx.showMessage(updated);
}

export function thumbnail(
  ctx: ConversationContext,
  entry: Entry,
  ref: ImageRef,
  messageId: string,
  index: number,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "thumb-button";
  const img = document.createElement("img");
  img.alt = imageCaption(ref);
  button.title = img.alt;
  img.loading = "lazy";
  button.append(img);
  button.addEventListener("click", () => openLightbox(ctx, messageId, index));
  ctx.deps.store
    .getImage(ref.id)
    .then((blob) => {
      if (blob === undefined || entry.disposed) return;
      const url = URL.createObjectURL(blob);
      entry.urls.push(url);
      img.src = url;
    })
    .catch(() => {
      img.alt = `${img.alt} (not found)`;
    });
  return button;
}

function lightboxItems(ctx: ConversationContext): LightboxItem[] {
  return [...ctx.messages.values()].flatMap((message) =>
    message.role === "assistant"
      ? []
      : message.images.map((ref, index) => ({
          messageId: message.id,
          index,
          ref,
          pinnable: message.role === "user",
        })),
  );
}

function openLightbox(ctx: ConversationContext, messageId: string, index: number): void {
  const items = lightboxItems(ctx);
  const position = items.findIndex((item) => item.messageId === messageId && item.index === index);
  ctx.lightbox.open(items, position);
}

export function togglePinFromLightbox(
  ctx: ConversationContext,
  item: LightboxItem,
): LightboxItem[] {
  const message = ctx.messages.get(item.messageId);
  if (message?.role === "user") togglePin(ctx, message, item.index);
  return lightboxItems(ctx);
}
