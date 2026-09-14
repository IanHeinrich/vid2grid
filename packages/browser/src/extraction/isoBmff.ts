// Kept free of the mp4box import so callers can test a file before pulling the
// demuxer into the bundle.
export function looksLikeIsoBmff(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    file.type === "video/mp4" ||
    file.type === "video/quicktime" ||
    name.endsWith(".mp4") ||
    name.endsWith(".m4v") ||
    name.endsWith(".mov")
  );
}

export function supportsWebCodecs(file: File): boolean {
  return typeof VideoDecoder !== "undefined" && looksLikeIsoBmff(file);
}
