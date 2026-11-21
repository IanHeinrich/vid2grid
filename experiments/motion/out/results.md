# Motion view experiment results

## synthetic

3191 responses over 48 clips.

### Accuracy per model and condition

| model | condition | accuracy | gain over single_frame | unparsed |
| --- | --- | --- | --- | --- |
| gemini/gemini-3-flash-preview | single_frame | 52% (86/166) | +0 pts | 0 |
| gemini/gemini-3-flash-preview | grid_1fps | 84% (139/166) | +32 pts | 0 |
| gemini/gemini-3-flash-preview | burst | 89% (148/166) | +37 pts | 0 |
| gemini/gemini-3-flash-preview | trail_lines | 83% (138/166) | +31 pts | 0 |
| gemini/gemini-3-flash-preview | grid_track3x3_cam | 95% (158/166) | +43 pts | 1 |
| gemini/gemini-3-flash-preview | native_1fps | 83% (138/166) | +31 pts | 0 |
| gemini/gemini-3-flash-preview | native_8fps | 85% (141/166) | +33 pts | 0 |
| gemini/gemini-3-flash-preview | native_24fps | 81% (135/166) | +30 pts | 0 |
| gemini/gemini-3.1-flash-lite | single_frame | 47% (78/166) | +0 pts | 0 |
| gemini/gemini-3.1-flash-lite | grid_1fps | 78% (129/166) | +31 pts | 0 |
| gemini/gemini-3.1-flash-lite | burst | 76% (126/166) | +29 pts | 0 |
| gemini/gemini-3.1-flash-lite | frames_1fps | 75% (125/166) | +28 pts | 0 |
| gemini/gemini-3.1-flash-lite | trail_pair | 77% (127/166) | +30 pts | 0 |
| gemini/gemini-3.1-flash-lite | trail_pair_nolegend | 69% (115/166) | +22 pts | 0 |
| gemini/gemini-3.1-flash-lite | trail_lines | 84% (139/166) | +37 pts | 0 |
| gemini/gemini-3.1-flash-lite | onion_pair | 74% (123/166) | +27 pts | 0 |
| gemini/gemini-3.1-flash-lite | diff_pair | 66% (109/166) | +19 pts | 0 |
| gemini/gemini-3.1-flash-lite | grid_track1 | 77% (127/166) | +30 pts | 0 |
| gemini/gemini-3.1-flash-lite | grid_track3x3 | 80% (132/166) | +33 pts | 0 |
| gemini/gemini-3.1-flash-lite | grid_track3x3_cam | 91% (151/166) | +44 pts | 0 |
| gemini/gemini-3.1-flash-lite | native_1fps | 77% (127/166) | +30 pts | 0 |
| gemini/gemini-3.1-flash-lite | native_8fps | 69% (114/166) | +22 pts | 0 |
| gemini/gemini-3.1-flash-lite | native_24fps | 68% (113/166) | +21 pts | 0 |
| gemini/gemini-3.5-flash-lite | single_frame | 33% (1/3) | +0 pts | 0 |
| openai/gpt-4.1-mini | single_frame | 36% (59/166) | +0 pts | 0 |
| openai/gpt-4.1-mini | grid_1fps | 72% (120/166) | +37 pts | 0 |
| openai/gpt-4.1-mini | burst | 65% (108/166) | +30 pts | 0 |
| openai/gpt-4.1-mini | frames_1fps | 77% (128/166) | +42 pts | 0 |
| openai/gpt-4.1-mini | trail_pair | 59% (98/166) | +23 pts | 0 |
| openai/gpt-4.1-mini | trail_pair_nolegend | 64% (107/166) | +29 pts | 0 |
| openai/gpt-4.1-mini | trail_lines | 78% (130/166) | +43 pts | 0 |
| openai/gpt-4.1-mini | onion_pair | 66% (109/166) | +30 pts | 0 |
| openai/gpt-4.1-mini | diff_pair | 65% (108/166) | +30 pts | 0 |
| openai/gpt-4.1-mini | grid_track1 | 68% (113/166) | +33 pts | 0 |
| openai/gpt-4.1-mini | grid_track3x3 | 72% (119/166) | +36 pts | 0 |
| openai/gpt-4.1-mini | grid_track3x3_cam | 81% (135/166) | +46 pts | 0 |
| openai/gpt-5-mini | single_frame | 60% (100/166) | +0 pts | 0 |
| openai/gpt-5-mini | grid_1fps | 80% (133/166) | +20 pts | 0 |
| openai/gpt-5-mini | burst | 83% (137/166) | +22 pts | 0 |
| openai/gpt-5-mini | frames_1fps | 83% (138/166) | +23 pts | 0 |
| openai/gpt-5-mini | trail_pair | 77% (128/166) | +17 pts | 0 |
| openai/gpt-5-mini | trail_pair_nolegend | 67% (112/166) | +7 pts | 0 |
| openai/gpt-5-mini | trail_lines | 81% (135/166) | +21 pts | 0 |
| openai/gpt-5-mini | onion_pair | 73% (122/166) | +13 pts | 0 |
| openai/gpt-5-mini | diff_pair | 77% (128/166) | +17 pts | 0 |
| openai/gpt-5-mini | grid_track1 | 82% (136/166) | +22 pts | 0 |
| openai/gpt-5-mini | grid_track3x3 | 80% (132/166) | +19 pts | 0 |
| openai/gpt-5-mini | grid_track3x3_cam | 88% (146/166) | +28 pts | 0 |
| venice/claude-sonnet-5-5 | single_frame | 42% (51/121) | +0 pts | 0 |
| venice/claude-sonnet-5-5 | grid_1fps | 99% (120/121) | +57 pts | 0 |
| venice/claude-sonnet-5-5 | burst | 100% (121/121) | +58 pts | 0 |
| venice/claude-sonnet-5-5 | trail_pair | 97% (117/121) | +55 pts | 0 |
| venice/claude-sonnet-5-5 | trail_pair_nolegend | 98% (118/121) | +55 pts | 0 |
| venice/claude-sonnet-5-5 | trail_lines | 91% (107/118) | +49 pts | 1 |
| venice/claude-sonnet-5-5 | onion_pair | 95% (112/118) | +53 pts | 0 |
| venice/claude-sonnet-5-5 | diff_pair | 98% (116/118) | +56 pts | 0 |
| venice/claude-sonnet-5-5 | grid_track1 | 99% (117/118) | +57 pts | 0 |
| venice/claude-sonnet-5-5 | grid_track3x3 | 100% (118/118) | +58 pts | 0 |
| venice/claude-sonnet-5-5 | grid_track3x3_cam | 99% (117/118) | +57 pts | 0 |
| venice/mistral-small-3-2-24b-instruct | single_frame | 33% (1/3) | +0 pts | 0 |
| venice/qwen3-vl-235b-a22b | single_frame | 35% (58/166) | +0 pts | 0 |
| venice/qwen3-vl-235b-a22b | grid_1fps | 72% (119/166) | +37 pts | 0 |
| venice/qwen3-vl-235b-a22b | burst | 73% (122/166) | +39 pts | 0 |
| venice/qwen3-vl-235b-a22b | frames_1fps | 81% (134/166) | +46 pts | 0 |
| venice/qwen3-vl-235b-a22b | trail_pair | 64% (107/166) | +30 pts | 0 |
| venice/qwen3-vl-235b-a22b | trail_pair_nolegend | 58% (97/166) | +23 pts | 0 |
| venice/qwen3-vl-235b-a22b | trail_lines | 75% (125/166) | +40 pts | 0 |
| venice/qwen3-vl-235b-a22b | onion_pair | 65% (108/166) | +30 pts | 0 |
| venice/qwen3-vl-235b-a22b | diff_pair | 65% (108/166) | +30 pts | 0 |
| venice/qwen3-vl-235b-a22b | grid_track1 | 73% (122/166) | +39 pts | 0 |
| venice/qwen3-vl-235b-a22b | grid_track3x3 | 67% (111/166) | +32 pts | 0 |
| venice/qwen3-vl-235b-a22b | grid_track3x3_cam | 72% (120/166) | +37 pts | 0 |

### Accuracy per question type

