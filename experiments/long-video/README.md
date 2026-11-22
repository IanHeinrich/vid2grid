# Long-video experiment, phase 0 (model half)

A small evaluation harness for the long-video plan. It asks how the chat app's
video overview should be shaped for videos of 30 to 60 minutes, whether
transcript text closes the gap, whether resending the overview on later turns
is worth its cost, and whether frames picked from a no-decode scene measure
beat evenly spaced frames. `FINDINGS.md` has what came out; `out/results.md`
has the tables.

It is its own uv project, not an npm workspace, and renders the sheets with
the vid2grid Python library from `../../apps/python-library`, so they match
the product. The pattern is copied from `../motion/`; nothing is imported
from it. `baselines/` belongs to a separate harness.

## Data

The questions are Video-MME's, used internally only. Its licence forbids
redistribution, so nothing from the dataset is committed: no videos, frames,
subtitles, or question or option text. Everything lives under
`D:\vid2grid-data\video-mme\` (or `VIDEO_MME_DIR`):

- `test.parquet`, the questions;
- `phase0_pick.json`, the 30 chosen video ids;
- `videos/<videoID>.mp4`;
- `subtitle.zip`, with `subtitle/<videoID>.srt` inside (one of the 30 has none).

The harness uses the 90 "long" questions on those 30 videos, three per video.
Renders, demux data and every cached response go under `cache\p0\` in that
folder. The repo keeps only the ledger (`out/ledger.jsonl`, ignored) and
`out/results.md`, which shows aggregates and question ids only.

## Files

| File           | What it does                                                                                               |
| -------------- | ---------------------------------------------------------------------------------------------------------- |
| `dataset.py`   | Loads the questions, parses subtitles into `[m:ss]` lines and formats times the way the chat app does.     |
| `scene.py`     | The demux pass (packet times, sizes and keyframe flags, no decoding) and the fixed scene-picking rule.     |
| `render.py`    | Library renders for the four layouts, and a Pillow grid for the scene against even test.                   |
| `prompts.py`   | The conditions, the shared system text, image lines, the chat app's stub text and the pinning chat.        |
| `providers.py` | OpenAI-compatible chat completions for Venice and Gemini.                                                  |
| `run.py`       | Prepares, estimates, sends and caches, with a per-round ledger, caps and a one-chain lock.                 |
| `score.py`     | Paired McNemar comparisons, breakdowns and cost per correct answer into `out/results.md`.                  |
| `pricing.json` | Prices and the token estimates measured on the first video.                                                |

## Conditions

Every condition shares one system text asking for `{"answer": "<letter>"}`.
The user message says how long the video is, describes the material, lists
the images the way the chat app does (`grid_0001: 0:00 to 11:47, 20 frames`)
and ends with the question and its options.

| Condition         | What the model gets                                                                  |
| ----------------- | ------------------------------------------------------------------------------------ |
| `blind`           | The question and options only, as a language-prior control.                          |
| `transcript`      | The subtitles as `[m:ss] text` lines, no images.                                     |
| `s4x20`           | 4 library sheets of 20 frames, 2048 px square.                                       |
| `s4x9`            | 4 library sheets of 9 frames.                                                        |
| `s8x9`            | 8 library sheets of 9 frames.                                                        |
| `f10`             | 10 single frames, rendered by the library and cropped to the frame (2032 x 1143).    |
| `..._t`           | Each layout above with the subtitles too.                                            |
| `scene4x20`       | 80 frames picked by the scene rule, on 4 sheets of a 4 x 5 grid, 2048 x 1440.        |
| `even4x20`        | The same grid with 80 evenly spaced frames; the prompt is identical.                 |
| `pinned`          | Each video's three questions as one chat, `s4x20` and subtitles in turn 1, resent.   |
| `stubbed`         | The same chat with the images replaced from turn 2 by the chat app's stub text.      |

Frames are evenly spaced over the whole video, starting at 0:00. Pinning
always uses `s4x20` with the transcript, fixed before any results. The stub is
`imageStub(ref, "earlier")` from `apps/chat/src/imageRefs.ts` for an overview
sheet, for example
`[grid_0002 from overview: 11:47 to 23:13, 20 frames. Sent earlier; call recall("grid_0002 from overview") to see it again.]`.

### The scene rule

Fixed before any answer was seen. From the demux pass alone:

1. Keyframes are candidates. A keyframe whose gap from the one before is
   within 0.25 s of the video's 95th percentile gap is the encoder's forced
   cadence and is dropped; the rest were placed by its scene-cut detector.
2. Each candidate scores the change in the stream's inter-frame bitrate
   across it: the absolute difference of the log mean bytes per second over
   the 3 s before and the 3 s after.
3. The video is cut into 20 equal parts and the best candidate in each is
   taken (the part's midpoint when it has none), so every part is covered.
4. The other 60 picks are the highest scores at least duration / 160 from any
   pick so far.
5. Any shortfall is filled from the even times farthest from every pick.

## Running

From `experiments/long-video/`:

```bash
uv sync --all-groups
uv run python run.py --prepare
uv run python run.py --dry-run
uv run python run.py --provider venice
uv run python run.py --provider gemini --conditions core,s8x9
uv run python score.py
```

A run goes group by group in the order given (`core`, `s8x9`, `scene`,
`pinning`), and within a group question by question, so a budget stop leaves
the group's conditions paired. Pinning runs video by video, both variants in
turn, sharing turn 1. Gemini gets images through its OpenAI-compatible
endpoint at its default media resolution, as the chat app sends them.

`--prepare` renders every layout and runs the demux pass for all 30 videos.
The dry run prints, per provider and condition, the request count, how many
are cached, the estimated input tokens and the expected and worst-case cost
against the round's cap. `--conditions` takes names or the groups `core`,
`s8x9`, `scene` and `pinning`; `--videos` takes a count or ids for a pilot.

API keys come from `VENICE_API_KEY` and `GEMINI_API_KEY`. On Windows a key
missing from the process environment is read from the user environment in the
registry. Keys are never printed or written to disk.

## Cost controls

- A real run needs a price in `pricing.json`.
- Before each request it adds a worst-case estimate (input padded by half,
  plus the full `max_tokens` of output) to the provider's ledger total for the
  round and stops if that would pass the cap. Round `p0` caps Venice at $5.00
  and Gemini at $4.00.
- Only one run may go at a time: a real run takes `out/run.lock` and refuses
  to start while it exists.
- Every response is cached under `cache\p0\answers\`, keyed by provider,
  model, condition, question, turn and the full messages with each image
  replaced by a hash of its bytes, so a rerun never pays twice and a changed
  render never reuses an old answer.
