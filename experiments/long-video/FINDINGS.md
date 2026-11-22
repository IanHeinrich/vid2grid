# Long-video phase 0 findings (model half)

The question: how should the chat app's overview be shaped for a 30 to 60 minute video? Does transcript text close the gap? Is resending the overview on later turns worth what it costs? Do frames picked from a no-decode scene measure beat evenly spaced frames?

The test set is the 90 Video-MME "long" questions on the 30 videos picked for phase 0, three per video. The videos run 31 to 59 minutes, 20.1 hours in all. Every question has four options, so chance is 25%. Two models answered: Qwen3-VL 235B through Venice, without Venice's system prompt, and Gemini 3.1 Flash Lite through Google's OpenAI-compatible endpoint at its default media resolution. Sheets came from the vid2grid Python library at 2048 px. The full tables are in `out/results.md`. The speed and memory baselines are in `baselines/RESULTS.md`.

## Spend

| provider | requests | spent | cap |
| --- | --- | --- | --- |
| venice | 1106 | $4.994 | $5.00 |
| gemini | 951 | $2.905 | $4.00 |

Both figures come from the ledger. One Venice request may have been billed and not logged: the Venice chain was stopped by hand once, with a request in flight, so the scene test could run question by question. It would have cost about $0.003.

## What ran and what was cut

- Every condition ran in full on Venice except pinning.
- On Gemini, every layout ran in full, with and without the transcript.
- The dry run put Venice at $5.50 against its $5.00 cap, so pinning ran last on what was left. That covered 5 of the 30 videos, so 10 scored turns per variant.
- Gemini's dry run fitted its cap ($3.55 of $3.98), so everything was queued. Partway through the scene test, the account's prepaid credits ran out. Every request after that returned HTTP 402 and was not billed. So the scene test has 24 scene and 27 even answers on Gemini, 19 of them paired, and Gemini ran no pinning. This was the account's balance, not the harness's cap.
- Gemini returned an empty reply for all six `s4x9` and `s4x9_t` requests on one video, most likely a content block on those sheets. They count as wrong. Three of them fall in the `s4x9_t` comparisons.
- One video has no subtitles. Its transcript conditions say so and carry no text.

## How much 90 questions can tell

A paired test only counts questions whose answer changed between two conditions. Most comparisons here changed 5 to 25 answers. At that size one model needs a gap of about 8 to 12 points to reach p < 0.05, and the two models pooled about 5 to 7. The pooled p is optimistic, since both models answer the same questions. Treat any gap under 8 points on one model as noise.

## Results

**1. Every image layout beats the blind control, and so does the transcript.** Blind is 41% on Qwen and 56% on Gemini, well above chance, so a fair share of these questions can be guessed from their wording.

| pooled, 180 pairs | blind | condition | fixed | broke | p |
| --- | --- | --- | --- | --- | --- |
| transcript | 48% | 76% | 57 | 8 | <0.001 |
| `s4x20` | 48% | 71% | 50 | 10 | <0.001 |
| `s4x9` | 48% | 72% | 52 | 10 | <0.001 |
| `s8x9` | 48% | 74% | 57 | 10 | <0.001 |
| `f10` | 48% | 63% | 42 | 16 | 0.001 |

On Gemini alone, `f10` against blind is +9 points (20 fixed, 12 broke, p = 0.22), so not shown to help.

**2. Ten single frames lose to sheets.** Without the transcript, `f10` is 8 to 12 points under every sheet layout. Pooled: 9 fixed and 23 broke against `s4x20` (p = 0.02), 9 and 30 against `s8x9` (p = 0.001). Each model alone points the same way; Qwen reaches p < 0.05 against all three sheet layouts. Single frames also cost more tokens than `s4x20` on both providers.

**3. The sheet layouts are close to each other.** `s4x20`, `s4x9` and `s8x9` score 70% to 77% without the transcript on both models. No pair differs reliably. `s8x9` is 4 points over `s4x20` pooled (15 fixed, 8 broke, p = 0.21) for twice the images.

**4. With the transcript, `s4x20` comes out on top.** `s4x20_t` scored 81% on Qwen and 89% on Gemini, the best figure on each.

| pooled, 180 pairs | baseline | condition | fixed | broke | p |
| --- | --- | --- | --- | --- | --- |
| `s4x9_t` vs `s4x20_t` | 85% | 79% | 0 | 10 | 0.002 |
| `s8x9_t` vs `s4x20_t` | 85% | 82% | 2 | 7 | 0.18 |
| `f10_t` vs `s4x20_t` | 85% | 79% | 1 | 11 | 0.006 |

