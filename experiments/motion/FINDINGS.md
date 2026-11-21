# Motion experiment findings, 2026-11-21

First round. Total spend $12.01: Gemini $4.92, Venice $4.52, OpenAI $2.57. Full tables are in `out/results.md` (run `uv run python score.py` to rebuild them).

## What was tested

Three clip sets:

- **Synthetic:** 48 clips (24 designs plus reversed copies) with exact ground truth.
- **Hard:** 22 synthetic clips with shake, noise, blur, flicker, low contrast and distractors.
- **TempCompass:** 90 real-footage questions (30 direction, 30 speed, 30 order), internal use only.

Each clip was shown as a single frame (control), a vid2grid grid at 1 fps, a 16-frame burst, ghost trails, thin path lines, an onion-skin blend, a change map, grids plus a motion text track (one number, 3x3, 3x3 plus camera shift), the same 1 fps frames as separate images, and on Gemini the clip itself as native video at 1, 8 and 24 fps.

Models: Gemini 3.1 Flash Lite, Gemini 3 Flash (synthetic only, as the budget ran out), gpt-4.1-mini, gpt-5-mini, Qwen3-VL 235B, and Claude Sonnet 5.5 through Venice (32 of 48 synthetic clips, stopped for cost).

Groups are small (90 real questions, 30 per dimension), so differences under about 8 points are noise.

## Main results

**1. On real footage, separate frames beat the packed grid.** Same frames, same times:

| Model | single frame | grid 1 fps | separate frames 1 fps | native video 1 fps |
| --- | --- | --- | --- | --- |
| Gemini 3.1 Flash Lite | 64% | 67% | 77% | 83% |
| gpt-4.1-mini | 43% | 54% | 62% | n/a |
| gpt-5-mini | 50% | 64% | 68% | n/a |

Correction after review: the grid's gain over a single frame on real footage is almost all on order questions. Pooled over Flash Lite and gpt-5-mini, joined order clips go from 42% to 79% (14 more right answers out of 38), while the clips that are neither joined order nor reversed direction go from 67% to 63%.

Caveat: this harness capped images at 1024 px, so grid cells were about 250 px, half what vid2grid's usual 2048 px sheets give. The gap may shrink at 2048. Separate frames also cost about 6 times as much per correct answer on Gemini ($0.0042 against $0.0007), while native video at 1 fps cost $0.0012 and scored best.

**2. Overlays hurt on real footage.** Trails, path lines, onion-skin and change maps all scored at or below the single-frame control on TempCompass (40 to 58%). The blob tracker behind the path lines follows legs, hands and watermarks on real video. On clean synthetic clips path lines did beat the grid (Flash Lite 84% against 78%, gpt-4.1-mini 78% against 72%).

Correction after review: onion-skin and change maps failed just as badly with no tracker at all, so the tracker was not the shared cause. The format was: every overlay condition replaced the grid with one final frame plus one composite spanning the whole clip, fitted to 1024 px. A final frame can never show what came first in the 19 joined order clips (overlays pooled over all four models scored 27% there, the grid 72%), it is often empty once the subject has left, and whole-clip composites on a moving camera turn into posterised colour. Round two retests overlays with these fixed.

**3. The 3x3 motion track with camera shift helps on clean video, not yet on messy video.** Synthetic: best or near best for every mid-size model (Flash Lite 91% against 78% for the plain grid, gpt-4.1-mini 81% against 72%, gpt-5-mini 88% against 80%). Hard clips: no gain or a loss, because shake, noise and flicker light up every cell. Real footage: neutral (gpt-4.1-mini +5, others 0 to -8). A noise-adaptive threshold and brightness normalisation are the obvious next step.

**4. More native frames did not help.** Gemini native video at 8 and 24 fps scored the same or lower than 1 fps on every set (TempCompass 83% at 1 fps, 76% at 8 fps). Gemini really does take the frames (token counts scale exactly with fps), so this is the model, not the API.

