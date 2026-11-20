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

export async function downscaleImage(
  blob: Blob,
  longestEdge: number,
  quality = 0.85,
): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, longestEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    return { blob: await encodeJpeg(bitmap, width, height, quality), width, height };
  } finally {
    bitmap.close();
  }
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
