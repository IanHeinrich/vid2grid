import { Vid2GridError } from "@vid2grid/core";

export function noAudioTrackError(): Vid2GridError {
  return new Vid2GridError("no_audio", "This video has no audio track.");
}

export function noDecodableAudioError(cause: unknown): Vid2GridError {
  return new Vid2GridError("no_audio", "This video has no decodable audio track.", { cause });
}

export function undecodableAudioError(codec: string, cause?: unknown): Vid2GridError {
  return new Vid2GridError(
    "undecodable_audio",
    `This video's audio track (${codec}) cannot be decoded in this browser.`,
    cause === undefined ? undefined : { cause },
  );
}
