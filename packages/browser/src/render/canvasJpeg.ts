export const DEFAULT_JPEG_QUALITY = 80;

// Plans carry quality as a percentage; canvas encoders take a fraction.
export function jpegQualityFraction(percent: number): number {
  return percent / 100;
}

export function canvasToJpegBlob(
  canvas: HTMLCanvasElement,
  quality = DEFAULT_JPEG_QUALITY,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Failed to encode JPEG"));
      },
      "image/jpeg",
      jpegQualityFraction(quality),
    );
  });
}