| model | condition | background | direction | moved | bounce | faster | count |
| --- | --- | --- | --- | --- | --- | --- | --- |
| gemini/gemini-3-flash-preview | single_frame | 40% (19/48) | 31% (13/42) | 94% (45/48) | 33% (4/12) | 50% (4/8) | 12% (1/8) |
| gemini/gemini-3-flash-preview | grid_1fps | 81% (39/48) | 86% (36/42) | 96% (46/48) | 75% (9/12) | 88% (7/8) | 25% (2/8) |
| gemini/gemini-3-flash-preview | burst | 81% (39/48) | 86% (36/42) | 98% (47/48) | 100% (12/12) | 88% (7/8) | 88% (7/8) |
| gemini/gemini-3-flash-preview | trail_lines | 79% (38/48) | 95% (40/42) | 92% (44/48) | 67% (8/12) | 100% (8/8) | 0% (0/8) |
| gemini/gemini-3-flash-preview | grid_track3x3_cam | 96% (46/48) | 100% (42/42) | 98% (47/48) | 92% (11/12) | 88% (7/8) | 62% (5/8) |
| gemini/gemini-3-flash-preview | native_1fps | 81% (39/48) | 83% (35/42) | 96% (46/48) | 92% (11/12) | 62% (5/8) | 25% (2/8) |
| gemini/gemini-3-flash-preview | native_8fps | 75% (36/48) | 90% (38/42) | 96% (46/48) | 92% (11/12) | 62% (5/8) | 62% (5/8) |
| gemini/gemini-3-flash-preview | native_24fps | 71% (34/48) | 88% (37/42) | 98% (47/48) | 83% (10/12) | 62% (5/8) | 25% (2/8) |
| gemini/gemini-3.1-flash-lite | single_frame | 40% (19/48) | 24% (10/42) | 92% (44/48) | 25% (3/12) | 12% (1/8) | 12% (1/8) |
| gemini/gemini-3.1-flash-lite | grid_1fps | 77% (37/48) | 74% (31/42) | 100% (48/48) | 75% (9/12) | 50% (4/8) | 0% (0/8) |
| gemini/gemini-3.1-flash-lite | burst | 60% (29/48) | 76% (32/42) | 100% (48/48) | 75% (9/12) | 62% (5/8) | 38% (3/8) |
| gemini/gemini-3.1-flash-lite | frames_1fps | 77% (37/48) | 71% (30/42) | 94% (45/48) | 83% (10/12) | 38% (3/8) | 0% (0/8) |
| gemini/gemini-3.1-flash-lite | trail_pair | 83% (40/48) | 71% (30/42) | 96% (46/48) | 67% (8/12) | 38% (3/8) | 0% (0/8) |
| gemini/gemini-3.1-flash-lite | trail_pair_nolegend | 77% (37/48) | 57% (24/42) | 96% (46/48) | 50% (6/12) | 25% (2/8) | 0% (0/8) |
| gemini/gemini-3.1-flash-lite | trail_lines | 83% (40/48) | 95% (40/42) | 96% (46/48) | 67% (8/12) | 50% (4/8) | 12% (1/8) |
| gemini/gemini-3.1-flash-lite | onion_pair | 85% (41/48) | 55% (23/42) | 100% (48/48) | 50% (6/12) | 62% (5/8) | 0% (0/8) |
| gemini/gemini-3.1-flash-lite | diff_pair | 79% (38/48) | 38% (16/42) | 92% (44/48) | 58% (7/12) | 25% (2/8) | 25% (2/8) |
| gemini/gemini-3.1-flash-lite | grid_track1 | 73% (35/48) | 79% (33/42) | 100% (48/48) | 67% (8/12) | 38% (3/8) | 0% (0/8) |
| gemini/gemini-3.1-flash-lite | grid_track3x3 | 81% (39/48) | 76% (32/42) | 94% (45/48) | 83% (10/12) | 50% (4/8) | 25% (2/8) |
| gemini/gemini-3.1-flash-lite | grid_track3x3_cam | 98% (47/48) | 90% (38/42) | 100% (48/48) | 83% (10/12) | 75% (6/8) | 25% (2/8) |
| gemini/gemini-3.1-flash-lite | native_1fps | 58% (28/48) | 86% (36/42) | 96% (46/48) | 100% (12/12) | 38% (3/8) | 25% (2/8) |
| gemini/gemini-3.1-flash-lite | native_8fps | 48% (23/48) | 71% (30/42) | 94% (45/48) | 83% (10/12) | 38% (3/8) | 38% (3/8) |
| gemini/gemini-3.1-flash-lite | native_24fps | 52% (25/48) | 69% (29/42) | 96% (46/48) | 75% (9/12) | 25% (2/8) | 25% (2/8) |
| gemini/gemini-3.5-flash-lite | single_frame | 100% (1/1) | 0% (0/1) | 0% (0/1) | - | - | - |
| openai/gpt-4.1-mini | single_frame | 75% (36/48) | 14% (6/42) | 31% (15/48) | 0% (0/12) | 25% (2/8) | 0% (0/8) |
| openai/gpt-4.1-mini | grid_1fps | 81% (39/48) | 69% (29/42) | 88% (42/48) | 67% (8/12) | 25% (2/8) | 0% (0/8) |
| openai/gpt-4.1-mini | burst | 79% (38/48) | 50% (21/42) | 71% (34/48) | 83% (10/12) | 62% (5/8) | 0% (0/8) |
| openai/gpt-4.1-mini | frames_1fps | 81% (39/48) | 74% (31/42) | 90% (43/48) | 75% (9/12) | 62% (5/8) | 12% (1/8) |
| openai/gpt-4.1-mini | trail_pair | 69% (33/48) | 45% (19/42) | 77% (37/48) | 58% (7/12) | 25% (2/8) | 0% (0/8) |
| openai/gpt-4.1-mini | trail_pair_nolegend | 81% (39/48) | 43% (18/42) | 88% (42/48) | 33% (4/12) | 50% (4/8) | 0% (0/8) |
| openai/gpt-4.1-mini | trail_lines | 71% (34/48) | 95% (40/42) | 94% (45/48) | 42% (5/12) | 75% (6/8) | 0% (0/8) |
| openai/gpt-4.1-mini | onion_pair | 85% (41/48) | 36% (15/42) | 96% (46/48) | 25% (3/12) | 50% (4/8) | 0% (0/8) |
| openai/gpt-4.1-mini | diff_pair | 81% (39/48) | 38% (16/42) | 88% (42/48) | 58% (7/12) | 50% (4/8) | 0% (0/8) |
| openai/gpt-4.1-mini | grid_track1 | 81% (39/48) | 60% (25/42) | 81% (39/48) | 67% (8/12) | 25% (2/8) | 0% (0/8) |
| openai/gpt-4.1-mini | grid_track3x3 | 65% (31/48) | 71% (30/42) | 96% (46/48) | 83% (10/12) | 25% (2/8) | 0% (0/8) |
| openai/gpt-4.1-mini | grid_track3x3_cam | 98% (47/48) | 81% (34/42) | 94% (45/48) | 58% (7/12) | 25% (2/8) | 0% (0/8) |
| openai/gpt-5-mini | single_frame | 67% (32/48) | 33% (14/42) | 94% (45/48) | 50% (6/12) | 25% (2/8) | 12% (1/8) |
| openai/gpt-5-mini | grid_1fps | 83% (40/48) | 76% (32/42) | 96% (46/48) | 75% (9/12) | 75% (6/8) | 0% (0/8) |
| openai/gpt-5-mini | burst | 81% (39/48) | 76% (32/42) | 98% (47/48) | 92% (11/12) | 50% (4/8) | 50% (4/8) |
| openai/gpt-5-mini | frames_1fps | 81% (39/48) | 86% (36/42) | 96% (46/48) | 92% (11/12) | 75% (6/8) | 0% (0/8) |
| openai/gpt-5-mini | trail_pair | 77% (37/48) | 83% (35/42) | 90% (43/48) | 67% (8/12) | 62% (5/8) | 0% (0/8) |
| openai/gpt-5-mini | trail_pair_nolegend | 83% (40/48) | 48% (20/42) | 92% (44/48) | 50% (6/12) | 25% (2/8) | 0% (0/8) |
| openai/gpt-5-mini | trail_lines | 75% (36/48) | 88% (37/42) | 96% (46/48) | 67% (8/12) | 100% (8/8) | 0% (0/8) |
| openai/gpt-5-mini | onion_pair | 77% (37/48) | 71% (30/42) | 96% (46/48) | 42% (5/12) | 50% (4/8) | 0% (0/8) |
| openai/gpt-5-mini | diff_pair | 83% (40/48) | 71% (30/42) | 90% (43/48) | 83% (10/12) | 62% (5/8) | 0% (0/8) |
| openai/gpt-5-mini | grid_track1 | 83% (40/48) | 83% (35/42) | 100% (48/48) | 67% (8/12) | 62% (5/8) | 0% (0/8) |
| openai/gpt-5-mini | grid_track3x3 | 71% (34/48) | 79% (33/42) | 100% (48/48) | 83% (10/12) | 75% (6/8) | 12% (1/8) |
| openai/gpt-5-mini | grid_track3x3_cam | 98% (47/48) | 88% (37/42) | 100% (48/48) | 92% (11/12) | 38% (3/8) | 0% (0/8) |
| venice/claude-sonnet-5-5 | single_frame | 94% (31/33) | 3% (1/32) | 48% (16/33) | 0% (0/12) | 25% (2/8) | 33% (1/3) |
| venice/claude-sonnet-5-5 | grid_1fps | 100% (33/33) | 100% (32/32) | 100% (33/33) | 100% (12/12) | 100% (8/8) | 67% (2/3) |
| venice/claude-sonnet-5-5 | burst | 100% (33/33) | 100% (32/32) | 100% (33/33) | 100% (12/12) | 100% (8/8) | 100% (3/3) |
| venice/claude-sonnet-5-5 | trail_pair | 100% (33/33) | 94% (30/32) | 100% (33/33) | 100% (12/12) | 88% (7/8) | 67% (2/3) |
| venice/claude-sonnet-5-5 | trail_pair_nolegend | 100% (33/33) | 100% (32/32) | 100% (33/33) | 75% (9/12) | 100% (8/8) | 100% (3/3) |
| venice/claude-sonnet-5-5 | trail_lines | 97% (31/32) | 94% (30/32) | 97% (31/32) | 67% (8/12) | 88% (7/8) | 0% (0/2) |
| venice/claude-sonnet-5-5 | onion_pair | 100% (32/32) | 100% (32/32) | 100% (32/32) | 67% (8/12) | 88% (7/8) | 50% (1/2) |
| venice/claude-sonnet-5-5 | diff_pair | 100% (32/32) | 100% (32/32) | 100% (32/32) | 100% (12/12) | 100% (8/8) | 0% (0/2) |
| venice/claude-sonnet-5-5 | grid_track1 | 100% (32/32) | 100% (32/32) | 100% (32/32) | 100% (12/12) | 100% (8/8) | 50% (1/2) |
| venice/claude-sonnet-5-5 | grid_track3x3 | 100% (32/32) | 100% (32/32) | 100% (32/32) | 100% (12/12) | 100% (8/8) | 100% (2/2) |
| venice/claude-sonnet-5-5 | grid_track3x3_cam | 100% (32/32) | 100% (32/32) | 100% (32/32) | 100% (12/12) | 88% (7/8) | 100% (2/2) |
| venice/mistral-small-3-2-24b-instruct | single_frame | 100% (1/1) | 0% (0/1) | 0% (0/1) | - | - | - |
| venice/qwen3-vl-235b-a22b | single_frame | 83% (40/48) | 14% (6/42) | 21% (10/48) | 0% (0/12) | 25% (2/8) | 0% (0/8) |
| venice/qwen3-vl-235b-a22b | grid_1fps | 81% (39/48) | 62% (26/42) | 96% (46/48) | 25% (3/12) | 38% (3/8) | 25% (2/8) |
| venice/qwen3-vl-235b-a22b | burst | 81% (39/48) | 62% (26/42) | 96% (46/48) | 50% (6/12) | 38% (3/8) | 25% (2/8) |
| venice/qwen3-vl-235b-a22b | frames_1fps | 81% (39/48) | 76% (32/42) | 98% (47/48) | 83% (10/12) | 50% (4/8) | 25% (2/8) |
| venice/qwen3-vl-235b-a22b | trail_pair | 79% (38/48) | 45% (19/42) | 94% (45/48) | 17% (2/12) | 25% (2/8) | 12% (1/8) |
| venice/qwen3-vl-235b-a22b | trail_pair_nolegend | 83% (40/48) | 17% (7/42) | 94% (45/48) | 0% (0/12) | 62% (5/8) | 0% (0/8) |
| venice/qwen3-vl-235b-a22b | trail_lines | 81% (39/48) | 81% (34/42) | 92% (44/48) | 42% (5/12) | 38% (3/8) | 0% (0/8) |
| venice/qwen3-vl-235b-a22b | onion_pair | 83% (40/48) | 31% (13/42) | 100% (48/48) | 33% (4/12) | 25% (2/8) | 12% (1/8) |
| venice/qwen3-vl-235b-a22b | diff_pair | 85% (41/48) | 21% (9/42) | 94% (45/48) | 58% (7/12) | 50% (4/8) | 25% (2/8) |
| venice/qwen3-vl-235b-a22b | grid_track1 | 83% (40/48) | 62% (26/42) | 96% (46/48) | 33% (4/12) | 50% (4/8) | 25% (2/8) |
| venice/qwen3-vl-235b-a22b | grid_track3x3 | 69% (33/48) | 60% (25/42) | 96% (46/48) | 17% (2/12) | 38% (3/8) | 25% (2/8) |
| venice/qwen3-vl-235b-a22b | grid_track3x3_cam | 98% (47/48) | 50% (21/42) | 96% (46/48) | 17% (2/12) | 25% (2/8) | 25% (2/8) |

### Reverse consistency

Share of direction answers on a reversed copy that are the flip of the answer on the original, whether or not either is correct.

| model | condition | consistent |
| --- | --- | --- |
| gemini/gemini-3-flash-preview | single_frame | 27% (13/49) |
| gemini/gemini-3-flash-preview | grid_1fps | 90% (44/49) |
| gemini/gemini-3-flash-preview | burst | 92% (45/49) |
| gemini/gemini-3-flash-preview | trail_lines | 88% (43/49) |
| gemini/gemini-3-flash-preview | grid_track3x3_cam | 96% (46/48) |
| gemini/gemini-3-flash-preview | native_1fps | 92% (45/49) |
| gemini/gemini-3-flash-preview | native_8fps | 92% (45/49) |
| gemini/gemini-3-flash-preview | native_24fps | 86% (42/49) |
| gemini/gemini-3.1-flash-lite | single_frame | 18% (9/49) |
| gemini/gemini-3.1-flash-lite | grid_1fps | 78% (38/49) |
| gemini/gemini-3.1-flash-lite | burst | 73% (36/49) |
| gemini/gemini-3.1-flash-lite | frames_1fps | 80% (39/49) |
| gemini/gemini-3.1-flash-lite | trail_pair | 84% (41/49) |
| gemini/gemini-3.1-flash-lite | trail_pair_nolegend | 73% (36/49) |
| gemini/gemini-3.1-flash-lite | trail_lines | 92% (45/49) |
| gemini/gemini-3.1-flash-lite | onion_pair | 65% (32/49) |
| gemini/gemini-3.1-flash-lite | diff_pair | 65% (32/49) |
| gemini/gemini-3.1-flash-lite | grid_track1 | 78% (38/49) |
| gemini/gemini-3.1-flash-lite | grid_track3x3 | 86% (42/49) |
| gemini/gemini-3.1-flash-lite | grid_track3x3_cam | 90% (44/49) |
| gemini/gemini-3.1-flash-lite | native_1fps | 86% (42/49) |
| gemini/gemini-3.1-flash-lite | native_8fps | 80% (39/49) |
| gemini/gemini-3.1-flash-lite | native_24fps | 57% (28/49) |
| openai/gpt-4.1-mini | single_frame | 82% (40/49) |
| openai/gpt-4.1-mini | grid_1fps | 76% (37/49) |
| openai/gpt-4.1-mini | burst | 76% (37/49) |
| openai/gpt-4.1-mini | frames_1fps | 82% (40/49) |
| openai/gpt-4.1-mini | trail_pair | 55% (27/49) |
| openai/gpt-4.1-mini | trail_pair_nolegend | 61% (30/49) |
| openai/gpt-4.1-mini | trail_lines | 71% (35/49) |
| openai/gpt-4.1-mini | onion_pair | 59% (29/49) |
| openai/gpt-4.1-mini | diff_pair | 73% (36/49) |
| openai/gpt-4.1-mini | grid_track1 | 69% (34/49) |
| openai/gpt-4.1-mini | grid_track3x3 | 71% (35/49) |
| openai/gpt-4.1-mini | grid_track3x3_cam | 78% (38/49) |
| openai/gpt-5-mini | single_frame | 39% (19/49) |
| openai/gpt-5-mini | grid_1fps | 86% (42/49) |
| openai/gpt-5-mini | burst | 86% (42/49) |
| openai/gpt-5-mini | frames_1fps | 96% (47/49) |
| openai/gpt-5-mini | trail_pair | 92% (45/49) |
| openai/gpt-5-mini | trail_pair_nolegend | 57% (28/49) |
| openai/gpt-5-mini | trail_lines | 78% (38/49) |
| openai/gpt-5-mini | onion_pair | 80% (39/49) |
| openai/gpt-5-mini | diff_pair | 80% (39/49) |
| openai/gpt-5-mini | grid_track1 | 86% (42/49) |
| openai/gpt-5-mini | grid_track3x3 | 73% (36/49) |
| openai/gpt-5-mini | grid_track3x3_cam | 90% (44/49) |
| venice/claude-sonnet-5-5 | single_frame | 92% (35/38) |
| venice/claude-sonnet-5-5 | grid_1fps | 100% (38/38) |
| venice/claude-sonnet-5-5 | burst | 100% (38/38) |
| venice/claude-sonnet-5-5 | trail_pair | 95% (36/38) |
| venice/claude-sonnet-5-5 | trail_pair_nolegend | 92% (35/38) |
| venice/claude-sonnet-5-5 | trail_lines | 89% (31/35) |
| venice/claude-sonnet-5-5 | onion_pair | 89% (34/38) |
| venice/claude-sonnet-5-5 | diff_pair | 100% (38/38) |
| venice/claude-sonnet-5-5 | grid_track1 | 100% (38/38) |
| venice/claude-sonnet-5-5 | grid_track3x3 | 100% (38/38) |
| venice/claude-sonnet-5-5 | grid_track3x3_cam | 100% (38/38) |
| venice/qwen3-vl-235b-a22b | single_frame | 100% (49/49) |
| venice/qwen3-vl-235b-a22b | grid_1fps | 63% (31/49) |
| venice/qwen3-vl-235b-a22b | burst | 69% (34/49) |
| venice/qwen3-vl-235b-a22b | frames_1fps | 86% (42/49) |
| venice/qwen3-vl-235b-a22b | trail_pair | 55% (27/49) |
| venice/qwen3-vl-235b-a22b | trail_pair_nolegend | 65% (32/49) |
| venice/qwen3-vl-235b-a22b | trail_lines | 69% (34/49) |
| venice/qwen3-vl-235b-a22b | onion_pair | 71% (35/49) |
| venice/qwen3-vl-235b-a22b | diff_pair | 76% (37/49) |
| venice/qwen3-vl-235b-a22b | grid_track1 | 65% (32/49) |
| venice/qwen3-vl-235b-a22b | grid_track3x3 | 57% (28/49) |
| venice/qwen3-vl-235b-a22b | grid_track3x3_cam | 76% (37/49) |

