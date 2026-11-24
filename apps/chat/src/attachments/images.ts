const VIDEO_EXTENSIONS = ["mp4", "webm", "mov", "mkv", "m4v"];
const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif", "bmp", "avif"];

export type FileKind = "video" | "image" | "unsupported";

export function classifyFile(file: File): FileKind {
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("image/")) return "image";
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (VIDEO_EXTENSIONS.includes(extension)) return "video";
  if (IMAGE_EXTENSIONS.includes(extension)) return "image";
  return "unsupported";
}

const SENT_QUALITY = 0.85;
export const ORIGINAL_LONGEST_EDGE_PX = 4096;
export const ORIGINAL_QUALITY = 0.92;

export interface ScaledImage {
  blob: Blob;
  width: number;
  height: number;
}

export interface DownscaledUpload {
  sent: ScaledImage;
  // A larger copy for zooming; absent when the picture already fit the sent size.
  original?: ScaledImage;
}

export async function downscaleUpload(blob: Blob, sentEdge: number): Promise<DownscaledUpload> {
  const bitmap = await createImageBitmap(blob);
  try {
    const sent = await scaleBitmap(bitmap, sentEdge, SENT_QUALITY);
    if (Math.max(bitmap.width, bitmap.height) <= sentEdge) return { sent };
    const original = await scaleBitmap(bitmap, ORIGINAL_LONGEST_EDGE_PX, ORIGINAL_QUALITY).catch(
      () => undefined,
    );
    return original === undefined ? { sent } : { sent, original };
  } finally {
    bitmap.close();
  }
}

async function scaleBitmap(
  bitmap: ImageBitmap,
  longestEdge: number,
  quality: number,
): Promise<ScaledImage> {
  const scale = Math.min(1, longestEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  return { blob: await encodeJpeg(bitmap, width, height, quality), width, height };
}

async function encodeJpeg(
  bitmap: ImageBitmap,
  width: number,
  height: number,
  quality: number,
): Promise<Blob> {
  const type = "image/jpeg";
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    drawOnWhite(canvas.getContext("2d"), bitmap, width, height);
    return canvas.convertToBlob({ type, quality });
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  drawOnWhite(canvas.getContext("2d"), bitmap, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (encoded) => (encoded ? resolve(encoded) : reject(new Error("Could not encode the image"))),
      type,
      quality,
    );
  });
}

// JPEG has no alpha, so a transparent PNG would otherwise turn black.
function drawOnWhite(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null,
  bitmap: ImageBitmap,
  width: number,
  height: number,
): void {
  if (context === null) throw new Error("Canvas 2D is not available");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
}
