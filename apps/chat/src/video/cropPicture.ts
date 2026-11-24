import type { Rect, Size } from "./zoomArea";

const ZOOM_JPEG_QUALITY = 0.9;
const JPEG = "image/jpeg";

export interface PictureTools {
  decode(blob: Blob): Promise<ImageBitmap>;
  crop(picture: ImageBitmap, area: Rect, output: Size): Promise<Blob>;
}

export const browserPictures: PictureTools = {
  decode: (blob) => createImageBitmap(blob),
  crop: cropJpeg,
};

async function cropJpeg(picture: ImageBitmap, area: Rect, output: Size): Promise<Blob> {
  const { width, height } = output;
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    drawCrop(canvas.getContext("2d"), picture, area, output);
    return canvas.convertToBlob({ type: JPEG, quality: ZOOM_JPEG_QUALITY });
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  drawCrop(canvas.getContext("2d"), picture, area, output);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (encoded) => (encoded ? resolve(encoded) : reject(new Error("Could not encode the image"))),
      JPEG,
      ZOOM_JPEG_QUALITY,
    );
  });
}

function drawCrop(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null,
  picture: ImageBitmap,
  { x, y, width, height }: Rect,
  output: Size,
): void {
  if (context === null) throw new Error("Canvas 2D is not available");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(picture, x, y, width, height, 0, 0, output.width, output.height);
}