### False motion on static clips

On hard static clips the camera shakes, so the right answer to moved is yes; object_moved (asked only on hard clips) is the false-motion measure there.

| model | condition | said moved | claimed any motion | said a ball moved |
| --- | --- | --- | --- | --- |
| gemini/gemini-3-flash-preview | single_frame | 50% (1/2) | 50% (1/2) | 0% (0/2) |
| gemini/gemini-3-flash-preview | grid_1fps | 50% (1/2) | 50% (1/2) | 0% (0/2) |
| gemini/gemini-3-flash-preview | burst | 50% (1/2) | 50% (1/2) | 0% (0/2) |
| gemini/gemini-3-flash-preview | trail_lines | 50% (1/2) | 50% (1/2) | 0% (0/2) |
| gemini/gemini-3-flash-preview | grid_track3x3_cam | 0% (0/2) | 0% (0/2) | 0% (0/2) |
| gemini/gemini-3-flash-preview | native_1fps | 50% (1/2) | 50% (1/2) | 0% (0/2) |
| gemini/gemini-3-flash-preview | native_8fps | 100% (2/2) | 100% (2/2) | 0% (0/2) |
| gemini/gemini-3-flash-preview | native_24fps | 50% (1/2) | 50% (1/2) | 0% (0/2) |
| gemini/gemini-3.1-flash-lite | single_frame | 50% (1/2) | 50% (1/2) | 0% (0/2) |
| gemini/gemini-3.1-flash-lite | grid_1fps | 0% (0/2) | 0% (0/2) | 0% (0/2) |
| gemini/gemini-3.1-flash-lite | burst | 0% (0/2) | 0% (0/2) | 0% (0/2) |
| gemini/gemini-3.1-flash-lite | frames_1fps | 0% (0/2) | 0% (0/2) | 0% (0/2) |
| gemini/gemini-3.1-flash-lite | trail_pair | 0% (0/2) | 0% (0/2) | 0% (0/2) |
| gemini/gemini-3.1-flash-lite | trail_pair_nolegend | 100% (2/2) | 100% (2/2) | 0% (0/2) |
| gemini/gemini-3.1-flash-lite | trail_lines | 0% (0/2) | 0% (0/2) | 0% (0/2) |
| gemini/gemini-3.1-flash-lite | onion_pair | 0% (0/2) | 0% (0/2) | 0% (0/2) |
| gemini/gemini-3.1-flash-lite | diff_pair | 50% (1/2) | 50% (1/2) | 0% (0/2) |
| gemini/gemini-3.1-flash-lite | grid_track1 | 0% (0/2) | 0% (0/2) | 0% (0/2) |
| gemini/gemini-3.1-flash-lite | grid_track3x3 | 0% (0/2) | 0% (0/2) | 0% (0/2) |
| gemini/gemini-3.1-flash-lite | grid_track3x3_cam | 0% (0/2) | 0% (0/2) | 0% (0/2) |
| gemini/gemini-3.1-flash-lite | native_1fps | 100% (2/2) | 100% (2/2) | 0% (0/2) |
| gemini/gemini-3.1-flash-lite | native_8fps | 100% (2/2) | 100% (2/2) | 0% (0/2) |
| gemini/gemini-3.1-flash-lite | native_24fps | 100% (2/2) | 100% (2/2) | 0% (0/2) |
| openai/gpt-4.1-mini | single_frame | 0% (0/2) | 0% (0/2) | 0% (0/2) |
| openai/gpt-4.1-mini | grid_1fps | 0% (0/2) | 0% (0/2) | 0% (0/2) |
| openai/gpt-4.1-mini | burst | 0% (0/2) | 0% (0/2) | 0% (0/2) |
| openai/gpt-4.1-mini | frames_1fps | 0% (0/2) | 0% (0/2) | 0% (0/2) |
| openai/gpt-4.1-mini | trail_pair | 0% (0/2) | 50% (1/2) | 0% (0/2) |
| openai/gpt-4.1-mini | trail_pair_nolegend | 0% (0/2) | 0% (0/2) | 0% (0/2) |
| openai/gpt-4.1-mini | trail_lines | 0% (0/2) | 0% (0/2) | 0% (0/2) |
| openai/gpt-4.1-mini | onion_pair | 50% (1/2) | 50% (1/2) | 0% (0/2) |
| openai/gpt-4.1-mini | diff_pair | 0% (0/2) | 0% (0/2) | 0% (0/2) |
| openai/gpt-4.1-mini | grid_track1 | 0% (0/2) | 0% (0/2) | 0% (0/2) |
| openai/gpt-4.1-mini | grid_track3x3 | 0% (0/2) | 0% (0/2) | 0% (0/2) |
| openai/gpt-4.1-mini | grid_track3x3_cam | 0% (0/2) | 0% (0/2) | 0% (0/2) |
| openai/gpt-5-mini | single_frame | 100% (2/2) | 100% (2/2) | 0% (0/2) |
| openai/gpt-5-mini | grid_1fps | 100% (2/2) | 100% (2/2) | 0% (0/2) |
| openai/gpt-5-mini | burst | 50% (1/2) | 50% (1/2) | 0% (0/2) |
| openai/gpt-5-mini | frames_1fps | 0% (0/2) | 0% (0/2) | 0% (0/2) |
| openai/gpt-5-mini | trail_pair | 100% (2/2) | 100% (2/2) | 0% (0/2) |
| openai/gpt-5-mini | trail_pair_nolegend | 50% (1/2) | 50% (1/2) | 0% (0/2) |
| openai/gpt-5-mini | trail_lines | 100% (2/2) | 100% (2/2) | 0% (0/2) |
| openai/gpt-5-mini | onion_pair | 100% (2/2) | 100% (2/2) | 0% (0/2) |
| openai/gpt-5-mini | diff_pair | 100% (2/2) | 100% (2/2) | 0% (0/2) |
| openai/gpt-5-mini | grid_track1 | 0% (0/2) | 0% (0/2) | 0% (0/2) |
| openai/gpt-5-mini | grid_track3x3 | 0% (0/2) | 0% (0/2) | 0% (0/2) |
| openai/gpt-5-mini | grid_track3x3_cam | 0% (0/2) | 0% (0/2) | 0% (0/2) |
| venice/qwen3-vl-235b-a22b | single_frame | 0% (0/2) | 0% (0/2) | 0% (0/2) |
| venice/qwen3-vl-235b-a22b | grid_1fps | 100% (2/2) | 100% (2/2) | 0% (0/2) |
| venice/qwen3-vl-235b-a22b | burst | 100% (2/2) | 100% (2/2) | 0% (0/2) |
| venice/qwen3-vl-235b-a22b | frames_1fps | 50% (1/2) | 50% (1/2) | 0% (0/2) |
| venice/qwen3-vl-235b-a22b | trail_pair | 100% (2/2) | 100% (2/2) | 0% (0/2) |
| venice/qwen3-vl-235b-a22b | trail_pair_nolegend | 50% (1/2) | 50% (1/2) | 0% (0/2) |
| venice/qwen3-vl-235b-a22b | trail_lines | 0% (0/2) | 0% (0/2) | 0% (0/2) |
| venice/qwen3-vl-235b-a22b | onion_pair | 0% (0/2) | 0% (0/2) | 0% (0/2) |
| venice/qwen3-vl-235b-a22b | diff_pair | 0% (0/2) | 0% (0/2) | 0% (0/2) |
| venice/qwen3-vl-235b-a22b | grid_track1 | 100% (2/2) | 100% (2/2) | 0% (0/2) |
| venice/qwen3-vl-235b-a22b | grid_track3x3 | 100% (2/2) | 100% (2/2) | 0% (0/2) |
| venice/qwen3-vl-235b-a22b | grid_track3x3_cam | 100% (2/2) | 100% (2/2) | 0% (0/2) |

### Count errors

Over-counting is the likely sign of ghosts or blended copies read as extra passes.

