/** Encodes a collage canvas as a JPEG Blob at the given quality (1-100). */
export function canvasToJpegBlob(canvas: HTMLCanvasElement, quality = 80): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Failed to encode JPEG"));
      },
      "image/jpeg",
      quality / 100,
    );
  });
}
