import { Vid2GridError } from "../errors";

// Display-oriented: any container rotation is already applied to width and height.
export interface VideoInfo {
  durationSeconds: number;
  width: number;
  height: number;
  keyframeTimestampsSeconds?: number[];
}

export function sourceAspect(info: Pick<VideoInfo, "width" | "height">): number {
  if (!(info.width > 0) || !(info.height > 0)) {
    throw new Vid2GridError("invalid_request", "sourceAspect must be positive");
  }
  return info.width / info.height;
}
