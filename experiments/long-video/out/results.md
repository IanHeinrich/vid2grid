# Long-video phase 0 results

90 Video-MME long questions on 30 videos, 2057 responses. Only aggregates and question ids appear here.

## Spend

| round | provider | requests | spent |
| --- | --- | --- | --- |
| p0 | gemini | 951 | $2.9045 |
| p0 | venice | 1106 | $4.9937 |

## What this sample can detect

What 90 paired questions can detect. A difference needs a lopsided split of the questions that changed answer: the table gives the smallest net gain (fixed minus broke) that reaches p < 0.05 for a given number of changed questions, and what that is in accuracy points on one model (90) or pooled (180). Most comparisons here changed 5 to 25 answers, so one model needs a gap of about 8 to 12 points and the pooled figures about 5 to 7; anything smaller reads as noise.

| changed questions | smallest net gain | on 90 | on 180 |
| --- | --- | --- | --- |
| 6 | 6 | 7 pts | 3 pts |
| 10 | 8 | 9 pts | 4 pts |
| 15 | 9 | 10 pts | 5 pts |
| 20 | 10 | 11 pts | 6 pts |
| 30 | 12 | 13 pts | 7 pts |
| 40 | 14 | 16 pts | 8 pts |

## Accuracy, tokens and cost

Input tokens are the mean prompt tokens per request as billed. Chance is 25%. For pinned and stubbed, only turns 2 and 3 are counted; turn 1 is listed as pinning.

| model | condition | accuracy | input tokens | spent | per correct | unparsed |
| --- | --- | --- | --- | --- | --- | --- |
| gemini/gemini-3.1-flash-lite | blind | 56% (50/90) | 148 | $0.020 | $0.0004 | 0 |
| gemini/gemini-3.1-flash-lite | transcript | 79% (71/90) | 10,952 | $0.271 | $0.0038 | 0 |
| gemini/gemini-3.1-flash-lite | s4x20 | 70% (63/90) | 4,652 | $0.120 | $0.0019 | 0 |
| gemini/gemini-3.1-flash-lite | s4x20_t | 89% (80/90) | 15,467 | $0.378 | $0.0047 | 0 |
| gemini/gemini-3.1-flash-lite | s4x9 | 73% (66/90) | 4,648 | $0.121 | $0.0018 | 3 |
| gemini/gemini-3.1-flash-lite | s4x9_t | 80% (72/90) | 15,463 | $0.384 | $0.0053 | 3 |
| gemini/gemini-3.1-flash-lite | s8x9 | 77% (69/90) | 9,102 | $0.221 | $0.0032 | 0 |
| gemini/gemini-3.1-flash-lite | s8x9_t | 83% (75/90) | 19,917 | $0.494 | $0.0066 | 0 |
| gemini/gemini-3.1-flash-lite | f10 | 64% (58/90) | 11,362 | $0.277 | $0.0048 | 0 |
| gemini/gemini-3.1-flash-lite | f10_t | 82% (74/90) | 22,177 | $0.549 | $0.0074 | 0 |
| gemini/gemini-3.1-flash-lite | scene4x20 | 71% (17/24) | 4,669 | $0.032 | $0.0019 | 0 |
| gemini/gemini-3.1-flash-lite | even4x20 | 70% (19/27) | 4,668 | $0.036 | $0.0019 | 0 |
| venice/qwen3-vl-235b-a22b | blind | 41% (37/90) | 152 | $0.004 | $0.0001 | 0 |
| venice/qwen3-vl-235b-a22b | transcript | 72% (65/90) | 10,815 | $0.206 | $0.0032 | 0 |
| venice/qwen3-vl-235b-a22b | s4x20 | 71% (64/90) | 16,691 | $0.317 | $0.0049 | 0 |
| venice/qwen3-vl-235b-a22b | s4x20_t | 81% (73/90) | 27,364 | $0.518 | $0.0071 | 0 |
| venice/qwen3-vl-235b-a22b | s4x9 | 70% (63/90) | 16,687 | $0.317 | $0.0050 | 0 |
| venice/qwen3-vl-235b-a22b | s4x9_t | 79% (71/90) | 27,359 | $0.518 | $0.0073 | 0 |
| venice/qwen3-vl-235b-a22b | s8x9 | 72% (65/90) | 33,177 | $0.628 | $0.0097 | 0 |
| venice/qwen3-vl-235b-a22b | s8x9_t | 81% (73/90) | 43,850 | $0.830 | $0.0114 | 0 |
| venice/qwen3-vl-235b-a22b | f10 | 61% (55/90) | 23,425 | $0.444 | $0.0081 | 0 |
| venice/qwen3-vl-235b-a22b | f10_t | 77% (69/90) | 34,097 | $0.646 | $0.0094 | 0 |
| venice/qwen3-vl-235b-a22b | scene4x20 | 69% (62/90) | 11,826 | $0.225 | $0.0036 | 0 |
| venice/qwen3-vl-235b-a22b | even4x20 | 70% (63/90) | 11,826 | $0.225 | $0.0036 | 0 |
| venice/qwen3-vl-235b-a22b | pinning | 67% (4/6) | 26,444 | $0.033 | $0.0083 | 0 |
| venice/qwen3-vl-235b-a22b | pinned | 90% (9/10) | 27,931 | $0.059 | $0.0065 | 0 |
| venice/qwen3-vl-235b-a22b | stubbed | 90% (9/10) | 11,736 | $0.025 | $0.0028 | 0 |

