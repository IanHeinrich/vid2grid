export type Vid2GridErrorCode = "invalid_request" | "no_audio" | "no_frames" | "internal";

export class Vid2GridError extends Error {
  readonly code: Vid2GridErrorCode;

  constructor(code: Vid2GridErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "Vid2GridError";
    this.code = code;
  }
}
