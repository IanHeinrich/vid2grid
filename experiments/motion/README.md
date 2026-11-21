# Motion view experiment

A small, reproducible experiment on which "motion views" help vision-language
models answer motion questions about short clips. Each synthetic clip is shown
to a model under several conditions (a single frame, vid2grid sheets, trails,
onion skins, difference maps and text motion tracks), and the model answers
multiple-choice questions about direction, camera movement, counting and speed
in one JSON reply. Scoring is exact against the clip's ground truth.

It is its own uv project, not an npm workspace, and uses the vid2grid Python
library from `../../apps/python-library` for the real sheets.

## Files

| File                  | What it does                                                                                                                                              |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `make_clips.py`       | Writes seeded synthetic clips (5 s, 30 fps, 640x360, H.264) and `clips/manifest.json` with their ground truth. Every moving clip gets a reversed copy.    |
| `make_tempcompass.py` | Picks 90 TempCompass questions (30 each for direction, speed and order) and writes `clips/tempcompass_manifest.json`.                                     |
| `motion.py`           | The shared maths: downscaling, phase-correlation shift, per-region energy and 0 to 9 digits.                                                              |
| `conditions.py`       | Turns a clip into the images and text a model sees under each condition.                                                                                  |
| `questions.py`        | The questions, the one-line legend for each condition, and the prompt.                                                                                    |
| `providers.py`        | OpenAI-compatible chat completions for Venice, Gemini and OpenAI.                                                                                         |
| `run.py`              | Renders, estimates, sends and caches. Writes `out/renders/`, `out/cache/` and `out/ledger.jsonl`.                                                         |
| `score.py`            | Reads the cache and ledger and writes `out/results.md`.                                                                                                   |
| `pricing.json`        | Dollars per million input and output tokens for a few models per provider. Venice prices come from its API; the rest are estimates to check before a run. |

## Clips

25 base clips and 23 reversed copies, 48 in all: a red ball moving left, right,
up or down, slow and fast; a ball that changes direction halfway; red and blue
balls at different speeds, some crossing; a ball going back and forth 2 to 5
times; camera pans with the ball still in the scene, and pans with the ball
moving too; and two static controls, one with sensor-like noise. Backgrounds
are near-grey noise textures so a pan is visible. Running `make_clips.py` twice
writes identical files.

`make_clips.py --hard` also writes the hard set: 12 of the base designs, prefixed
`hard_`, with handheld shake (a small random translation and rotation on every
frame, on top of any pan), sensor noise, motion blur on moving balls, lower
contrast, smaller balls, a gentle lighting flicker and a low-bitrate encode. Six
of them add a distractor, a soft patch that drifts slowly and flickers and is
not one of the asked-about objects. That is 12 clips and 10 reversed copies;
the static ones get no reversed copy, as in the base set.

Shake is camera movement, so `moved` is yes on every hard clip, the static ones
included. `background` asks for a direction of travel, and shake has none, so
it stays none unless the design pans. Hard clips add `object_moved`, which asks
whether either ball moved relative to the background with shake excluded; it is
the false-motion measure on hard static clips.

### TempCompass

The real-footage set uses TempCompass, a research benchmark, kept in
`clips/tempcompass/` and never committed. `make_tempcompass.py` reads its
`multi-choice.parquet` and picks 30 videos each for the direction, speed and
order dimensions, one question per video, chosen with a fixed seed. Where both
a video and its `_reverse` copy have questions it takes the pair. The prompt is
the benchmark's own question with the condition's legend line, answered as
`{"answer": "<letter>"}` and scored by letter.

Real clips are scaled to 640 wide and thinned to at most 300 frames for the
image conditions. The grid conditions keep one frame a second up to 16 cells
and spread 16 frames over longer clips. The motion tracks use 0.5 s steps up to
20 steps and longer steps past that, and say so. `trail_lines` keeps at most
the four longest paths and draws none when it finds none.

## Conditions