## Paired comparisons

Each row pairs the same questions under a baseline and a condition. Fixed counts questions the condition got right and the baseline wrong; broke counts the reverse. p is the exact two-sided McNemar test on those two counts. Pooled stacks both models' pairs, so it has up to twice the questions. The two models' answers on one question are not independent, so a pooled p is optimistic.

### Each layout and the transcript against blind

| model | comparison | n | baseline | condition | diff | fixed | broke | p |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gemini/gemini-3.1-flash-lite | transcript vs blind | 90 | 56% (50/90) | 79% (71/90) | +23 pts | 26 | 5 | 0.000 |
| venice/qwen3-vl-235b-a22b | transcript vs blind | 90 | 41% (37/90) | 72% (65/90) | +31 pts | 31 | 3 | 0.000 |
| pooled | transcript vs blind | 180 | 48% (87/180) | 76% (136/180) | +27 pts | 57 | 8 | 0.000 |
| gemini/gemini-3.1-flash-lite | s4x20 vs blind | 90 | 56% (50/90) | 70% (63/90) | +14 pts | 20 | 7 | 0.019 |
| venice/qwen3-vl-235b-a22b | s4x20 vs blind | 90 | 41% (37/90) | 71% (64/90) | +30 pts | 30 | 3 | 0.000 |
| pooled | s4x20 vs blind | 180 | 48% (87/180) | 71% (127/180) | +22 pts | 50 | 10 | 0.000 |
| gemini/gemini-3.1-flash-lite | s4x9 vs blind | 90 | 56% (50/90) | 73% (66/90) | +18 pts | 22 | 6 | 0.004 |
| venice/qwen3-vl-235b-a22b | s4x9 vs blind | 90 | 41% (37/90) | 70% (63/90) | +29 pts | 30 | 4 | 0.000 |
| pooled | s4x9 vs blind | 180 | 48% (87/180) | 72% (129/180) | +23 pts | 52 | 10 | 0.000 |
| gemini/gemini-3.1-flash-lite | s8x9 vs blind | 90 | 56% (50/90) | 77% (69/90) | +21 pts | 26 | 7 | 0.001 |
| venice/qwen3-vl-235b-a22b | s8x9 vs blind | 90 | 41% (37/90) | 72% (65/90) | +31 pts | 31 | 3 | 0.000 |
| pooled | s8x9 vs blind | 180 | 48% (87/180) | 74% (134/180) | +26 pts | 57 | 10 | 0.000 |
| gemini/gemini-3.1-flash-lite | f10 vs blind | 90 | 56% (50/90) | 64% (58/90) | +9 pts | 20 | 12 | 0.215 |
| venice/qwen3-vl-235b-a22b | f10 vs blind | 90 | 41% (37/90) | 61% (55/90) | +20 pts | 22 | 4 | 0.001 |
| pooled | f10 vs blind | 180 | 48% (87/180) | 63% (113/180) | +14 pts | 42 | 16 | 0.001 |

### Adding the transcript to each layout