**5. Strong models saturate the synthetic set.** Claude Sonnet scored 91 to 100% on every multi-frame condition and Gemini 3 Flash 81 to 95%. The synthetic set only separates mid-size models. Real footage is the set that matters.

**6. Bursts were mixed against the 1 fps grid** on these short clips: a few points better for gpt-5-mini and Gemini 3 Flash, worse for gpt-4.1-mini. Research suggests density matters more on faster motion than these clips contain.

## What this suggests for vid2grid

- Test grid sheets at 2048 px against separate frames before drawing conclusions about packing. If the gap holds, a "frames" output (one image per moment, stamped) is worth adding beside grids, for models with a generous image budget.
- Do not build trails, onion-skin or change maps into the product yet.
- A motion text track is cheap and helps on clean video. Make it robust to noise and camera shake before shipping it.
- For Gemini, native video at 1 fps is the strongest and cheap. The chat app could send the clip natively to Gemini models instead of sheets.

## Next round ideas

- Grid at 2048 px and grids with fewer, larger cells, against separate frames.
- Noise-robust motion track; then retest on hard and TempCompass.
- Gemini 3 Flash and a Claude model on TempCompass (the budget ran out before these).
- The agent question from the plan: with a motion tool available, does the model call it when it should?

# Round two, 2026-11-21

Spend from the ledger, tagged by round: round two $3.89 of a $5.00 cap (Gemini $1.56 of $2.00, OpenAI $0.67 of $1.25, Venice $1.66 of $1.75), plus the refined overlay test $0.82 of its own $1.00 (Gemini $0.48 of $0.50, OpenAI $0.35 of $0.50). That includes about $0.04 of billing probes and $0.02 of Gemini requests paid twice when two run chains briefly overlapped. Round one's cached answers were reused wherever the condition was unchanged, so `frames_1fps` for Flash Lite and gpt-5-mini cost nothing. Tables are in the "Round two" part of `out/results.md`.

## What was run