| model | condition | over | under or missing | mean abs error |
| --- | --- | --- | --- | --- |
| gemini/gemini-3-flash-preview | single_frame | 25% (2/8) | 62% (5/8) | 1.62 |
| gemini/gemini-3-flash-preview | grid_1fps | 0% (0/8) | 75% (6/8) | 1.75 |
| gemini/gemini-3-flash-preview | burst | 0% (0/8) | 12% (1/8) | 0.12 |
| gemini/gemini-3-flash-preview | trail_lines | 12% (1/8) | 88% (7/8) | 2.25 |
| gemini/gemini-3-flash-preview | grid_track3x3_cam | 0% (0/7) | 29% (2/7) | 0.57 |
| gemini/gemini-3-flash-preview | native_1fps | 0% (0/8) | 75% (6/8) | 2.00 |
| gemini/gemini-3-flash-preview | native_8fps | 0% (0/8) | 38% (3/8) | 0.50 |
| gemini/gemini-3-flash-preview | native_24fps | 0% (0/8) | 75% (6/8) | 1.50 |
| gemini/gemini-3.1-flash-lite | single_frame | 25% (2/8) | 62% (5/8) | 2.00 |
| gemini/gemini-3.1-flash-lite | grid_1fps | 0% (0/8) | 100% (8/8) | 2.38 |
| gemini/gemini-3.1-flash-lite | burst | 0% (0/8) | 62% (5/8) | 1.12 |
| gemini/gemini-3.1-flash-lite | frames_1fps | 0% (0/8) | 100% (8/8) | 2.38 |
| gemini/gemini-3.1-flash-lite | trail_pair | 0% (0/8) | 100% (8/8) | 2.50 |
| gemini/gemini-3.1-flash-lite | trail_pair_nolegend | 12% (1/8) | 88% (7/8) | 2.25 |
| gemini/gemini-3.1-flash-lite | trail_lines | 0% (0/8) | 88% (7/8) | 2.38 |
| gemini/gemini-3.1-flash-lite | onion_pair | 0% (0/8) | 100% (8/8) | 2.12 |
| gemini/gemini-3.1-flash-lite | diff_pair | 12% (1/8) | 62% (5/8) | 1.00 |
| gemini/gemini-3.1-flash-lite | grid_track1 | 0% (0/8) | 100% (8/8) | 2.25 |
| gemini/gemini-3.1-flash-lite | grid_track3x3 | 0% (0/8) | 75% (6/8) | 1.88 |
| gemini/gemini-3.1-flash-lite | grid_track3x3_cam | 0% (0/8) | 75% (6/8) | 1.88 |
| gemini/gemini-3.1-flash-lite | native_1fps | 0% (0/8) | 75% (6/8) | 1.75 |
| gemini/gemini-3.1-flash-lite | native_8fps | 0% (0/8) | 62% (5/8) | 1.25 |
| gemini/gemini-3.1-flash-lite | native_24fps | 0% (0/8) | 75% (6/8) | 1.62 |
| openai/gpt-4.1-mini | single_frame | 0% (0/8) | 100% (8/8) | 2.50 |
| openai/gpt-4.1-mini | grid_1fps | 0% (0/8) | 100% (8/8) | 2.88 |
| openai/gpt-4.1-mini | burst | 0% (0/8) | 100% (8/8) | 2.75 |
| openai/gpt-4.1-mini | frames_1fps | 0% (0/8) | 88% (7/8) | 2.38 |
| openai/gpt-4.1-mini | trail_pair | 0% (0/8) | 100% (8/8) | 2.62 |
| openai/gpt-4.1-mini | trail_pair_nolegend | 0% (0/8) | 100% (8/8) | 2.50 |
| openai/gpt-4.1-mini | trail_lines | 0% (0/8) | 100% (8/8) | 2.75 |
| openai/gpt-4.1-mini | onion_pair | 0% (0/8) | 100% (8/8) | 2.50 |
| openai/gpt-4.1-mini | diff_pair | 25% (2/8) | 75% (6/8) | 1.88 |
| openai/gpt-4.1-mini | grid_track1 | 0% (0/8) | 100% (8/8) | 2.88 |
| openai/gpt-4.1-mini | grid_track3x3 | 0% (0/8) | 100% (8/8) | 2.75 |
| openai/gpt-4.1-mini | grid_track3x3_cam | 0% (0/8) | 100% (8/8) | 2.75 |
| openai/gpt-5-mini | single_frame | 0% (0/8) | 88% (7/8) | 2.25 |
| openai/gpt-5-mini | grid_1fps | 0% (0/8) | 100% (8/8) | 2.25 |
| openai/gpt-5-mini | burst | 0% (0/8) | 50% (4/8) | 0.50 |
| openai/gpt-5-mini | frames_1fps | 0% (0/8) | 100% (8/8) | 2.50 |
| openai/gpt-5-mini | trail_pair | 0% (0/8) | 100% (8/8) | 2.50 |
| openai/gpt-5-mini | trail_pair_nolegend | 0% (0/8) | 100% (8/8) | 2.50 |
| openai/gpt-5-mini | trail_lines | 0% (0/8) | 100% (8/8) | 2.50 |
| openai/gpt-5-mini | onion_pair | 0% (0/8) | 100% (8/8) | 2.12 |
| openai/gpt-5-mini | diff_pair | 25% (2/8) | 75% (6/8) | 1.88 |
| openai/gpt-5-mini | grid_track1 | 0% (0/8) | 100% (8/8) | 2.12 |
| openai/gpt-5-mini | grid_track3x3 | 0% (0/8) | 88% (7/8) | 1.88 |
| openai/gpt-5-mini | grid_track3x3_cam | 25% (2/8) | 75% (6/8) | 2.00 |
| venice/claude-sonnet-5-5 | single_frame | 67% (2/3) | 0% (0/3) | 0.67 |
| venice/claude-sonnet-5-5 | grid_1fps | 0% (0/3) | 33% (1/3) | 0.33 |
| venice/claude-sonnet-5-5 | burst | 0% (0/3) | 0% (0/3) | 0.00 |
| venice/claude-sonnet-5-5 | trail_pair | 33% (1/3) | 0% (0/3) | 0.33 |
| venice/claude-sonnet-5-5 | trail_pair_nolegend | 0% (0/3) | 0% (0/3) | 0.00 |
| venice/claude-sonnet-5-5 | trail_lines | 100% (2/2) | 0% (0/2) | 1.00 |
| venice/claude-sonnet-5-5 | onion_pair | 50% (1/2) | 0% (0/2) | 0.50 |
| venice/claude-sonnet-5-5 | diff_pair | 100% (2/2) | 0% (0/2) | 1.00 |
| venice/claude-sonnet-5-5 | grid_track1 | 50% (1/2) | 0% (0/2) | 0.50 |
| venice/claude-sonnet-5-5 | grid_track3x3 | 0% (0/2) | 0% (0/2) | 0.00 |
| venice/claude-sonnet-5-5 | grid_track3x3_cam | 0% (0/2) | 0% (0/2) | 0.00 |
| venice/qwen3-vl-235b-a22b | single_frame | 0% (0/8) | 100% (8/8) | 2.50 |
| venice/qwen3-vl-235b-a22b | grid_1fps | 0% (0/8) | 75% (6/8) | 1.50 |
| venice/qwen3-vl-235b-a22b | burst | 25% (2/8) | 50% (4/8) | 1.00 |
| venice/qwen3-vl-235b-a22b | frames_1fps | 0% (0/8) | 75% (6/8) | 1.75 |
| venice/qwen3-vl-235b-a22b | trail_pair | 0% (0/8) | 88% (7/8) | 2.25 |
| venice/qwen3-vl-235b-a22b | trail_pair_nolegend | 0% (0/8) | 100% (8/8) | 2.50 |
| venice/qwen3-vl-235b-a22b | trail_lines | 0% (0/8) | 100% (8/8) | 2.50 |
| venice/qwen3-vl-235b-a22b | onion_pair | 12% (1/8) | 75% (6/8) | 2.12 |
| venice/qwen3-vl-235b-a22b | diff_pair | 0% (0/8) | 75% (6/8) | 1.50 |
| venice/qwen3-vl-235b-a22b | grid_track1 | 0% (0/8) | 75% (6/8) | 1.50 |
| venice/qwen3-vl-235b-a22b | grid_track3x3 | 0% (0/8) | 75% (6/8) | 1.50 |
| venice/qwen3-vl-235b-a22b | grid_track3x3_cam | 0% (0/8) | 75% (6/8) | 1.50 |

### Estimated cost per correct answer

| model | condition | spent | correct | per correct |
| --- | --- | --- | --- | --- |
| gemini/gemini-3-flash-preview | single_frame | $0.2840 | 86 | $0.00330 |
| gemini/gemini-3-flash-preview | grid_1fps | $0.1585 | 139 | $0.00114 |
| gemini/gemini-3-flash-preview | burst | $0.1732 | 148 | $0.00117 |
| gemini/gemini-3-flash-preview | trail_lines | $0.2214 | 138 | $0.00160 |
| gemini/gemini-3-flash-preview | grid_track3x3_cam | $0.2136 | 158 | $0.00135 |
| gemini/gemini-3-flash-preview | native_1fps | $0.0456 | 138 | $0.00033 |
| gemini/gemini-3-flash-preview | native_8fps | $0.2664 | 141 | $0.00189 |
| gemini/gemini-3-flash-preview | native_24fps | $0.7895 | 135 | $0.00585 |
| gemini/gemini-3.1-flash-lite | single_frame | $0.0250 | 78 | $0.00032 |
| gemini/gemini-3.1-flash-lite | grid_1fps | $0.0252 | 129 | $0.00020 |
| gemini/gemini-3.1-flash-lite | burst | $0.0249 | 126 | $0.00020 |
| gemini/gemini-3.1-flash-lite | frames_1fps | $0.0781 | 125 | $0.00062 |
| gemini/gemini-3.1-flash-lite | trail_pair | $0.0252 | 127 | $0.00020 |
| gemini/gemini-3.1-flash-lite | trail_pair_nolegend | $0.0247 | 115 | $0.00021 |
| gemini/gemini-3.1-flash-lite | trail_lines | $0.0249 | 139 | $0.00018 |
| gemini/gemini-3.1-flash-lite | onion_pair | $0.0255 | 123 | $0.00021 |
| gemini/gemini-3.1-flash-lite | diff_pair | $0.0250 | 109 | $0.00023 |
| gemini/gemini-3.1-flash-lite | grid_track1 | $0.0264 | 127 | $0.00021 |
| gemini/gemini-3.1-flash-lite | grid_track3x3 | $0.0291 | 132 | $0.00022 |
| gemini/gemini-3.1-flash-lite | grid_track3x3_cam | $0.0297 | 151 | $0.00020 |
| gemini/gemini-3.1-flash-lite | native_1fps | $0.0280 | 127 | $0.00022 |
| gemini/gemini-3.1-flash-lite | native_8fps | $0.1411 | 114 | $0.00124 |
| gemini/gemini-3.1-flash-lite | native_24fps | $0.3960 | 113 | $0.00350 |
| gemini/gemini-3.5-flash-lite | single_frame | $0.0004 | 1 | $0.00044 |
| openai/gpt-4.1-mini | single_frame | $0.0125 | 59 | $0.00021 |
| openai/gpt-4.1-mini | grid_1fps | $0.0375 | 120 | $0.00031 |
| openai/gpt-4.1-mini | burst | $0.0374 | 108 | $0.00035 |
| openai/gpt-4.1-mini | frames_1fps | $0.0576 | 128 | $0.00045 |
| openai/gpt-4.1-mini | trail_pair | $0.0172 | 98 | $0.00018 |
| openai/gpt-4.1-mini | trail_pair_nolegend | $0.0138 | 107 | $0.00013 |
| openai/gpt-4.1-mini | trail_lines | $0.0171 | 130 | $0.00013 |
| openai/gpt-4.1-mini | onion_pair | $0.0148 | 109 | $0.00014 |
| openai/gpt-4.1-mini | diff_pair | $0.0149 | 108 | $0.00014 |
| openai/gpt-4.1-mini | grid_track1 | $0.0386 | 113 | $0.00034 |
| openai/gpt-4.1-mini | grid_track3x3 | $0.0414 | 119 | $0.00035 |
| openai/gpt-4.1-mini | grid_track3x3_cam | $0.0426 | 135 | $0.00032 |
| openai/gpt-5-mini | single_frame | $0.0164 | 100 | $0.00016 |
| openai/gpt-5-mini | grid_1fps | $0.0361 | 133 | $0.00027 |
| openai/gpt-5-mini | burst | $0.0335 | 137 | $0.00024 |
| openai/gpt-5-mini | frames_1fps | $0.0392 | 138 | $0.00028 |
| openai/gpt-5-mini | trail_pair | $0.0470 | 128 | $0.00037 |
| openai/gpt-5-mini | trail_pair_nolegend | $0.0198 | 112 | $0.00018 |
| openai/gpt-5-mini | trail_lines | $0.0341 | 135 | $0.00025 |
| openai/gpt-5-mini | onion_pair | $0.0320 | 122 | $0.00026 |
| openai/gpt-5-mini | diff_pair | $0.0292 | 128 | $0.00023 |
| openai/gpt-5-mini | grid_track1 | $0.0350 | 136 | $0.00026 |
| openai/gpt-5-mini | grid_track3x3 | $0.0523 | 132 | $0.00040 |
| openai/gpt-5-mini | grid_track3x3_cam | $0.0536 | 146 | $0.00037 |
| venice/claude-sonnet-5-5 | single_frame | $0.2479 | 51 | $0.00486 |
| venice/claude-sonnet-5-5 | grid_1fps | $0.3512 | 120 | $0.00293 |
| venice/claude-sonnet-5-5 | burst | $0.3399 | 121 | $0.00281 |
| venice/claude-sonnet-5-5 | trail_pair | $0.2920 | 117 | $0.00250 |
| venice/claude-sonnet-5-5 | trail_pair_nolegend | $0.2926 | 118 | $0.00248 |
| venice/claude-sonnet-5-5 | trail_lines | $0.2693 | 107 | $0.00252 |
| venice/claude-sonnet-5-5 | onion_pair | $0.2722 | 112 | $0.00243 |
| venice/claude-sonnet-5-5 | diff_pair | $0.2849 | 116 | $0.00246 |
| venice/claude-sonnet-5-5 | grid_track1 | $0.3387 | 117 | $0.00290 |
| venice/claude-sonnet-5-5 | grid_track3x3 | $0.3481 | 118 | $0.00295 |
| venice/claude-sonnet-5-5 | grid_track3x3_cam | $0.3517 | 117 | $0.00301 |
| venice/mistral-small-3-2-24b-instruct | single_frame | $0.0002 | 1 | $0.00021 |
| venice/qwen3-vl-235b-a22b | single_frame | $0.0228 | 58 | $0.00039 |
| venice/qwen3-vl-235b-a22b | grid_1fps | $0.0313 | 119 | $0.00026 |
| venice/qwen3-vl-235b-a22b | burst | $0.0312 | 122 | $0.00026 |
| venice/qwen3-vl-235b-a22b | frames_1fps | $0.0378 | 134 | $0.00028 |
| venice/qwen3-vl-235b-a22b | trail_pair | $0.0245 | 107 | $0.00023 |
| venice/qwen3-vl-235b-a22b | trail_pair_nolegend | $0.0234 | 97 | $0.00024 |
| venice/qwen3-vl-235b-a22b | trail_lines | $0.0244 | 125 | $0.00020 |
| venice/qwen3-vl-235b-a22b | onion_pair | $0.0239 | 108 | $0.00022 |
| venice/qwen3-vl-235b-a22b | diff_pair | $0.0240 | 108 | $0.00022 |
| venice/qwen3-vl-235b-a22b | grid_track1 | $0.0319 | 122 | $0.00026 |
| venice/qwen3-vl-235b-a22b | grid_track3x3 | $0.0340 | 111 | $0.00031 |
| venice/qwen3-vl-235b-a22b | grid_track3x3_cam | $0.0347 | 120 | $0.00029 |

## hard

1034 responses over 22 clips.

### Accuracy per model and condition