Three of the ten `s4x9_t` losses are Gemini's empty replies. So the honest reading is that `s4x20_t` beats `f10_t`, probably beats `s4x9_t`, and ties `s8x9_t` at half the images.

**5. The transcript adds to every layout, most to the sparse ones.** Pooled, it adds 14 points to `s4x20` (30 fixed, 4 broke) and 17 to `f10` (38 fixed, 8 broke), both p < 0.001. It adds 8 points to `s4x9` and to `s8x9` (p = 0.03 and 0.02).

**6. The transcript alone nearly matches the best image layout, but not quite.** Transcript alone is 72% on Qwen and 79% on Gemini, level with or above every image layout without it. Adding `s4x20` to the transcript still gains 9 points pooled (20 fixed, 3 broke, p < 0.001), and gains on each model alone (p = 0.02 on both). Adding `f10` or `s4x9` gains 3 to 4 points, within noise.

**7. Scene picks did not beat even spacing.** On Qwen, with all 90 pairs, `scene4x20` scored 69% against 70% for `even4x20` (4 fixed, 5 broke, p = 1.0). Gemini's 19 pairs went 2 to 0 for scene, which is noise. The renderer check held too: `even4x20`, the harness's own grid, matched the library's `s4x20` on the same frames (Qwen 70% against 71%, 2 fixed, 3 broke). The demux pass behind the scene picks is cheap: 0.33 s per video on average, 0.83 s at most, about 0.5 s per hour of video.

**8. Pinning: no accuracy signal, a large cost signal.** On the 5 Venice videos that ran, pinned and stubbed got the same 9 of 10 later turns right. That says nothing either way. The cost side is exact. On Qwen a stubbed turn sent about 11,700 input tokens against about 27,900 pinned, 58% less: $0.0025 a turn against $0.0059. The images are about 16,400 of those tokens on Qwen, which bills by pixel. Gemini bills each image at about 1,100 tokens, so there four sheets would add about 4,400 tokens a turn.

**9. Where the gains land.** Without images, Qwen gets 18% of the 17 perception questions right, below chance. Any sheet layout lifts that to 59% to 71%, while `f10` reaches only 41% on both models. Reasoning questions (48) gain most from the transcript. On Gemini, Life Record questions (21) go from 48% with `s4x20` to 95% with `s4x20_t`, and Film and Television (12) is the only group where the transcript alone is weak (42%). These groups are small, so read them as hints.

## Tokens and cost per correct answer

| condition | Qwen tokens | Qwen per correct | Gemini tokens | Gemini per correct |
| --- | --- | --- | --- | --- |
| `transcript` | 10,815 | $0.0032 | 10,952 | $0.0038 |
| `s4x20` | 16,691 | $0.0049 | 4,652 | $0.0019 |
| `s4x20_t` | 27,364 | $0.0071 | 15,467 | $0.0047 |
| `s8x9_t` | 43,850 | $0.0114 | 19,917 | $0.0066 |
| `f10_t` | 34,097 | $0.0094 | 22,177 | $0.0074 |

On Gemini, four sheets cost less than the transcript. On Qwen, the transcript is the cheapest route to a right answer.

## What this means for vid2grid

- **Overview shape at a 10-image cap: four sheets of 20 frames.** `s4x20` ties `s8x9` without the transcript and leads it with one, at half the images and tokens. Fewer, larger cells (`s4x9`) gained nothing. Ten single frames are clearly worse and cost more. Leave the spare image slots for zoomed-in looks.
- **Transcript text does not close the gap on its own, but it carries most of it.** Transcript alone beats every image layout alone on these questions. Sheets plus transcript beat both, by about 9 points over transcript alone. The overview should always ship with the transcript when there is one.
- **Pin or stub: stub.** Ten paired turns show no accuracy difference, which is too few to rule one out. The cost is not in doubt: stubbing cut a later turn's input by 58% on Qwen. To prove stubbing does not hurt, a later round needs the full 60 paired turns per model, about $0.66 on Venice plus a topped-up Gemini account.
- **Zero-decode scene picks: not worth a phase 6 index on this evidence.** On the one model with a full run they scored the same as even spacing. The demux pass is cheap enough to keep as an option, but there is no accuracy gain here to build an index around. A different rule might still help on videos with long static stretches; this sample does not show it.

This is one sample of 90 questions and two models. The large effects hold on both models and survive the paired test: images or transcript over blind, the transcript added to sheets, and sheets over single frames. The differences between sheet layouts, the scene test and pinning accuracy are within noise.