- **TempCompass, Gemini 3.1 Flash Lite and gpt-5-mini:** `grid_2048`, `grid_2048_large` (at most 4 frames to a sheet, same frame times), `frames_1fps` (round one's), and the noise-robust track on round one's 1024 px grid, with and without camera shift (`grid_track3x3_v2`, `grid_track3x3_cam_v2`).
- **Hard set, the same two models:** the two v2 track conditions, against round one's grid and tracks.
- **Refined overlays on TempCompass, the same two models:** `grid_2048_lines` (the 2048 grid plus path panels), `window_frames` (the plain frames under the overlays, as the matched control), `trail_lines_v2` and `trail_ghosts_v2`.
- **TempCompass, Gemini 3 Flash:** `grid_2048`, `frames_1fps`, `native_1fps`.
- **TempCompass, Claude Sonnet 5.5 through Venice:** `grid_2048` on all 90; `frames_1fps` and `grid_1fps` on the 44 clips with at most 10 frames, because Venice caps Claude at 10 images a request.

Dropped for budget or limits: `frames_1fps` on Claude for the 46 clips with 11 to 16 frames, and every other Claude condition. Nothing planned for Gemini or OpenAI was dropped.

How each provider bills a 2048 px sheet (measured): Gemini bills every image at about 1090 tokens at its default resolution, which is the same as HIGH, whether the sheet is 1024 or 2048 px. Only the per-image ULTRA_HIGH level, on the native endpoint, gives a 2048 sheet more (about 2210 tokens), so round two sends Gemini's 2048 sheets that way. gpt-5-mini counts 32 px patches at about 1.2 tokens each with no cap, so a 2048 px square costs about 4900 tokens; `detail: original` bills the same. Claude through Venice bills a 2048 px square at about 4800 tokens. Venice also adds about 2700 tokens of its own system prompt to every request, which round two turns off with `include_venice_system_prompt: false`.

Groups stay small: 90 TempCompass questions per model and condition (15 reversed direction, 19 joined order), and 100 answers per model and condition on the hard set. Per model, differences under about 8 points are noise; pooled over two models (180 answers) under about 6.

## Question 1: was it the 1024 px cap?

No. Doubling the sheet to 2048 px did not help either mid-size model, but fewer, larger cells closed most of the gap.

| Model | grid 1024 | grid 2048 | grid 2048, 4 a sheet | separate frames | native 1 fps |
| --- | --- | --- | --- | --- | --- |
| Gemini 3.1 Flash Lite | 67% | 60% | 74% | 77% | 83% |
| gpt-5-mini | 64% | 64% | 63% | 68% | n/a |
| Pooled, those two | 66% | 62% | 69% | 72% | n/a |
| Gemini 3 Flash | n/a | 86% | n/a | 80% | 76% |
| Claude Sonnet 5.5 | 84%* | 84% | n/a | 82%* | n/a |

\* on the 44 clips with at most 10 frames; Claude's `grid_2048` on those same 44 is 82%.

Cost per correct answer:

| Model | grid 1024 | grid 2048 | grid 2048, 4 a sheet | separate frames | native 1 fps |
| --- | --- | --- | --- | --- | --- |
| Gemini 3.1 Flash Lite | $0.0007 | $0.0013 | $0.0025 | $0.0042 | $0.0012 |
| gpt-5-mini | $0.0008 | $0.0022 | $0.0060 | $0.0020 | n/a |
| Gemini 3 Flash | n/a | $0.0033 | n/a | $0.0097 | $0.0031 |
| Claude Sonnet 5.5 | $0.0056* | $0.0134 | n/a | $0.0110* | n/a |

- For the mid-size models the gap between one packed sheet and separate frames is 4 to 10 points, at the edge of noise, and resolution alone does not close it: gpt-5-mini sees the full 2048 px sheet and scores exactly what it scored at 1024. Flash Lite's 7 point drop at 2048 is within noise for one model, but both models lost ground on joined order clips at 2048 (pooled 79% at 1024, 61% at 2048), which is worth a look before shipping larger sheets.
- Fewer, larger cells nearly match separate frames on Flash Lite (74% against 77%) at 57% of the tokens. On gpt-5-mini, which bills by pixel, four sheets cost three times the frames and gained nothing.
- Stronger models do not show the packing penalty at all. Gemini 3 Flash scored 86% on one 2048 sheet against 80% on separate frames and 76% on native video, at a third of the frames' cost per correct answer. Claude Sonnet scored 84% on the 1024 grid, 82% on the 2048 grid and 82% on frames over the same 44 clips.

## Question 2: does a noise-robust 3x3 track help?

The v2 track removes the camera shift by phase correlation, matches brightness per channel against the earlier frame, cuts each pixel at three robust sigmas of that step's difference, and sets the 0 level from the clip's own quiet cells (median plus 3 MADs, with a floor). It was tuned on the synthetic and hard clips only, never on TempCompass. With the camera variant, the bg shift is reported from 12 px per step.

On shaky synthetic footage it now helps; on real footage it does not.

| Set and model | grid | 3x3 | 3x3 + camera | v2 | v2 + camera |
| --- | --- | --- | --- | --- | --- |
| Hard, Flash Lite | 80% | 77% | 78% | 80% | 87% |
| Hard, gpt-5-mini | 81% | 77% | 71% | 83% | 89% |
| TempCompass, Flash Lite | 67% | 67% | 66% | 67% | 58% |
| TempCompass, gpt-5-mini | 64% | 64% | 61% | 54% | 61% |
| TempCompass, pooled | 66% | 66% | 63% | 61% | 59% |

- Hard set: v2 with camera shift beats the plain grid by 7 and 8 points and round one's camera track by 9 and 18. Almost all of it is the background question (95% for both models, against 77% for the grid and 68% and 41% for round one's track), so the robust shift estimate is what works; the cell digits alone (v2 without camera) are level with the grid. Reverse consistency rose too (86% against 55% for round one's camera track).
- TempCompass: no gain for either variant, and the camera variant scored 33% pooled on the 18 camera direction answers against 56% for the plain grid. On those clips 96 of 123 track steps say "bg none": real camera moves (slow pans, zooms, tilts with parallax) mostly fall under the 12 px step or are not a single shift, while the frames show the move. The likely result is that the model trusts the text over the frames. All of these are within noise except that camera subgroup, which is small.

## Refined overlays

Rebuilt after round one's review. A pyramidal Lucas-Kanade point tracker (OpenCV) with a forward-backward check, camera motion removed by a RANSAC similarity fitted to all tracks, screen-fixed points such as watermarks dropped, coherent movers clustered into at most 3, drawn as thin lines coloured yellow to green to purple (no red or blue, which the synthetic questions use for ball names) with a dot every 0.25 s and an arrowhead. Ghosts are up to 3 camera-aligned moments at 45% tint over the real pixels, and a window where more than 15% of the frame moved gets no ghosts, which the prompt says. Each overlay covers about 1 s, with 2 to 4 windows spread over the clip and none crossing a detected cut, and every panel is sent at full size. Sample renders are in `out/renders/<clip>/<condition>/` for every TempCompass clip, for example `tc_direction_1059462749/trail_lines_v2/lines_02.jpg` and `trail_ghosts_v2/ghosts_02.jpg`.

| Condition | Flash Lite | gpt-5-mini | Pooled | Pooled, reversed direction | Pooled, joined order |
| --- | --- | --- | --- | --- | --- |
| grid 2048 | 60% | 64% | 62% | 50% | 61% |
| grid 2048 plus path panels | 68% | 61% | 64% | 63% | 66% |
| window frames (control) | 66% | 62% | 64% | 47% | 76% |
| frames plus path lines | 69% | 69% | 69% | 70% | 79% |
| frames plus ghosts | 64% | 64% | 64% | 50% | 79% |

Direction split by whether the question or its options mention the camera, pooled: path lines 67% on camera questions (18) and 69% on object questions (42); the plain window frames 67% and 52%.

- Path lines now help, against their own matched control: 69% against 64% pooled, and 70% against 47% on the 30 reversed direction answers, the only direction answers that test vision rather than language priors. That is the best reversed direction score of any condition in either round (separate frames 67%, the 1024 grid 57%). Round one's path lines scored 48% pooled.
- Added to the grid, path panels gave Flash Lite +8 and gpt-5-mini -3, so +2 pooled, which is noise; on reversed direction it was +13 pooled, on 30 answers.
- Ghosts did not help: level with their control everywhere.
- Cost per correct answer for path lines was $0.0018 on Flash Lite and $0.0011 on gpt-5-mini, against $0.0017 and $0.0008 for the plain window frames.

## What this means for vid2grid

- Keep the packed grid as the default. Its penalty against separate frames is a few points on mid-size models, gone on stronger ones, and it is the cheapest format per correct answer everywhere except Gemini native video.
- Do not raise the sheet size to fix it: 2048 px did not beat 1024 px, and on Gemini it costs double only at ultra-high resolution, which the default request never uses. An option for fewer frames a sheet is the better lever, and only for providers that bill per image (Gemini), not per pixel (OpenAI, Claude).
- For Gemini 3.1 Flash Lite, native video at 1 fps is still best and cheap; for Gemini 3 Flash a 2048 sheet beat native video, so routing by model would need testing per model.
- The v2 track's camera shift is worth keeping for shaky footage, but not on real footage until camera estimation covers slow pans and zooms. Its noise handling fixed the hard set, not TempCompass.
- Tracked path lines are the first overlay that pays its way on real footage, mostly on direction. Worth a further round as a supplement panel before any product work; ghosts are not.
