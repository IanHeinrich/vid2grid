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

Caveat: this harness capped images at 1024 px, so grid cells were about 250 px, half what vid2grid's usual 2048 px sheets give. The gap may shrink at 2048. Separate frames also cost about 6 times as much per correct answer on Gemini ($0.0042 against $0.0007), while native video at 1 fps cost $0.0012 and scored best.

**2. Overlays hurt on real footage.** Trails, path lines, onion-skin and change maps all scored at or below the single-frame control on TempCompass (40 to 58%). The blob tracker behind the path lines follows legs, hands and watermarks on real video. On clean synthetic clips path lines were good (75 to 84%), so the idea needs a real point tracker before it is worth building.

**3. The 3x3 motion track with camera shift helps on clean video, not yet on messy video.** Synthetic: best or near best for every mid-size model (Flash Lite 91% against 78% for the plain grid, gpt-4.1-mini 81% against 72%, gpt-5-mini 88% against 80%). Hard clips: no gain or a loss, because shake, noise and flicker light up every cell. Real footage: neutral (gpt-4.1-mini +5, others 0 to -8). A noise-adaptive threshold and brightness normalisation are the obvious next step.

**4. More native frames did not help.** Gemini native video at 8 and 24 fps scored the same or lower than 1 fps on every set (TempCompass 83% at 1 fps, 76% at 8 fps). Gemini really does take the frames (token counts scale exactly with fps), so this is the model, not the API.

**5. Strong models saturate the synthetic set.** Claude Sonnet scored 99 to 100% on almost every condition and Gemini 3 Flash 94 to 98%. The synthetic set only separates mid-size models. Real footage is the set that matters.

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