| model | condition | accuracy | gain over single_frame | unparsed |
| --- | --- | --- | --- | --- |
| gemini/gemini-3.1-flash-lite | single_frame | 49% (49/100) | +0 pts | 0 |
| gemini/gemini-3.1-flash-lite | grid_1fps | 80% (80/100) | +31 pts | 0 |
| gemini/gemini-3.1-flash-lite | burst | 76% (76/100) | +27 pts | 0 |
| gemini/gemini-3.1-flash-lite | trail_pair | 73% (73/100) | +24 pts | 0 |
| gemini/gemini-3.1-flash-lite | trail_pair_nolegend | 66% (66/100) | +17 pts | 0 |
| gemini/gemini-3.1-flash-lite | trail_lines | 81% (81/100) | +32 pts | 0 |
| gemini/gemini-3.1-flash-lite | onion_pair | 77% (77/100) | +28 pts | 0 |
| gemini/gemini-3.1-flash-lite | diff_pair | 65% (65/100) | +16 pts | 0 |
| gemini/gemini-3.1-flash-lite | grid_track1 | 78% (78/100) | +29 pts | 0 |
| gemini/gemini-3.1-flash-lite | grid_track3x3 | 77% (77/100) | +28 pts | 0 |
| gemini/gemini-3.1-flash-lite | grid_track3x3_cam | 78% (78/100) | +29 pts | 0 |
| gemini/gemini-3.1-flash-lite | native_1fps | 67% (67/100) | +18 pts | 0 |
| gemini/gemini-3.1-flash-lite | native_8fps | 73% (73/100) | +24 pts | 0 |
| gemini/gemini-3.1-flash-lite | native_24fps | 62% (62/100) | +13 pts | 0 |
| openai/gpt-4.1-mini | single_frame | 40% (40/100) | +0 pts | 0 |
| openai/gpt-4.1-mini | grid_1fps | 62% (62/100) | +22 pts | 0 |
| openai/gpt-4.1-mini | burst | 60% (60/100) | +20 pts | 0 |
| openai/gpt-4.1-mini | trail_pair | 58% (58/100) | +18 pts | 0 |
| openai/gpt-4.1-mini | trail_pair_nolegend | 62% (62/100) | +22 pts | 0 |
| openai/gpt-4.1-mini | trail_lines | 78% (78/100) | +38 pts | 0 |
| openai/gpt-4.1-mini | onion_pair | 66% (66/100) | +26 pts | 0 |
| openai/gpt-4.1-mini | diff_pair | 65% (65/100) | +25 pts | 0 |
| openai/gpt-4.1-mini | grid_track1 | 71% (71/100) | +31 pts | 0 |
| openai/gpt-4.1-mini | grid_track3x3 | 62% (62/100) | +22 pts | 0 |
| openai/gpt-4.1-mini | grid_track3x3_cam | 70% (70/100) | +30 pts | 0 |
| openai/gpt-5-mini | single_frame | 62% (62/100) | +0 pts | 0 |
| openai/gpt-5-mini | grid_1fps | 81% (81/100) | +19 pts | 0 |
| openai/gpt-5-mini | burst | 81% (81/100) | +19 pts | 0 |
| openai/gpt-5-mini | trail_pair | 74% (74/100) | +12 pts | 0 |
| openai/gpt-5-mini | trail_pair_nolegend | 72% (72/100) | +10 pts | 0 |
| openai/gpt-5-mini | trail_lines | 79% (79/100) | +17 pts | 0 |
| openai/gpt-5-mini | onion_pair | 72% (72/100) | +10 pts | 0 |
| openai/gpt-5-mini | diff_pair | 78% (78/100) | +16 pts | 0 |
| openai/gpt-5-mini | grid_track1 | 82% (82/100) | +20 pts | 0 |
| openai/gpt-5-mini | grid_track3x3 | 77% (77/100) | +15 pts | 0 |
| openai/gpt-5-mini | grid_track3x3_cam | 68% (68/100) | +6 pts | 0 |
| venice/qwen3-vl-235b-a22b | single_frame | 34% (34/100) | +0 pts | 0 |
| venice/qwen3-vl-235b-a22b | grid_1fps | 77% (77/100) | +43 pts | 0 |
| venice/qwen3-vl-235b-a22b | burst | 79% (79/100) | +45 pts | 0 |
| venice/qwen3-vl-235b-a22b | trail_pair | 71% (71/100) | +37 pts | 0 |
| venice/qwen3-vl-235b-a22b | trail_pair_nolegend | 66% (66/100) | +32 pts | 0 |
| venice/qwen3-vl-235b-a22b | trail_lines | 81% (81/100) | +47 pts | 0 |
| venice/qwen3-vl-235b-a22b | onion_pair | 71% (71/100) | +37 pts | 0 |
| venice/qwen3-vl-235b-a22b | diff_pair | 68% (68/100) | +34 pts | 0 |
| venice/qwen3-vl-235b-a22b | grid_track1 | 77% (77/100) | +43 pts | 0 |
| venice/qwen3-vl-235b-a22b | grid_track3x3 | 76% (76/100) | +42 pts | 0 |
| venice/qwen3-vl-235b-a22b | grid_track3x3_cam | 70% (70/100) | +36 pts | 0 |

### Accuracy per question type

| model | condition | background | direction | moved | object_moved | bounce | faster | count |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gemini/gemini-3.1-flash-lite | single_frame | 55% (12/22) | 17% (3/18) | 82% (18/22) | 59% (13/22) | 25% (2/8) | 0% (0/4) | 25% (1/4) |
| gemini/gemini-3.1-flash-lite | grid_1fps | 77% (17/22) | 78% (14/18) | 95% (21/22) | 91% (20/22) | 75% (6/8) | 50% (2/4) | 0% (0/4) |
| gemini/gemini-3.1-flash-lite | burst | 68% (15/22) | 78% (14/18) | 91% (20/22) | 91% (20/22) | 62% (5/8) | 50% (2/4) | 0% (0/4) |
| gemini/gemini-3.1-flash-lite | trail_pair | 77% (17/22) | 67% (12/18) | 86% (19/22) | 95% (21/22) | 50% (4/8) | 0% (0/4) | 0% (0/4) |
| gemini/gemini-3.1-flash-lite | trail_pair_nolegend | 77% (17/22) | 28% (5/18) | 100% (22/22) | 82% (18/22) | 50% (4/8) | 0% (0/4) | 0% (0/4) |
| gemini/gemini-3.1-flash-lite | trail_lines | 82% (18/22) | 89% (16/18) | 86% (19/22) | 95% (21/22) | 50% (4/8) | 75% (3/4) | 0% (0/4) |
| gemini/gemini-3.1-flash-lite | onion_pair | 82% (18/22) | 56% (10/18) | 91% (20/22) | 91% (20/22) | 50% (4/8) | 75% (3/4) | 50% (2/4) |
| gemini/gemini-3.1-flash-lite | diff_pair | 82% (18/22) | 17% (3/18) | 100% (22/22) | 82% (18/22) | 50% (4/8) | 0% (0/4) | 0% (0/4) |
| gemini/gemini-3.1-flash-lite | grid_track1 | 77% (17/22) | 72% (13/18) | 100% (22/22) | 86% (19/22) | 75% (6/8) | 25% (1/4) | 0% (0/4) |
| gemini/gemini-3.1-flash-lite | grid_track3x3 | 82% (18/22) | 67% (12/18) | 95% (21/22) | 91% (20/22) | 75% (6/8) | 0% (0/4) | 0% (0/4) |
| gemini/gemini-3.1-flash-lite | grid_track3x3_cam | 68% (15/22) | 78% (14/18) | 100% (22/22) | 86% (19/22) | 75% (6/8) | 50% (2/4) | 0% (0/4) |
| gemini/gemini-3.1-flash-lite | native_1fps | 27% (6/22) | 72% (13/18) | 100% (22/22) | 82% (18/22) | 100% (8/8) | 0% (0/4) | 0% (0/4) |
| gemini/gemini-3.1-flash-lite | native_8fps | 32% (7/22) | 89% (16/18) | 95% (21/22) | 86% (19/22) | 100% (8/8) | 50% (2/4) | 0% (0/4) |
| gemini/gemini-3.1-flash-lite | native_24fps | 41% (9/22) | 56% (10/18) | 100% (22/22) | 68% (15/22) | 62% (5/8) | 0% (0/4) | 25% (1/4) |
| openai/gpt-4.1-mini | single_frame | 64% (14/22) | 22% (4/18) | 36% (8/22) | 45% (10/22) | 50% (4/8) | 0% (0/4) | 0% (0/4) |
| openai/gpt-4.1-mini | grid_1fps | 68% (15/22) | 61% (11/18) | 82% (18/22) | 59% (13/22) | 50% (4/8) | 25% (1/4) | 0% (0/4) |
| openai/gpt-4.1-mini | burst | 77% (17/22) | 67% (12/18) | 50% (11/22) | 64% (14/22) | 50% (4/8) | 50% (2/4) | 0% (0/4) |
| openai/gpt-4.1-mini | trail_pair | 64% (14/22) | 44% (8/18) | 64% (14/22) | 77% (17/22) | 25% (2/8) | 75% (3/4) | 0% (0/4) |
| openai/gpt-4.1-mini | trail_pair_nolegend | 73% (16/22) | 44% (8/18) | 68% (15/22) | 82% (18/22) | 50% (4/8) | 25% (1/4) | 0% (0/4) |
| openai/gpt-4.1-mini | trail_lines | 73% (16/22) | 94% (17/18) | 77% (17/22) | 91% (20/22) | 62% (5/8) | 75% (3/4) | 0% (0/4) |
| openai/gpt-4.1-mini | onion_pair | 77% (17/22) | 39% (7/18) | 86% (19/22) | 77% (17/22) | 50% (4/8) | 50% (2/4) | 0% (0/4) |
| openai/gpt-4.1-mini | diff_pair | 73% (16/22) | 33% (6/18) | 95% (21/22) | 73% (16/22) | 62% (5/8) | 25% (1/4) | 0% (0/4) |
| openai/gpt-4.1-mini | grid_track1 | 64% (14/22) | 67% (12/18) | 91% (20/22) | 82% (18/22) | 75% (6/8) | 25% (1/4) | 0% (0/4) |
| openai/gpt-4.1-mini | grid_track3x3 | 36% (8/22) | 67% (12/18) | 95% (21/22) | 59% (13/22) | 75% (6/8) | 50% (2/4) | 0% (0/4) |
| openai/gpt-4.1-mini | grid_track3x3_cam | 36% (8/22) | 67% (12/18) | 100% (22/22) | 91% (20/22) | 62% (5/8) | 75% (3/4) | 0% (0/4) |
| openai/gpt-5-mini | single_frame | 59% (13/22) | 39% (7/18) | 95% (21/22) | 82% (18/22) | 25% (2/8) | 25% (1/4) | 0% (0/4) |
| openai/gpt-5-mini | grid_1fps | 77% (17/22) | 72% (13/18) | 100% (22/22) | 91% (20/22) | 88% (7/8) | 50% (2/4) | 0% (0/4) |
| openai/gpt-5-mini | burst | 86% (19/22) | 72% (13/18) | 95% (21/22) | 86% (19/22) | 75% (6/8) | 75% (3/4) | 0% (0/4) |
| openai/gpt-5-mini | trail_pair | 68% (15/22) | 78% (14/18) | 95% (21/22) | 86% (19/22) | 50% (4/8) | 25% (1/4) | 0% (0/4) |
| openai/gpt-5-mini | trail_pair_nolegend | 82% (18/22) | 44% (8/18) | 95% (21/22) | 86% (19/22) | 50% (4/8) | 50% (2/4) | 0% (0/4) |
| openai/gpt-5-mini | trail_lines | 73% (16/22) | 83% (15/18) | 91% (20/22) | 95% (21/22) | 50% (4/8) | 75% (3/4) | 0% (0/4) |
| openai/gpt-5-mini | onion_pair | 77% (17/22) | 56% (10/18) | 100% (22/22) | 86% (19/22) | 50% (4/8) | 0% (0/4) | 0% (0/4) |
| openai/gpt-5-mini | diff_pair | 77% (17/22) | 61% (11/18) | 100% (22/22) | 77% (17/22) | 100% (8/8) | 75% (3/4) | 0% (0/4) |
| openai/gpt-5-mini | grid_track1 | 77% (17/22) | 83% (15/18) | 100% (22/22) | 91% (20/22) | 75% (6/8) | 50% (2/4) | 0% (0/4) |
| openai/gpt-5-mini | grid_track3x3 | 55% (12/22) | 72% (13/18) | 100% (22/22) | 86% (19/22) | 100% (8/8) | 75% (3/4) | 0% (0/4) |
| openai/gpt-5-mini | grid_track3x3_cam | 27% (6/22) | 67% (12/18) | 100% (22/22) | 82% (18/22) | 88% (7/8) | 75% (3/4) | 0% (0/4) |
| venice/qwen3-vl-235b-a22b | single_frame | 82% (18/22) | 22% (4/18) | 18% (4/22) | 36% (8/22) | 0% (0/8) | 0% (0/4) | 0% (0/4) |
| venice/qwen3-vl-235b-a22b | grid_1fps | 82% (18/22) | 61% (11/18) | 100% (22/22) | 82% (18/22) | 62% (5/8) | 75% (3/4) | 0% (0/4) |
| venice/qwen3-vl-235b-a22b | burst | 82% (18/22) | 67% (12/18) | 100% (22/22) | 82% (18/22) | 50% (4/8) | 75% (3/4) | 50% (2/4) |
| venice/qwen3-vl-235b-a22b | trail_pair | 73% (16/22) | 39% (7/18) | 100% (22/22) | 86% (19/22) | 62% (5/8) | 50% (2/4) | 0% (0/4) |
| venice/qwen3-vl-235b-a22b | trail_pair_nolegend | 82% (18/22) | 22% (4/18) | 95% (21/22) | 86% (19/22) | 38% (3/8) | 25% (1/4) | 0% (0/4) |
| venice/qwen3-vl-235b-a22b | trail_lines | 82% (18/22) | 89% (16/18) | 82% (18/22) | 100% (22/22) | 50% (4/8) | 75% (3/4) | 0% (0/4) |
| venice/qwen3-vl-235b-a22b | onion_pair | 82% (18/22) | 33% (6/18) | 91% (20/22) | 91% (20/22) | 50% (4/8) | 75% (3/4) | 0% (0/4) |
| venice/qwen3-vl-235b-a22b | diff_pair | 77% (17/22) | 39% (7/18) | 100% (22/22) | 91% (20/22) | 0% (0/8) | 50% (2/4) | 0% (0/4) |
| venice/qwen3-vl-235b-a22b | grid_track1 | 82% (18/22) | 61% (11/18) | 100% (22/22) | 82% (18/22) | 62% (5/8) | 75% (3/4) | 0% (0/4) |
| venice/qwen3-vl-235b-a22b | grid_track3x3 | 77% (17/22) | 61% (11/18) | 100% (22/22) | 82% (18/22) | 62% (5/8) | 75% (3/4) | 0% (0/4) |
| venice/qwen3-vl-235b-a22b | grid_track3x3_cam | 50% (11/22) | 61% (11/18) | 100% (22/22) | 82% (18/22) | 62% (5/8) | 75% (3/4) | 0% (0/4) |

