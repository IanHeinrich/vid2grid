export function closeImages(images: readonly (ImageBitmap | undefined)[]): void {
  for (const image of images) image?.close();
}