| model | comparison | n | baseline | condition | diff | fixed | broke | p |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gemini/gemini-3.1-flash-lite | s4x20_t vs s4x20 | 90 | 70% (63/90) | 89% (80/90) | +19 pts | 18 | 1 | 0.000 |
| venice/qwen3-vl-235b-a22b | s4x20_t vs s4x20 | 90 | 71% (64/90) | 81% (73/90) | +10 pts | 12 | 3 | 0.035 |
| pooled | s4x20_t vs s4x20 | 180 | 71% (127/180) | 85% (153/180) | +14 pts | 30 | 4 | 0.000 |
| gemini/gemini-3.1-flash-lite | s4x9_t vs s4x9 | 90 | 73% (66/90) | 80% (72/90) | +7 pts | 12 | 6 | 0.238 |
| venice/qwen3-vl-235b-a22b | s4x9_t vs s4x9 | 90 | 70% (63/90) | 79% (71/90) | +9 pts | 13 | 5 | 0.096 |
| pooled | s4x9_t vs s4x9 | 180 | 72% (129/180) | 79% (143/180) | +8 pts | 25 | 11 | 0.029 |
| gemini/gemini-3.1-flash-lite | s8x9_t vs s8x9 | 90 | 77% (69/90) | 83% (75/90) | +7 pts | 11 | 5 | 0.210 |
| venice/qwen3-vl-235b-a22b | s8x9_t vs s8x9 | 90 | 72% (65/90) | 81% (73/90) | +9 pts | 12 | 4 | 0.077 |
| pooled | s8x9_t vs s8x9 | 180 | 74% (134/180) | 82% (148/180) | +8 pts | 23 | 9 | 0.020 |
| gemini/gemini-3.1-flash-lite | f10_t vs f10 | 90 | 64% (58/90) | 82% (74/90) | +18 pts | 20 | 4 | 0.002 |
| venice/qwen3-vl-235b-a22b | f10_t vs f10 | 90 | 61% (55/90) | 77% (69/90) | +16 pts | 18 | 4 | 0.004 |
| pooled | f10_t vs f10 | 180 | 63% (113/180) | 79% (143/180) | +17 pts | 38 | 8 | 0.000 |

### Adding each layout's images to the transcript

| model | comparison | n | baseline | condition | diff | fixed | broke | p |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gemini/gemini-3.1-flash-lite | s4x20_t vs transcript | 90 | 79% (71/90) | 89% (80/90) | +10 pts | 11 | 2 | 0.022 |
| venice/qwen3-vl-235b-a22b | s4x20_t vs transcript | 90 | 72% (65/90) | 81% (73/90) | +9 pts | 9 | 1 | 0.021 |
| pooled | s4x20_t vs transcript | 180 | 76% (136/180) | 85% (153/180) | +9 pts | 20 | 3 | 0.000 |
| gemini/gemini-3.1-flash-lite | s4x9_t vs transcript | 90 | 79% (71/90) | 80% (72/90) | +1 pts | 7 | 6 | 1.000 |
| venice/qwen3-vl-235b-a22b | s4x9_t vs transcript | 90 | 72% (65/90) | 79% (71/90) | +7 pts | 7 | 1 | 0.070 |
| pooled | s4x9_t vs transcript | 180 | 76% (136/180) | 79% (143/180) | +4 pts | 14 | 7 | 0.189 |
| gemini/gemini-3.1-flash-lite | s8x9_t vs transcript | 90 | 79% (71/90) | 83% (75/90) | +4 pts | 7 | 3 | 0.344 |
| venice/qwen3-vl-235b-a22b | s8x9_t vs transcript | 90 | 72% (65/90) | 81% (73/90) | +9 pts | 9 | 1 | 0.021 |
| pooled | s8x9_t vs transcript | 180 | 76% (136/180) | 82% (148/180) | +7 pts | 16 | 4 | 0.012 |
| gemini/gemini-3.1-flash-lite | f10_t vs transcript | 90 | 79% (71/90) | 82% (74/90) | +3 pts | 7 | 4 | 0.549 |
| venice/qwen3-vl-235b-a22b | f10_t vs transcript | 90 | 72% (65/90) | 77% (69/90) | +4 pts | 8 | 4 | 0.388 |
| pooled | f10_t vs transcript | 180 | 76% (136/180) | 79% (143/180) | +4 pts | 15 | 8 | 0.210 |

### Layouts against each other, no transcript