| Condition             | What the model gets                                                                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `single_frame`        | The middle frame. The control.                                                                                                                                                                   |
| `grid_1fps`           | A vid2grid sheet at one frame per second.                                                                                                                                                        |
| `burst`               | A vid2grid sheet of 16 frames spread evenly over the clip.                                                                                                                                       |
| `frames_1fps`         | The same frames as `grid_1fps`, sent as separate images (768 px on the longest edge), each stamped with its time.                                                                                |
| `trail_pair`          | The plain final frame beside the final frame with six time-coloured ghosts, aligned for camera motion.                                                                                           |
| `trail_pair_nolegend` | The same image without the colour strip, and no description in the prompt.                                                                                                                       |
| `trail_lines`         | The plain final frame beside the final frame with a thin line per moving object through 12 sampled positions, dots at each sample and an arrowhead at the newest end, aligned for camera motion. |
| `onion_pair`          | The plain final frame beside a blend of the last eight sampled frames, later ones stronger.                                                                                                      |
| `diff_pair`           | The plain final frame beside a heatmap of change over the clip, aligned for camera motion.                                                                                                       |
| `grid_track1`         | `grid_1fps` plus one motion digit per 0.5 s.                                                                                                                                                     |
| `grid_track3x3`       | `grid_1fps` plus a 3x3 grid of motion digits per 0.5 s, such as `[0:01.5] 000\|072\|010`.                                                                                                        |
| `grid_track3x3_cam`   | As above, plus the background shift per step, with the digits measured after cancelling it.                                                                                                      |

`native_1fps`, `native_8fps` and `native_24fps` send the clip itself to
Gemini's native `generateContent` endpoint, with `videoMetadata.fps` set on the
video part, as a baseline for how close the image conditions get to real video
input on the same model. Only the `gemini` provider takes them; other
providers skip them. Frames are sent at high media resolution, which Gemini
documents at about 280 tokens a frame (its default for video, and medium, is
about 70). `pricing.json` can give a measured `video_frame_tokens` per model.

## Running

From `experiments/motion/`:

```bash
uv sync --all-groups
uv run python make_clips.py
uv run python make_clips.py --hard
uv run python make_tempcompass.py
uv run python run.py --list-models --provider venice
uv run python run.py --dry-run --provider gemini --model gemini-3.5-flash-lite --clips all
```

The dry run renders every condition for the chosen clips into `out/renders/`
(one folder per clip and condition, with `prompt.txt` beside the images) and
prints the request count, image count and estimated tokens and cost, without
sending anything. Without `--model` it estimates every model in
`pricing.json` for the chosen providers.

A pilot on a balanced subset, then a full run, then the scores:

```bash
uv run python run.py --provider gemini --model gemini-3.5-flash-lite --clips 12
uv run python run.py --provider gemini --model gemini-3.5-flash-lite --clips all
uv run python score.py
```

`--clips 12` takes clips round-robin across the kinds, each with its reversed
copy, so a pilot still measures reverse consistency. `--conditions` takes a
comma-separated list. `--set` picks `synthetic` (the default), `hard`,
`tempcompass` or `all`.

API keys come from `VENICE_API_KEY`, `GEMINI_API_KEY` and `OPENAI_API_KEY`. On
Windows a key missing from the process environment is read from the user
environment in the registry, so a shell opened before the key was set still
finds it. A provider without a key is skipped with a message. Keys are never
printed or written to disk.

## Cost controls

- A real run needs a price for the model in `pricing.json`, and refuses to
  start without one.
- Before each request it adds a worst-case estimate (input padded by half, plus
  the full `max_tokens` of output) to the provider's ledger total, and stops if
  that would pass `--budget-usd` (4 dollars per provider by default).
- Every paid response is appended to `out/ledger.jsonl` with its token usage
  and cost, and the running total is printed after each request.
- Every response is cached in `out/cache/`, keyed by provider, model,
  condition, clip and prompt, so a rerun never pays twice.

## Results

`score.py` writes `out/results.md` with a section per set. Each has accuracy per
model and condition, the gain over `single_frame` and the estimated cost per
correct answer. The synthetic and hard sections add accuracy per question type,
reverse consistency (whether a direction answer flips on the reversed copy),
the false-motion rate on static clips and over- and under-counting. The
TempCompass section adds accuracy per dimension and each dimension's chance
level.