### Reverse consistency

Share of direction answers on a reversed copy that are the flip of the answer on the original, whether or not either is correct.

| model | condition | consistent |
| --- | --- | --- |
| gemini/gemini-3.1-flash-lite | single_frame | 36% (8/22) |
| gemini/gemini-3.1-flash-lite | grid_1fps | 77% (17/22) |
| gemini/gemini-3.1-flash-lite | burst | 68% (15/22) |
| gemini/gemini-3.1-flash-lite | trail_pair | 77% (17/22) |
| gemini/gemini-3.1-flash-lite | trail_pair_nolegend | 59% (13/22) |
| gemini/gemini-3.1-flash-lite | trail_lines | 73% (16/22) |
| gemini/gemini-3.1-flash-lite | onion_pair | 77% (17/22) |
| gemini/gemini-3.1-flash-lite | diff_pair | 73% (16/22) |
| gemini/gemini-3.1-flash-lite | grid_track1 | 82% (18/22) |
| gemini/gemini-3.1-flash-lite | grid_track3x3 | 77% (17/22) |
| gemini/gemini-3.1-flash-lite | grid_track3x3_cam | 55% (12/22) |
| gemini/gemini-3.1-flash-lite | native_1fps | 64% (14/22) |
| gemini/gemini-3.1-flash-lite | native_8fps | 82% (18/22) |
| gemini/gemini-3.1-flash-lite | native_24fps | 50% (11/22) |
| openai/gpt-4.1-mini | single_frame | 82% (18/22) |
| openai/gpt-4.1-mini | grid_1fps | 50% (11/22) |
| openai/gpt-4.1-mini | burst | 68% (15/22) |
| openai/gpt-4.1-mini | trail_pair | 59% (13/22) |
| openai/gpt-4.1-mini | trail_pair_nolegend | 50% (11/22) |
| openai/gpt-4.1-mini | trail_lines | 77% (17/22) |
| openai/gpt-4.1-mini | onion_pair | 45% (10/22) |
| openai/gpt-4.1-mini | diff_pair | 55% (12/22) |
| openai/gpt-4.1-mini | grid_track1 | 68% (15/22) |
| openai/gpt-4.1-mini | grid_track3x3 | 64% (14/22) |
| openai/gpt-4.1-mini | grid_track3x3_cam | 50% (11/22) |
| openai/gpt-5-mini | single_frame | 45% (10/22) |
| openai/gpt-5-mini | grid_1fps | 77% (17/22) |
| openai/gpt-5-mini | burst | 77% (17/22) |
| openai/gpt-5-mini | trail_pair | 73% (16/22) |
| openai/gpt-5-mini | trail_pair_nolegend | 68% (15/22) |
| openai/gpt-5-mini | trail_lines | 64% (14/22) |
| openai/gpt-5-mini | onion_pair | 68% (15/22) |
| openai/gpt-5-mini | diff_pair | 82% (18/22) |
| openai/gpt-5-mini | grid_track1 | 82% (18/22) |
| openai/gpt-5-mini | grid_track3x3 | 68% (15/22) |
| openai/gpt-5-mini | grid_track3x3_cam | 64% (14/22) |
| venice/qwen3-vl-235b-a22b | single_frame | 100% (22/22) |
| venice/qwen3-vl-235b-a22b | grid_1fps | 73% (16/22) |
| venice/qwen3-vl-235b-a22b | burst | 82% (18/22) |
| venice/qwen3-vl-235b-a22b | trail_pair | 64% (14/22) |
| venice/qwen3-vl-235b-a22b | trail_pair_nolegend | 64% (14/22) |
| venice/qwen3-vl-235b-a22b | trail_lines | 82% (18/22) |
| venice/qwen3-vl-235b-a22b | onion_pair | 73% (16/22) |
| venice/qwen3-vl-235b-a22b | diff_pair | 68% (15/22) |
| venice/qwen3-vl-235b-a22b | grid_track1 | 73% (16/22) |
| venice/qwen3-vl-235b-a22b | grid_track3x3 | 68% (15/22) |
| venice/qwen3-vl-235b-a22b | grid_track3x3_cam | 50% (11/22) |

### False motion on static clips

On hard static clips the camera shakes, so the right answer to moved is yes; object_moved (asked only on hard clips) is the false-motion measure there.

| model | condition | said moved | claimed any motion | said a ball moved |
| --- | --- | --- | --- | --- |
| gemini/gemini-3.1-flash-lite | single_frame | 50% (1/2) | 50% (1/2) | 50% (1/2) |
| gemini/gemini-3.1-flash-lite | grid_1fps | 50% (1/2) | 50% (1/2) | 0% (0/2) |
| gemini/gemini-3.1-flash-lite | burst | 0% (0/2) | 0% (0/2) | 0% (0/2) |
| gemini/gemini-3.1-flash-lite | trail_pair | 0% (0/2) | 0% (0/2) | 0% (0/2) |
| gemini/gemini-3.1-flash-lite | trail_pair_nolegend | 100% (2/2) | 100% (2/2) | 100% (2/2) |
| gemini/gemini-3.1-flash-lite | trail_lines | 0% (0/2) | 0% (0/2) | 0% (0/2) |
| gemini/gemini-3.1-flash-lite | onion_pair | 0% (0/2) | 0% (0/2) | 0% (0/2) |
| gemini/gemini-3.1-flash-lite | diff_pair | 100% (2/2) | 100% (2/2) | 100% (2/2) |
| gemini/gemini-3.1-flash-lite | grid_track1 | 100% (2/2) | 100% (2/2) | 50% (1/2) |
| gemini/gemini-3.1-flash-lite | grid_track3x3 | 50% (1/2) | 50% (1/2) | 50% (1/2) |
| gemini/gemini-3.1-flash-lite | grid_track3x3_cam | 100% (2/2) | 100% (2/2) | 50% (1/2) |
| gemini/gemini-3.1-flash-lite | native_1fps | 100% (2/2) | 100% (2/2) | 0% (0/2) |
| gemini/gemini-3.1-flash-lite | native_8fps | 50% (1/2) | 50% (1/2) | 0% (0/2) |
| gemini/gemini-3.1-flash-lite | native_24fps | 100% (2/2) | 100% (2/2) | 0% (0/2) |
| openai/gpt-4.1-mini | single_frame | 0% (0/2) | 0% (0/2) | 0% (0/2) |
| openai/gpt-4.1-mini | grid_1fps | 0% (0/2) | 0% (0/2) | 0% (0/2) |
| openai/gpt-4.1-mini | burst | 0% (0/2) | 0% (0/2) | 0% (0/2) |
| openai/gpt-4.1-mini | trail_pair | 0% (0/2) | 0% (0/2) | 0% (0/2) |
| openai/gpt-4.1-mini | trail_pair_nolegend | 0% (0/2) | 0% (0/2) | 0% (0/2) |
| openai/gpt-4.1-mini | trail_lines | 0% (0/2) | 0% (0/2) | 0% (0/2) |
| openai/gpt-4.1-mini | onion_pair | 0% (0/2) | 0% (0/2) | 0% (0/2) |
| openai/gpt-4.1-mini | diff_pair | 50% (1/2) | 50% (1/2) | 50% (1/2) |
| openai/gpt-4.1-mini | grid_track1 | 50% (1/2) | 50% (1/2) | 0% (0/2) |
| openai/gpt-4.1-mini | grid_track3x3 | 50% (1/2) | 50% (1/2) | 0% (0/2) |
| openai/gpt-4.1-mini | grid_track3x3_cam | 100% (2/2) | 100% (2/2) | 0% (0/2) |
| openai/gpt-5-mini | single_frame | 100% (2/2) | 100% (2/2) | 50% (1/2) |
| openai/gpt-5-mini | grid_1fps | 100% (2/2) | 100% (2/2) | 50% (1/2) |
| openai/gpt-5-mini | burst | 50% (1/2) | 50% (1/2) | 50% (1/2) |
| openai/gpt-5-mini | trail_pair | 50% (1/2) | 50% (1/2) | 50% (1/2) |
| openai/gpt-5-mini | trail_pair_nolegend | 50% (1/2) | 50% (1/2) | 50% (1/2) |
| openai/gpt-5-mini | trail_lines | 50% (1/2) | 50% (1/2) | 50% (1/2) |
| openai/gpt-5-mini | onion_pair | 100% (2/2) | 100% (2/2) | 50% (1/2) |
| openai/gpt-5-mini | diff_pair | 100% (2/2) | 100% (2/2) | 100% (2/2) |
| openai/gpt-5-mini | grid_track1 | 100% (2/2) | 100% (2/2) | 0% (0/2) |
| openai/gpt-5-mini | grid_track3x3 | 100% (2/2) | 100% (2/2) | 0% (0/2) |
| openai/gpt-5-mini | grid_track3x3_cam | 100% (2/2) | 100% (2/2) | 50% (1/2) |
| venice/qwen3-vl-235b-a22b | single_frame | 0% (0/2) | 0% (0/2) | 0% (0/2) |
| venice/qwen3-vl-235b-a22b | grid_1fps | 100% (2/2) | 100% (2/2) | 100% (2/2) |
| venice/qwen3-vl-235b-a22b | burst | 100% (2/2) | 100% (2/2) | 100% (2/2) |
| venice/qwen3-vl-235b-a22b | trail_pair | 100% (2/2) | 100% (2/2) | 50% (1/2) |
| venice/qwen3-vl-235b-a22b | trail_pair_nolegend | 50% (1/2) | 50% (1/2) | 50% (1/2) |
| venice/qwen3-vl-235b-a22b | trail_lines | 0% (0/2) | 0% (0/2) | 0% (0/2) |
| venice/qwen3-vl-235b-a22b | onion_pair | 0% (0/2) | 0% (0/2) | 0% (0/2) |
| venice/qwen3-vl-235b-a22b | diff_pair | 100% (2/2) | 100% (2/2) | 0% (0/2) |
| venice/qwen3-vl-235b-a22b | grid_track1 | 100% (2/2) | 100% (2/2) | 100% (2/2) |
| venice/qwen3-vl-235b-a22b | grid_track3x3 | 100% (2/2) | 100% (2/2) | 100% (2/2) |
| venice/qwen3-vl-235b-a22b | grid_track3x3_cam | 100% (2/2) | 100% (2/2) | 100% (2/2) |

### Count errors

Over-counting is the likely sign of ghosts or blended copies read as extra passes.

