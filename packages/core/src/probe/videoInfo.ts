/** Display-oriented source dimensions: any container rotation is already applied. */
export interface VideoInfo {
  durationSeconds: number;
  width: number;
  height: number;
  /** Ascending keyframe composition times, when the probe can read them cheaply. */
  keyframeTimestampsSeconds?: number[];
}