| model | comparison | n | baseline | condition | diff | fixed | broke | p |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gemini/gemini-3.1-flash-lite | s4x9 vs s4x20 | 90 | 70% (63/90) | 73% (66/90) | +3 pts | 9 | 6 | 0.607 |
| venice/qwen3-vl-235b-a22b | s4x9 vs s4x20 | 90 | 71% (64/90) | 70% (63/90) | -1 pts | 6 | 7 | 1.000 |
| pooled | s4x9 vs s4x20 | 180 | 71% (127/180) | 72% (129/180) | +1 pts | 15 | 13 | 0.851 |
| gemini/gemini-3.1-flash-lite | s8x9 vs s4x20 | 90 | 70% (63/90) | 77% (69/90) | +7 pts | 10 | 4 | 0.180 |
| venice/qwen3-vl-235b-a22b | s8x9 vs s4x20 | 90 | 71% (64/90) | 72% (65/90) | +1 pts | 5 | 4 | 1.000 |
| pooled | s8x9 vs s4x20 | 180 | 71% (127/180) | 74% (134/180) | +4 pts | 15 | 8 | 0.210 |
| gemini/gemini-3.1-flash-lite | f10 vs s4x20 | 90 | 70% (63/90) | 64% (58/90) | -6 pts | 7 | 12 | 0.359 |
| venice/qwen3-vl-235b-a22b | f10 vs s4x20 | 90 | 71% (64/90) | 61% (55/90) | -10 pts | 2 | 11 | 0.022 |
| pooled | f10 vs s4x20 | 180 | 71% (127/180) | 63% (113/180) | -8 pts | 9 | 23 | 0.020 |
| gemini/gemini-3.1-flash-lite | s8x9 vs s4x9 | 90 | 73% (66/90) | 77% (69/90) | +3 pts | 9 | 6 | 0.607 |
| venice/qwen3-vl-235b-a22b | s8x9 vs s4x9 | 90 | 70% (63/90) | 72% (65/90) | +2 pts | 5 | 3 | 0.727 |
| pooled | s8x9 vs s4x9 | 180 | 72% (129/180) | 74% (134/180) | +3 pts | 14 | 9 | 0.405 |
| gemini/gemini-3.1-flash-lite | f10 vs s4x9 | 90 | 73% (66/90) | 64% (58/90) | -9 pts | 7 | 15 | 0.134 |
| venice/qwen3-vl-235b-a22b | f10 vs s4x9 | 90 | 70% (63/90) | 61% (55/90) | -9 pts | 2 | 10 | 0.039 |
| pooled | f10 vs s4x9 | 180 | 72% (129/180) | 63% (113/180) | -9 pts | 9 | 25 | 0.009 |
| gemini/gemini-3.1-flash-lite | f10 vs s8x9 | 90 | 77% (69/90) | 64% (58/90) | -12 pts | 5 | 16 | 0.027 |
| venice/qwen3-vl-235b-a22b | f10 vs s8x9 | 90 | 72% (65/90) | 61% (55/90) | -11 pts | 4 | 14 | 0.031 |
| pooled | f10 vs s8x9 | 180 | 74% (134/180) | 63% (113/180) | -12 pts | 9 | 30 | 0.001 |

### Layouts against each other, with transcript