| model | condition | over | under or missing | mean abs error |
| --- | --- | --- | --- | --- |
| gemini/gemini-3.1-flash-lite | single_frame | 0% (0/4) | 75% (3/4) | 2.00 |
| gemini/gemini-3.1-flash-lite | grid_1fps | 0% (0/4) | 100% (4/4) | 2.00 |
| gemini/gemini-3.1-flash-lite | burst | 0% (0/4) | 100% (4/4) | 2.00 |
| gemini/gemini-3.1-flash-lite | trail_pair | 0% (0/4) | 100% (4/4) | 2.50 |
| gemini/gemini-3.1-flash-lite | trail_pair_nolegend | 0% (0/4) | 100% (4/4) | 2.50 |
| gemini/gemini-3.1-flash-lite | trail_lines | 0% (0/4) | 100% (4/4) | 2.50 |
| gemini/gemini-3.1-flash-lite | onion_pair | 0% (0/4) | 50% (2/4) | 1.50 |
| gemini/gemini-3.1-flash-lite | diff_pair | 0% (0/4) | 100% (4/4) | 2.50 |
| gemini/gemini-3.1-flash-lite | grid_track1 | 0% (0/4) | 100% (4/4) | 2.00 |
| gemini/gemini-3.1-flash-lite | grid_track3x3 | 0% (0/4) | 100% (4/4) | 2.00 |
| gemini/gemini-3.1-flash-lite | grid_track3x3_cam | 0% (0/4) | 100% (4/4) | 2.50 |
| gemini/gemini-3.1-flash-lite | native_1fps | 0% (0/4) | 100% (4/4) | 1.75 |
| gemini/gemini-3.1-flash-lite | native_8fps | 0% (0/4) | 100% (4/4) | 1.25 |
| gemini/gemini-3.1-flash-lite | native_24fps | 25% (1/4) | 50% (2/4) | 1.00 |
| openai/gpt-4.1-mini | single_frame | 0% (0/4) | 100% (4/4) | 2.50 |
| openai/gpt-4.1-mini | grid_1fps | 0% (0/4) | 100% (4/4) | 2.75 |
| openai/gpt-4.1-mini | burst | 0% (0/4) | 100% (4/4) | 2.50 |
| openai/gpt-4.1-mini | trail_pair | 0% (0/4) | 100% (4/4) | 2.75 |
| openai/gpt-4.1-mini | trail_pair_nolegend | 0% (0/4) | 100% (4/4) | 2.50 |
| openai/gpt-4.1-mini | trail_lines | 0% (0/4) | 100% (4/4) | 3.25 |
| openai/gpt-4.1-mini | onion_pair | 0% (0/4) | 100% (4/4) | 2.50 |
| openai/gpt-4.1-mini | diff_pair | 0% (0/4) | 100% (4/4) | 2.75 |
| openai/gpt-4.1-mini | grid_track1 | 0% (0/4) | 100% (4/4) | 2.50 |
| openai/gpt-4.1-mini | grid_track3x3 | 0% (0/4) | 100% (4/4) | 2.50 |
| openai/gpt-4.1-mini | grid_track3x3_cam | 0% (0/4) | 100% (4/4) | 2.50 |
| openai/gpt-5-mini | single_frame | 0% (0/4) | 100% (4/4) | 2.50 |
| openai/gpt-5-mini | grid_1fps | 0% (0/4) | 100% (4/4) | 2.50 |
| openai/gpt-5-mini | burst | 25% (1/4) | 75% (3/4) | 1.50 |
| openai/gpt-5-mini | trail_pair | 0% (0/4) | 100% (4/4) | 2.50 |
| openai/gpt-5-mini | trail_pair_nolegend | 0% (0/4) | 100% (4/4) | 2.50 |
| openai/gpt-5-mini | trail_lines | 0% (0/4) | 100% (4/4) | 2.50 |
| openai/gpt-5-mini | onion_pair | 0% (0/4) | 100% (4/4) | 2.50 |
| openai/gpt-5-mini | diff_pair | 0% (0/4) | 100% (4/4) | 2.50 |
| openai/gpt-5-mini | grid_track1 | 0% (0/4) | 100% (4/4) | 2.50 |
| openai/gpt-5-mini | grid_track3x3 | 0% (0/4) | 100% (4/4) | 2.50 |
| openai/gpt-5-mini | grid_track3x3_cam | 0% (0/4) | 100% (4/4) | 2.25 |
| venice/qwen3-vl-235b-a22b | single_frame | 0% (0/4) | 100% (4/4) | 2.50 |
| venice/qwen3-vl-235b-a22b | grid_1fps | 0% (0/4) | 100% (4/4) | 1.50 |
| venice/qwen3-vl-235b-a22b | burst | 0% (0/4) | 50% (2/4) | 0.50 |
| venice/qwen3-vl-235b-a22b | trail_pair | 0% (0/4) | 100% (4/4) | 2.50 |
| venice/qwen3-vl-235b-a22b | trail_pair_nolegend | 0% (0/4) | 100% (4/4) | 2.50 |
| venice/qwen3-vl-235b-a22b | trail_lines | 0% (0/4) | 100% (4/4) | 2.50 |
| venice/qwen3-vl-235b-a22b | onion_pair | 0% (0/4) | 100% (4/4) | 2.50 |
| venice/qwen3-vl-235b-a22b | diff_pair | 0% (0/4) | 100% (4/4) | 2.50 |
| venice/qwen3-vl-235b-a22b | grid_track1 | 0% (0/4) | 100% (4/4) | 1.50 |
| venice/qwen3-vl-235b-a22b | grid_track3x3 | 0% (0/4) | 100% (4/4) | 1.50 |
| venice/qwen3-vl-235b-a22b | grid_track3x3_cam | 0% (0/4) | 100% (4/4) | 1.50 |

### Estimated cost per correct answer

| model | condition | spent | correct | per correct |
| --- | --- | --- | --- | --- |
| gemini/gemini-3.1-flash-lite | single_frame | $0.0119 | 49 | $0.00024 |
| gemini/gemini-3.1-flash-lite | grid_1fps | $0.0121 | 80 | $0.00015 |
| gemini/gemini-3.1-flash-lite | burst | $0.0120 | 76 | $0.00016 |
| gemini/gemini-3.1-flash-lite | trail_pair | $0.0120 | 73 | $0.00016 |
| gemini/gemini-3.1-flash-lite | trail_pair_nolegend | $0.0119 | 66 | $0.00018 |
| gemini/gemini-3.1-flash-lite | trail_lines | $0.0118 | 81 | $0.00015 |
| gemini/gemini-3.1-flash-lite | onion_pair | $0.0121 | 77 | $0.00016 |
| gemini/gemini-3.1-flash-lite | diff_pair | $0.0119 | 65 | $0.00018 |
| gemini/gemini-3.1-flash-lite | grid_track1 | $0.0127 | 78 | $0.00016 |
| gemini/gemini-3.1-flash-lite | grid_track3x3 | $0.0138 | 77 | $0.00018 |
| gemini/gemini-3.1-flash-lite | grid_track3x3_cam | $0.0143 | 78 | $0.00018 |
| gemini/gemini-3.1-flash-lite | native_1fps | $0.0130 | 67 | $0.00019 |
| gemini/gemini-3.1-flash-lite | native_8fps | $0.0637 | 73 | $0.00087 |
| gemini/gemini-3.1-flash-lite | native_24fps | $0.1798 | 62 | $0.00290 |
| openai/gpt-4.1-mini | single_frame | $0.0064 | 40 | $0.00016 |
| openai/gpt-4.1-mini | grid_1fps | $0.0178 | 62 | $0.00029 |
| openai/gpt-4.1-mini | burst | $0.0178 | 60 | $0.00030 |
| openai/gpt-4.1-mini | trail_pair | $0.0085 | 58 | $0.00015 |
| openai/gpt-4.1-mini | trail_pair_nolegend | $0.0069 | 62 | $0.00011 |
| openai/gpt-4.1-mini | trail_lines | $0.0085 | 78 | $0.00011 |
| openai/gpt-4.1-mini | onion_pair | $0.0074 | 66 | $0.00011 |
| openai/gpt-4.1-mini | diff_pair | $0.0075 | 65 | $0.00011 |
| openai/gpt-4.1-mini | grid_track1 | $0.0183 | 71 | $0.00026 |
| openai/gpt-4.1-mini | grid_track3x3 | $0.0196 | 62 | $0.00032 |
| openai/gpt-4.1-mini | grid_track3x3_cam | $0.0204 | 70 | $0.00029 |
| openai/gpt-5-mini | single_frame | $0.0081 | 62 | $0.00013 |
| openai/gpt-5-mini | grid_1fps | $0.0177 | 81 | $0.00022 |
| openai/gpt-5-mini | burst | $0.0156 | 81 | $0.00019 |
| openai/gpt-5-mini | trail_pair | $0.0270 | 74 | $0.00036 |
| openai/gpt-5-mini | trail_pair_nolegend | $0.0097 | 72 | $0.00013 |
| openai/gpt-5-mini | trail_lines | $0.0176 | 79 | $0.00022 |
| openai/gpt-5-mini | onion_pair | $0.0147 | 72 | $0.00020 |
| openai/gpt-5-mini | diff_pair | $0.0169 | 78 | $0.00022 |
| openai/gpt-5-mini | grid_track1 | $0.0201 | 82 | $0.00024 |
| openai/gpt-5-mini | grid_track3x3 | $0.0246 | 77 | $0.00032 |
| openai/gpt-5-mini | grid_track3x3_cam | $0.0677 | 68 | $0.00100 |
| venice/qwen3-vl-235b-a22b | single_frame | $0.0110 | 34 | $0.00032 |
| venice/qwen3-vl-235b-a22b | grid_1fps | $0.0149 | 77 | $0.00019 |
| venice/qwen3-vl-235b-a22b | burst | $0.0148 | 79 | $0.00019 |
| venice/qwen3-vl-235b-a22b | trail_pair | $0.0117 | 71 | $0.00017 |
| venice/qwen3-vl-235b-a22b | trail_pair_nolegend | $0.0113 | 66 | $0.00017 |
| venice/qwen3-vl-235b-a22b | trail_lines | $0.0117 | 81 | $0.00014 |
| venice/qwen3-vl-235b-a22b | onion_pair | $0.0115 | 71 | $0.00016 |
| venice/qwen3-vl-235b-a22b | diff_pair | $0.0115 | 68 | $0.00017 |
| venice/qwen3-vl-235b-a22b | grid_track1 | $0.0152 | 77 | $0.00020 |
| venice/qwen3-vl-235b-a22b | grid_track3x3 | $0.0161 | 76 | $0.00021 |
| venice/qwen3-vl-235b-a22b | grid_track3x3_cam | $0.0166 | 70 | $0.00024 |

## tempcompass

4453 responses over 90 clips.

### Accuracy per model and condition

| model | condition | accuracy | gain over single_frame | unparsed |
| --- | --- | --- | --- | --- |
| gemini/gemini-3.1-flash-lite | single_frame | 64% (58/90) | +0 pts | 0 |
| gemini/gemini-3.1-flash-lite | grid_1fps | 67% (60/90) | +2 pts | 0 |
| gemini/gemini-3.1-flash-lite | burst | 66% (59/90) | +1 pts | 0 |
| gemini/gemini-3.1-flash-lite | frames_1fps | 77% (69/90) | +12 pts | 0 |
| gemini/gemini-3.1-flash-lite | trail_pair | 54% (49/90) | -10 pts | 0 |
| gemini/gemini-3.1-flash-lite | trail_pair_nolegend | 58% (52/90) | -7 pts | 0 |
| gemini/gemini-3.1-flash-lite | trail_lines | 54% (49/90) | -10 pts | 0 |
| gemini/gemini-3.1-flash-lite | onion_pair | 50% (45/90) | -14 pts | 0 |
| gemini/gemini-3.1-flash-lite | diff_pair | 44% (40/90) | -20 pts | 0 |
| gemini/gemini-3.1-flash-lite | grid_track1 | 66% (59/90) | +1 pts | 0 |
| gemini/gemini-3.1-flash-lite | grid_track3x3 | 67% (60/90) | +2 pts | 0 |
| gemini/gemini-3.1-flash-lite | grid_track3x3_cam | 66% (59/90) | +1 pts | 0 |
| gemini/gemini-3.1-flash-lite | native_1fps | 83% (75/90) | +19 pts | 0 |
| gemini/gemini-3.1-flash-lite | native_8fps | 76% (68/90) | +11 pts | 0 |
| openai/gpt-4.1-mini | single_frame | 43% (39/90) | +0 pts | 0 |
| openai/gpt-4.1-mini | grid_1fps | 54% (49/90) | +11 pts | 0 |
| openai/gpt-4.1-mini | burst | 53% (48/90) | +10 pts | 0 |
| openai/gpt-4.1-mini | frames_1fps | 62% (56/90) | +19 pts | 0 |
| openai/gpt-4.1-mini | trail_pair | 40% (36/90) | -3 pts | 0 |
| openai/gpt-4.1-mini | trail_pair_nolegend | 40% (36/90) | -3 pts | 0 |
| openai/gpt-4.1-mini | trail_lines | 42% (38/90) | -1 pts | 0 |
| openai/gpt-4.1-mini | onion_pair | 39% (35/90) | -4 pts | 0 |
| openai/gpt-4.1-mini | diff_pair | 43% (38/89) | -1 pts | 0 |
| openai/gpt-4.1-mini | grid_track1 | 50% (45/90) | +7 pts | 0 |
| openai/gpt-4.1-mini | grid_track3x3 | 59% (53/90) | +16 pts | 0 |
| openai/gpt-4.1-mini | grid_track3x3_cam | 59% (53/90) | +16 pts | 0 |
| openai/gpt-5-mini | single_frame | 50% (45/90) | +0 pts | 0 |
| openai/gpt-5-mini | grid_1fps | 64% (58/90) | +14 pts | 0 |
| openai/gpt-5-mini | burst | 63% (57/90) | +13 pts | 0 |
| openai/gpt-5-mini | frames_1fps | 68% (61/90) | +18 pts | 0 |
| openai/gpt-5-mini | trail_pair | 46% (41/90) | -4 pts | 0 |
| openai/gpt-5-mini | trail_pair_nolegend | 42% (38/90) | -8 pts | 0 |
| openai/gpt-5-mini | trail_lines | 42% (38/90) | -8 pts | 0 |
| openai/gpt-5-mini | onion_pair | 42% (38/90) | -8 pts | 0 |
| openai/gpt-5-mini | diff_pair | 40% (36/90) | -10 pts | 0 |
| openai/gpt-5-mini | grid_track1 | 61% (55/90) | +11 pts | 0 |
| openai/gpt-5-mini | grid_track3x3 | 64% (58/90) | +14 pts | 0 |
| openai/gpt-5-mini | grid_track3x3_cam | 61% (55/90) | +11 pts | 0 |
| venice/qwen3-vl-235b-a22b | single_frame | 48% (43/90) | +0 pts | 0 |
| venice/qwen3-vl-235b-a22b | grid_1fps | 64% (58/90) | +17 pts | 0 |
| venice/qwen3-vl-235b-a22b | burst | 61% (55/90) | +13 pts | 0 |
| venice/qwen3-vl-235b-a22b | frames_1fps | 61% (27/44) | +14 pts | 0 |
| venice/qwen3-vl-235b-a22b | trail_pair | 41% (37/90) | -7 pts | 0 |
| venice/qwen3-vl-235b-a22b | trail_pair_nolegend | 44% (40/90) | -3 pts | 0 |
| venice/qwen3-vl-235b-a22b | trail_lines | 40% (36/90) | -8 pts | 0 |
| venice/qwen3-vl-235b-a22b | onion_pair | 42% (38/90) | -6 pts | 0 |
| venice/qwen3-vl-235b-a22b | diff_pair | 38% (34/90) | -10 pts | 0 |
| venice/qwen3-vl-235b-a22b | grid_track1 | 59% (53/90) | +11 pts | 0 |
| venice/qwen3-vl-235b-a22b | grid_track3x3 | 56% (50/90) | +8 pts | 0 |
| venice/qwen3-vl-235b-a22b | grid_track3x3_cam | 56% (50/90) | +8 pts | 0 |

