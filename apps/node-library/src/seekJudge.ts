export interface SeekJudge {
  // Takes in one seek; true when decoding straight through is worth trying instead.
  seekTook(skippedSeconds: number, ms: number): boolean;
  // Takes in part of a try: how long ffmpeg, held up by nothing, took to decode this much.
  decoded(videoSeconds: number, ms: number): void;
  // Ends a try; true when it clearly beat the seeks that led to it.
  decodingWon(): boolean;
}

const ASSUMED_FRAMES_PER_SECOND = 30;
// About the fastest ffmpeg decodes, scales and pipes out 720p, so a try comes early rather
// than late; what the try measures then replaces it.
const FASTEST_FRAMES_PER_MS = 3;
// More than one, so a busy moment does not lead to a try.
const LOSSES_BEFORE_A_TRY = 3;
// A try measures quick: ffmpeg works ahead while the frame before it is being taken.
const WINNING_MARGIN = 1.5;

// A file with no seek index is read from its start on every seek, so seeking costs more the
// further in it goes. Only ever decides how fast frames are reached, never which are picked.
export function createSeekJudge(framesPerSecond: number | undefined): SeekJudge {
  let decodedPerMs = FASTEST_FRAMES_PER_MS / (framesPerSecond ?? ASSUMED_FRAMES_PER_SECOND);
  let lost = { seeks: 0, seconds: 0, ms: 0 };
  let tried = { seconds: 0, ms: 0 };
  return {
    seekTook(skippedSeconds, ms) {
      if (skippedSeconds >= ms * decodedPerMs) {
        lost = { seeks: 0, seconds: 0, ms: 0 };
        return false;
      }
      lost = { seeks: lost.seeks + 1, seconds: lost.seconds + skippedSeconds, ms: lost.ms + ms };
      tried = { seconds: 0, ms: 0 };
      return lost.seeks >= LOSSES_BEFORE_A_TRY;
    },
    decoded(videoSeconds, ms) {
      tried = { seconds: tried.seconds + videoSeconds, ms: tried.ms + ms };
    },
    decodingWon() {
      const won = tried.seconds * lost.ms > WINNING_MARGIN * lost.seconds * tried.ms;
      if (tried.ms > 0) decodedPerMs = tried.seconds / tried.ms;
      lost = { seeks: 0, seconds: 0, ms: 0 };
      return won;
    },
  };
}