| model | comparison | n | baseline | condition | diff | fixed | broke | p |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gemini/gemini-3.1-flash-lite | s4x9_t vs s4x20_t | 90 | 89% (80/90) | 80% (72/90) | -9 pts | 0 | 8 | 0.008 |
| venice/qwen3-vl-235b-a22b | s4x9_t vs s4x20_t | 90 | 81% (73/90) | 79% (71/90) | -2 pts | 0 | 2 | 0.500 |
| pooled | s4x9_t vs s4x20_t | 180 | 85% (153/180) | 79% (143/180) | -6 pts | 0 | 10 | 0.002 |
| gemini/gemini-3.1-flash-lite | s8x9_t vs s4x20_t | 90 | 89% (80/90) | 83% (75/90) | -6 pts | 2 | 7 | 0.180 |
| venice/qwen3-vl-235b-a22b | s8x9_t vs s4x20_t | 90 | 81% (73/90) | 81% (73/90) | +0 pts | 0 | 0 | 1.000 |
| pooled | s8x9_t vs s4x20_t | 180 | 85% (153/180) | 82% (148/180) | -3 pts | 2 | 7 | 0.180 |
| gemini/gemini-3.1-flash-lite | f10_t vs s4x20_t | 90 | 89% (80/90) | 82% (74/90) | -7 pts | 0 | 6 | 0.031 |
| venice/qwen3-vl-235b-a22b | f10_t vs s4x20_t | 90 | 81% (73/90) | 77% (69/90) | -4 pts | 1 | 5 | 0.219 |
| pooled | f10_t vs s4x20_t | 180 | 85% (153/180) | 79% (143/180) | -6 pts | 1 | 11 | 0.006 |
| gemini/gemini-3.1-flash-lite | s8x9_t vs s4x9_t | 90 | 80% (72/90) | 83% (75/90) | +3 pts | 7 | 4 | 0.549 |
| venice/qwen3-vl-235b-a22b | s8x9_t vs s4x9_t | 90 | 79% (71/90) | 81% (73/90) | +2 pts | 2 | 0 | 0.500 |
| pooled | s8x9_t vs s4x9_t | 180 | 79% (143/180) | 82% (148/180) | +3 pts | 9 | 4 | 0.267 |
| gemini/gemini-3.1-flash-lite | f10_t vs s4x9_t | 90 | 80% (72/90) | 82% (74/90) | +2 pts | 6 | 4 | 0.754 |
| venice/qwen3-vl-235b-a22b | f10_t vs s4x9_t | 90 | 79% (71/90) | 77% (69/90) | -2 pts | 2 | 4 | 0.688 |
| pooled | f10_t vs s4x9_t | 180 | 79% (143/180) | 79% (143/180) | +0 pts | 8 | 8 | 1.000 |
| gemini/gemini-3.1-flash-lite | f10_t vs s8x9_t | 90 | 83% (75/90) | 82% (74/90) | -1 pts | 5 | 6 | 1.000 |
| venice/qwen3-vl-235b-a22b | f10_t vs s8x9_t | 90 | 81% (73/90) | 77% (69/90) | -4 pts | 1 | 5 | 0.219 |
| pooled | f10_t vs s8x9_t | 180 | 82% (148/180) | 79% (143/180) | -3 pts | 6 | 11 | 0.332 |

### Scene picks against even spacing

same frames, library sheet against own grid.

| model | comparison | n | baseline | condition | diff | fixed | broke | p |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gemini/gemini-3.1-flash-lite | scene4x20 vs even4x20 | 19 | 63% (12/19) | 74% (14/19) | +11 pts | 2 | 0 | 0.500 |
| venice/qwen3-vl-235b-a22b | scene4x20 vs even4x20 | 90 | 70% (63/90) | 69% (62/90) | -1 pts | 4 | 5 | 1.000 |
| pooled | scene4x20 vs even4x20 | 109 | 69% (75/109) | 70% (76/109) | +1 pts | 6 | 5 | 1.000 |
| gemini/gemini-3.1-flash-lite | even4x20 vs s4x20 | 27 | 67% (18/27) | 70% (19/27) | +4 pts | 2 | 1 | 1.000 |
| venice/qwen3-vl-235b-a22b | even4x20 vs s4x20 | 90 | 71% (64/90) | 70% (63/90) | -1 pts | 2 | 3 | 1.000 |
| pooled | even4x20 vs s4x20 | 117 | 70% (82/117) | 70% (82/117) | +0 pts | 4 | 4 | 1.000 |

### Pinned overview against stubs, turns 2 and 3

| model | comparison | n | baseline | condition | diff | fixed | broke | p |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| venice/qwen3-vl-235b-a22b | stubbed vs pinned | 10 | 90% (9/10) | 90% (9/10) | +0 pts | 0 | 0 | 1.000 |

## Pinning per turn

Each video's three questions as one conversation, with the s4x20 overview and the transcript in turn 1. Pinned resends the overview images every turn; stubbed replaces them with the chat app's text stubs from turn 2. Turn 1 is the same request for both.