### Accuracy per dimension

| model | condition | tc_direction | tc_speed | tc_order |
| --- | --- | --- | --- | --- |
| gemini/gemini-3.1-flash-lite | single_frame | 63% (19/30) | 77% (23/30) | 53% (16/30) |
| gemini/gemini-3.1-flash-lite | grid_1fps | 70% (21/30) | 57% (17/30) | 73% (22/30) |
| gemini/gemini-3.1-flash-lite | burst | 60% (18/30) | 57% (17/30) | 80% (24/30) |
| gemini/gemini-3.1-flash-lite | frames_1fps | 63% (19/30) | 77% (23/30) | 90% (27/30) |
| gemini/gemini-3.1-flash-lite | trail_pair | 63% (19/30) | 60% (18/30) | 40% (12/30) |
| gemini/gemini-3.1-flash-lite | trail_pair_nolegend | 63% (19/30) | 70% (21/30) | 40% (12/30) |
| gemini/gemini-3.1-flash-lite | trail_lines | 57% (17/30) | 60% (18/30) | 47% (14/30) |
| gemini/gemini-3.1-flash-lite | onion_pair | 50% (15/30) | 57% (17/30) | 43% (13/30) |
| gemini/gemini-3.1-flash-lite | diff_pair | 50% (15/30) | 50% (15/30) | 33% (10/30) |
| gemini/gemini-3.1-flash-lite | grid_track1 | 63% (19/30) | 60% (18/30) | 73% (22/30) |
| gemini/gemini-3.1-flash-lite | grid_track3x3 | 70% (21/30) | 57% (17/30) | 73% (22/30) |
| gemini/gemini-3.1-flash-lite | grid_track3x3_cam | 57% (17/30) | 63% (19/30) | 77% (23/30) |
| gemini/gemini-3.1-flash-lite | native_1fps | 67% (20/30) | 83% (25/30) | 100% (30/30) |
| gemini/gemini-3.1-flash-lite | native_8fps | 63% (19/30) | 73% (22/30) | 90% (27/30) |
| openai/gpt-4.1-mini | single_frame | 47% (14/30) | 47% (14/30) | 37% (11/30) |
| openai/gpt-4.1-mini | grid_1fps | 53% (16/30) | 50% (15/30) | 60% (18/30) |
| openai/gpt-4.1-mini | burst | 67% (20/30) | 43% (13/30) | 50% (15/30) |
| openai/gpt-4.1-mini | frames_1fps | 67% (20/30) | 63% (19/30) | 57% (17/30) |
| openai/gpt-4.1-mini | trail_pair | 67% (20/30) | 33% (10/30) | 20% (6/30) |
| openai/gpt-4.1-mini | trail_pair_nolegend | 60% (18/30) | 40% (12/30) | 20% (6/30) |
| openai/gpt-4.1-mini | trail_lines | 50% (15/30) | 47% (14/30) | 30% (9/30) |
| openai/gpt-4.1-mini | onion_pair | 50% (15/30) | 43% (13/30) | 23% (7/30) |
| openai/gpt-4.1-mini | diff_pair | 53% (16/30) | 38% (11/29) | 37% (11/30) |
| openai/gpt-4.1-mini | grid_track1 | 57% (17/30) | 33% (10/30) | 60% (18/30) |
| openai/gpt-4.1-mini | grid_track3x3 | 60% (18/30) | 60% (18/30) | 57% (17/30) |
| openai/gpt-4.1-mini | grid_track3x3_cam | 60% (18/30) | 53% (16/30) | 63% (19/30) |
| openai/gpt-5-mini | single_frame | 60% (18/30) | 50% (15/30) | 40% (12/30) |
| openai/gpt-5-mini | grid_1fps | 63% (19/30) | 57% (17/30) | 73% (22/30) |
| openai/gpt-5-mini | burst | 57% (17/30) | 60% (18/30) | 73% (22/30) |
| openai/gpt-5-mini | frames_1fps | 77% (23/30) | 53% (16/30) | 73% (22/30) |
| openai/gpt-5-mini | trail_pair | 47% (14/30) | 43% (13/30) | 47% (14/30) |
| openai/gpt-5-mini | trail_pair_nolegend | 40% (12/30) | 47% (14/30) | 40% (12/30) |
| openai/gpt-5-mini | trail_lines | 50% (15/30) | 37% (11/30) | 40% (12/30) |
| openai/gpt-5-mini | onion_pair | 50% (15/30) | 33% (10/30) | 43% (13/30) |
| openai/gpt-5-mini | diff_pair | 53% (16/30) | 27% (8/30) | 40% (12/30) |
| openai/gpt-5-mini | grid_track1 | 60% (18/30) | 50% (15/30) | 73% (22/30) |
| openai/gpt-5-mini | grid_track3x3 | 63% (19/30) | 60% (18/30) | 70% (21/30) |
| openai/gpt-5-mini | grid_track3x3_cam | 63% (19/30) | 47% (14/30) | 73% (22/30) |
| venice/qwen3-vl-235b-a22b | single_frame | 47% (14/30) | 50% (15/30) | 47% (14/30) |
| venice/qwen3-vl-235b-a22b | grid_1fps | 63% (19/30) | 63% (19/30) | 67% (20/30) |
| venice/qwen3-vl-235b-a22b | burst | 57% (17/30) | 60% (18/30) | 67% (20/30) |
| venice/qwen3-vl-235b-a22b | frames_1fps | 64% (9/14) | 59% (10/17) | 62% (8/13) |
| venice/qwen3-vl-235b-a22b | trail_pair | 40% (12/30) | 50% (15/30) | 33% (10/30) |
| venice/qwen3-vl-235b-a22b | trail_pair_nolegend | 43% (13/30) | 57% (17/30) | 33% (10/30) |
| venice/qwen3-vl-235b-a22b | trail_lines | 40% (12/30) | 47% (14/30) | 33% (10/30) |
| venice/qwen3-vl-235b-a22b | onion_pair | 47% (14/30) | 53% (16/30) | 27% (8/30) |
| venice/qwen3-vl-235b-a22b | diff_pair | 40% (12/30) | 37% (11/30) | 37% (11/30) |
| venice/qwen3-vl-235b-a22b | grid_track1 | 60% (18/30) | 47% (14/30) | 70% (21/30) |
| venice/qwen3-vl-235b-a22b | grid_track3x3 | 50% (15/30) | 53% (16/30) | 63% (19/30) |
| venice/qwen3-vl-235b-a22b | grid_track3x3_cam | 50% (15/30) | 50% (15/30) | 67% (20/30) |

### Chance level

Chance is the mean of 1 / number of options over the questions in each dimension.

| dimension | questions | chance |
| --- | --- | --- |
| tc_direction | 30 | 28% |
| tc_speed | 30 | 32% |
| tc_order | 30 | 32% |

### Estimated cost per correct answer

| model | condition | spent | correct | per correct |
| --- | --- | --- | --- | --- |
| gemini/gemini-3.1-flash-lite | single_frame | $0.0424 | 58 | $0.00073 |
| gemini/gemini-3.1-flash-lite | grid_1fps | $0.0433 | 60 | $0.00072 |
| gemini/gemini-3.1-flash-lite | burst | $0.0438 | 59 | $0.00074 |
| gemini/gemini-3.1-flash-lite | frames_1fps | $0.2929 | 69 | $0.00424 |
| gemini/gemini-3.1-flash-lite | trail_pair | $0.0443 | 49 | $0.00090 |
| gemini/gemini-3.1-flash-lite | trail_pair_nolegend | $0.0425 | 52 | $0.00082 |
| gemini/gemini-3.1-flash-lite | trail_lines | $0.0432 | 49 | $0.00088 |
| gemini/gemini-3.1-flash-lite | onion_pair | $0.0438 | 45 | $0.00097 |
| gemini/gemini-3.1-flash-lite | diff_pair | $0.0433 | 40 | $0.00108 |
| gemini/gemini-3.1-flash-lite | grid_track1 | $0.0450 | 59 | $0.00076 |
| gemini/gemini-3.1-flash-lite | grid_track3x3 | $0.0516 | 60 | $0.00086 |
| gemini/gemini-3.1-flash-lite | grid_track3x3_cam | $0.0535 | 59 | $0.00091 |
| gemini/gemini-3.1-flash-lite | native_1fps | $0.0868 | 75 | $0.00116 |
| gemini/gemini-3.1-flash-lite | native_8fps | $0.5663 | 68 | $0.00833 |
| openai/gpt-4.1-mini | single_frame | $0.0192 | 39 | $0.00049 |
| openai/gpt-4.1-mini | grid_1fps | $0.0653 | 49 | $0.00133 |
| openai/gpt-4.1-mini | burst | $0.0651 | 48 | $0.00136 |
| openai/gpt-4.1-mini | frames_1fps | $0.2305 | 56 | $0.00412 |
| openai/gpt-4.1-mini | trail_pair | $0.0306 | 36 | $0.00085 |
| openai/gpt-4.1-mini | trail_pair_nolegend | $0.0247 | 36 | $0.00069 |
| openai/gpt-4.1-mini | trail_lines | $0.0305 | 38 | $0.00080 |
| openai/gpt-4.1-mini | onion_pair | $0.0266 | 35 | $0.00076 |
| openai/gpt-4.1-mini | diff_pair | $0.0263 | 38 | $0.00069 |
| openai/gpt-4.1-mini | grid_track1 | $0.0675 | 45 | $0.00150 |
| openai/gpt-4.1-mini | grid_track3x3 | $0.0752 | 53 | $0.00142 |
| openai/gpt-4.1-mini | grid_track3x3_cam | $0.0785 | 53 | $0.00148 |
| openai/gpt-5-mini | single_frame | $0.0267 | 45 | $0.00059 |
| openai/gpt-5-mini | grid_1fps | $0.0476 | 58 | $0.00082 |
| openai/gpt-5-mini | burst | $0.0499 | 57 | $0.00088 |
| openai/gpt-5-mini | frames_1fps | $0.1240 | 61 | $0.00203 |
| openai/gpt-5-mini | trail_pair | $0.0470 | 41 | $0.00115 |
| openai/gpt-5-mini | trail_pair_nolegend | $0.0294 | 38 | $0.00077 |
| openai/gpt-5-mini | trail_lines | $0.0465 | 38 | $0.00122 |
| openai/gpt-5-mini | onion_pair | $0.0405 | 38 | $0.00107 |
| openai/gpt-5-mini | diff_pair | $0.0399 | 36 | $0.00111 |
| openai/gpt-5-mini | grid_track1 | $0.0533 | 55 | $0.00097 |
| openai/gpt-5-mini | grid_track3x3 | $0.0770 | 58 | $0.00133 |
| openai/gpt-5-mini | grid_track3x3_cam | $0.0764 | 55 | $0.00139 |
| venice/qwen3-vl-235b-a22b | single_frame | $0.0391 | 43 | $0.00091 |
| venice/qwen3-vl-235b-a22b | grid_1fps | $0.0546 | 58 | $0.00094 |
| venice/qwen3-vl-235b-a22b | burst | $0.0545 | 55 | $0.00099 |
| venice/qwen3-vl-235b-a22b | frames_1fps | $0.0420 | 27 | $0.00156 |
| venice/qwen3-vl-235b-a22b | trail_pair | $0.0431 | 37 | $0.00116 |
| venice/qwen3-vl-235b-a22b | trail_pair_nolegend | $0.0410 | 40 | $0.00103 |
| venice/qwen3-vl-235b-a22b | trail_lines | $0.0430 | 36 | $0.00119 |
| venice/qwen3-vl-235b-a22b | onion_pair | $0.0421 | 38 | $0.00111 |
| venice/qwen3-vl-235b-a22b | diff_pair | $0.0421 | 34 | $0.00124 |
| venice/qwen3-vl-235b-a22b | grid_track1 | $0.0559 | 53 | $0.00105 |
| venice/qwen3-vl-235b-a22b | grid_track3x3 | $0.0617 | 50 | $0.00123 |
| venice/qwen3-vl-235b-a22b | grid_track3x3_cam | $0.0635 | 50 | $0.00127 |
