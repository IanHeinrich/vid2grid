export interface CollageRequest {
  videoFile: File;
  startTime: number;
  endTime: number;
  framesPerGrid: number;
  outputResolution: number;
  targetFps: number;
  jpegQuality: number;
}

export function validateCollageRequest(config: CollageRequest): void {
  if (config.endTime <= config.startTime) {
    throw new Error("end_time must be greater than start_time");
  }
  if (config.targetFps <= 0) {
    throw new Error("target_fps must be positive");
  }
  if (config.framesPerGrid <= 0) {
    throw new Error("frames_per_grid must be positive");
  }
  if (config.outputResolution <= 0) {
    throw new Error("output_resolution must be positive");
  }
  if (config.jpegQuality < 1 || config.jpegQuality > 100) {
    throw new Error("jpeg_quality must be between 1 and 100");
  }
}