| model | variant | turn | accuracy | input tokens | cost per turn |
| --- | --- | --- | --- | --- | --- |
| venice/qwen3-vl-235b-a22b | pinned | turn 1 (shared) | 67% (4/6) | 26,444 | $0.00557 |
| venice/qwen3-vl-235b-a22b | pinned | turn 2 | 100% (5/5) | 27,884 | $0.00587 |
| venice/qwen3-vl-235b-a22b | pinned | turn 3 | 80% (4/5) | 27,977 | $0.00589 |
| venice/qwen3-vl-235b-a22b | stubbed | turn 1 (shared) | 67% (4/6) | 26,444 | $0.00557 |
| venice/qwen3-vl-235b-a22b | stubbed | turn 2 | 100% (5/5) | 11,690 | $0.00247 |
| venice/qwen3-vl-235b-a22b | stubbed | turn 3 | 80% (4/5) | 11,782 | $0.00249 |

## Accuracy by task group

Groups under 10 questions are left out: counting.

| model | condition | reasoning (48) | synopsis (19) | perception (17) |
| --- | --- | --- | --- | --- |
| gemini/gemini-3.1-flash-lite | blind | 58% (28/48) | 68% (13/19) | 47% (8/17) |
| gemini/gemini-3.1-flash-lite | transcript | 88% (42/48) | 79% (15/19) | 65% (11/17) |
| gemini/gemini-3.1-flash-lite | s4x20 | 73% (35/48) | 74% (14/19) | 71% (12/17) |
| gemini/gemini-3.1-flash-lite | s4x20_t | 94% (45/48) | 89% (17/19) | 88% (15/17) |
| gemini/gemini-3.1-flash-lite | s4x9 | 73% (35/48) | 84% (16/19) | 71% (12/17) |
| gemini/gemini-3.1-flash-lite | s4x9_t | 92% (44/48) | 79% (15/19) | 76% (13/17) |
| gemini/gemini-3.1-flash-lite | s8x9 | 81% (39/48) | 79% (15/19) | 76% (13/17) |
| gemini/gemini-3.1-flash-lite | s8x9_t | 92% (44/48) | 84% (16/19) | 76% (13/17) |
| gemini/gemini-3.1-flash-lite | f10 | 75% (36/48) | 74% (14/19) | 41% (7/17) |
| gemini/gemini-3.1-flash-lite | f10_t | 92% (44/48) | 79% (15/19) | 76% (13/17) |
| gemini/gemini-3.1-flash-lite | scene4x20 | 70% (7/10) | 57% (4/7) | 83% (5/6) |
| gemini/gemini-3.1-flash-lite | even4x20 | 75% (9/12) | 67% (4/6) | 75% (6/8) |
| venice/qwen3-vl-235b-a22b | blind | 52% (25/48) | 42% (8/19) | 18% (3/17) |
| venice/qwen3-vl-235b-a22b | transcript | 79% (38/48) | 79% (15/19) | 65% (11/17) |
| venice/qwen3-vl-235b-a22b | s4x20 | 73% (35/48) | 84% (16/19) | 65% (11/17) |
| venice/qwen3-vl-235b-a22b | s4x20_t | 85% (41/48) | 84% (16/19) | 82% (14/17) |
| venice/qwen3-vl-235b-a22b | s4x9 | 69% (33/48) | 84% (16/19) | 59% (10/17) |
| venice/qwen3-vl-235b-a22b | s4x9_t | 83% (40/48) | 84% (16/19) | 76% (13/17) |
| venice/qwen3-vl-235b-a22b | s8x9 | 73% (35/48) | 79% (15/19) | 71% (12/17) |
| venice/qwen3-vl-235b-a22b | s8x9_t | 85% (41/48) | 84% (16/19) | 82% (14/17) |
| venice/qwen3-vl-235b-a22b | f10 | 65% (31/48) | 79% (15/19) | 41% (7/17) |
| venice/qwen3-vl-235b-a22b | f10_t | 83% (40/48) | 89% (17/19) | 71% (12/17) |
| venice/qwen3-vl-235b-a22b | scene4x20 | 65% (31/48) | 79% (15/19) | 71% (12/17) |
| venice/qwen3-vl-235b-a22b | even4x20 | 71% (34/48) | 79% (15/19) | 65% (11/17) |

## Accuracy by domain

Groups under 10 questions are left out: Multilingual.

