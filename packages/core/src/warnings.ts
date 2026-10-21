export type WarningCode =
  "keyframes_unavailable" | "no_transcription_port" | "no_audio" | "transcription_failed";

export interface Vid2GridWarning {
  code: WarningCode;
  message: string;
}