| model | condition | Knowledge (27) | Life Record (21) | Sports Competition (15) | Film & Television (12) | Artistic Performance (12) |
| --- | --- | --- | --- | --- | --- | --- |
| gemini/gemini-3.1-flash-lite | blind | 63% (17/27) | 38% (8/21) | 60% (9/15) | 58% (7/12) | 50% (6/12) |
| gemini/gemini-3.1-flash-lite | transcript | 93% (25/27) | 81% (17/21) | 80% (12/15) | 42% (5/12) | 75% (9/12) |
| gemini/gemini-3.1-flash-lite | s4x20 | 78% (21/27) | 48% (10/21) | 80% (12/15) | 67% (8/12) | 75% (9/12) |
| gemini/gemini-3.1-flash-lite | s4x20_t | 89% (24/27) | 95% (20/21) | 93% (14/15) | 75% (9/12) | 83% (10/12) |
| gemini/gemini-3.1-flash-lite | s4x9 | 85% (23/27) | 48% (10/21) | 80% (12/15) | 67% (8/12) | 83% (10/12) |
| gemini/gemini-3.1-flash-lite | s4x9_t | 85% (23/27) | 81% (17/21) | 87% (13/15) | 50% (6/12) | 83% (10/12) |
| gemini/gemini-3.1-flash-lite | s8x9 | 81% (22/27) | 71% (15/21) | 80% (12/15) | 58% (7/12) | 83% (10/12) |
| gemini/gemini-3.1-flash-lite | s8x9_t | 93% (25/27) | 86% (18/21) | 73% (11/15) | 67% (8/12) | 83% (10/12) |
| gemini/gemini-3.1-flash-lite | f10 | 63% (17/27) | 52% (11/21) | 87% (13/15) | 50% (6/12) | 67% (8/12) |
| gemini/gemini-3.1-flash-lite | f10_t | 89% (24/27) | 81% (17/21) | 87% (13/15) | 58% (7/12) | 83% (10/12) |
| gemini/gemini-3.1-flash-lite | scene4x20 | 100% (6/6) | 62% (5/8) | 100% (1/1) | 50% (3/6) | 67% (2/3) |
| gemini/gemini-3.1-flash-lite | even4x20 | 100% (9/9) | 50% (4/8) | 100% (2/2) | 40% (2/5) | 67% (2/3) |
| venice/qwen3-vl-235b-a22b | blind | 59% (16/27) | 24% (5/21) | 47% (7/15) | 17% (2/12) | 33% (4/12) |
| venice/qwen3-vl-235b-a22b | transcript | 85% (23/27) | 48% (10/21) | 73% (11/15) | 50% (6/12) | 100% (12/12) |
| venice/qwen3-vl-235b-a22b | s4x20 | 81% (22/27) | 52% (11/21) | 87% (13/15) | 67% (8/12) | 67% (8/12) |
| venice/qwen3-vl-235b-a22b | s4x20_t | 89% (24/27) | 62% (13/21) | 87% (13/15) | 75% (9/12) | 92% (11/12) |
| venice/qwen3-vl-235b-a22b | s4x9 | 78% (21/27) | 67% (14/21) | 73% (11/15) | 58% (7/12) | 58% (7/12) |
| venice/qwen3-vl-235b-a22b | s4x9_t | 89% (24/27) | 62% (13/21) | 80% (12/15) | 67% (8/12) | 92% (11/12) |
| venice/qwen3-vl-235b-a22b | s8x9 | 81% (22/27) | 67% (14/21) | 80% (12/15) | 50% (6/12) | 67% (8/12) |
| venice/qwen3-vl-235b-a22b | s8x9_t | 89% (24/27) | 62% (13/21) | 87% (13/15) | 75% (9/12) | 92% (11/12) |
| venice/qwen3-vl-235b-a22b | f10 | 67% (18/27) | 43% (9/21) | 87% (13/15) | 50% (6/12) | 50% (6/12) |
| venice/qwen3-vl-235b-a22b | f10_t | 85% (23/27) | 62% (13/21) | 80% (12/15) | 58% (7/12) | 92% (11/12) |
| venice/qwen3-vl-235b-a22b | scene4x20 | 74% (20/27) | 62% (13/21) | 80% (12/15) | 50% (6/12) | 67% (8/12) |
| venice/qwen3-vl-235b-a22b | even4x20 | 81% (22/27) | 48% (10/21) | 87% (13/15) | 58% (7/12) | 67% (8/12) |

## Demux pass

30 videos, 20.1 hours in all. Reading every packet's time, size and keyframe flag took 0.33 s per video on average (max 0.83 s), 0.5 s per hour of video. Videos had 361 to 1579 keyframes.
