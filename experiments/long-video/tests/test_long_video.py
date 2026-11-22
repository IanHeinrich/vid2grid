import json
from pathlib import Path

import pytest
from PIL import Image

import run
from dataset import Cue, Question, format_span, format_timestamp, parse_srt, transcript_text
from prompts import (
    CONDITIONS,
    SYSTEM,
    Condition,
    image_stub,
    pinning_request,
    sheet_line,
    single_request,
)
from render import Sheet
from scene import cut_keyframes, even_times, pick_scene_times
from score import mcnemar_p, parse_letter, smallest_net

QUESTIONS = [
    Question(
        f"q{i}", "vid", "Object Reasoning", "Knowledge", f"question {i}?", ("A. a", "B. b"), "A"
    )
    for i in range(3)
]


def sheets(tmp_path: Path, count: int = 2, frames: int = 20) -> list[Sheet]:
    made = []
    for index in range(count):
        path = tmp_path / f"grid_{index + 1:04d}.jpg"
        Image.new("RGB", (64, 64), (index * 40, 0, 0)).save(path)
        start = index * 600.0
        times = tuple(start + i * 30.0 for i in range(frames))
        made.append(Sheet(f"grid_{index + 1:04d}", path, times))
    return made


def test_scene_picks_count_sorted_and_cover_every_segment() -> None:
    duration = 3000.0
    candidates = [(t, 1.0) for t in range(0, 600, 5)] + [(2900.0, 0.1)]
    picks = pick_scene_times(duration, candidates, count=80, segments=20)
    assert len(picks) == 80
    assert picks == sorted(picks)
    segment = duration / 20
    for index in range(20):
        assert any(index * segment <= p < (index + 1) * segment for p in picks)


def test_scene_picks_take_the_biggest_changes_first_with_spacing() -> None:
    candidates = [(100.0, 9.0), (101.0, 8.0), (500.0, 7.0), (900.0, 0.5)]
    assert pick_scene_times(1000.0, candidates, count=4, segments=2) == [100.0, 250.0, 500.0, 900.0]


def test_scene_picks_fill_from_even_times_without_candidates() -> None:
    picks = pick_scene_times(800.0, [], count=8, segments=2)
    assert len(picks) == 8
    assert len(set(picks)) == 8


def test_cut_keyframes_drop_the_forced_cadence() -> None:
    keyframes = (0.0, 5.0, 10.0, 12.0, 17.0, 22.0, 23.5, 28.5)
    assert cut_keyframes(keyframes) == [12.0, 23.5]


def test_even_times_start_at_zero() -> None:
    assert even_times(80.0, 4) == [0.0, 20.0, 40.0, 60.0]


def test_timestamps_match_the_chat_app() -> None:
    assert format_timestamp(600) == "10:00"
    assert format_timestamp(3725) == "1:02:05"
    assert format_span(600, 1200) == "10:00 to 20:00"
    assert format_span(1.2, 3.0) == "0:01.2 to 0:03.0"


def test_stub_matches_image_stub_for_an_overview_sheet(tmp_path: Path) -> None:
    path = sheets(tmp_path, count=1)[0].path
    sheet = Sheet("grid_0002", path, tuple(600 + i * 600 / 19 for i in range(20)))
    assert image_stub(sheet) == (
        '[grid_0002 from overview: 10:00 to 20:00, 20 frames. Sent earlier; call recall("'
        'grid_0002 from overview") to see it again.]'
    )
    assert sheet_line(sheet) == "grid_0002: 10:00 to 20:00, 20 frames"


def test_single_request_uses_one_system_text_and_places_images(tmp_path: Path) -> None:
    made = sheets(tmp_path)
    blind = single_request(CONDITIONS["blind"], QUESTIONS[0], [], "", 40)
    grid = single_request(CONDITIONS["s4x20_t"], QUESTIONS[0], made, "[0:01] hi", 40)
    assert blind[0].parts == (SYSTEM,) == grid[0].parts
    assert not any(isinstance(p, Path) for p in blind[1].parts)
    images = [p for p in grid[1].parts if isinstance(p, Path)]
    assert images == [s.path for s in made]
    text = "\n".join(p for p in grid[1].parts if isinstance(p, str))
    assert "[0:01] hi" in text
    assert "question 0?" in text
    assert "grid_0001: 0:00 to 9:30, 20 frames" in text


def test_scene_and_even_prompts_differ_only_in_images(tmp_path: Path) -> None:
    made = sheets(tmp_path)
    scene = single_request(CONDITIONS["scene4x20"], QUESTIONS[0], made, "", 40)
    even = single_request(CONDITIONS["even4x20"], QUESTIONS[0], made, "", 40)
    assert scene == even


def test_transcript_without_subtitles_says_so() -> None:
    request = single_request(CONDITIONS["transcript"], QUESTIONS[0], [], "", 40)
    assert "no subtitles exist" in request[1].parts[-1]


def test_pinning_stubs_images_only_from_turn_two(tmp_path: Path) -> None:
    made = sheets(tmp_path)
    first = pinning_request("stubbed", QUESTIONS, [], made, "[0:01] hi", 40)
    pinned = pinning_request("pinned", QUESTIONS, ["a1", "a2"], made, "[0:01] hi", 40)
    stubbed = pinning_request("stubbed", QUESTIONS, ["a1", "a2"], made, "[0:01] hi", 40)
    assert first == pinning_request("pinned", QUESTIONS, [], made, "[0:01] hi", 40)
    assert [m.role for m in stubbed] == ["system", "user", "assistant", "user", "assistant", "user"]
    assert sum(isinstance(p, Path) for p in pinned[1].parts) == 2
    assert not any(isinstance(p, Path) for m in stubbed for p in m.parts)
    assert "Sent earlier" in stubbed[1].parts[0]
    assert "question 2?" in stubbed[-1].parts[0]


def test_srt_parsing_strips_tags_and_repeats() -> None:
    srt = (
        '1\n00:00:02,880 --> 00:00:08,800\n<font color="white">hello</font>\n\n'
        "2\n00:01:05,000 --> 00:01:08,000\nhello\n\n3\n01:00:00,000 --> 01:00:01,000\nbye\n"
    )
    cues = parse_srt(srt)
    assert cues == [Cue(2.88, 8.8, "hello"), Cue(65.0, 68.0, "hello"), Cue(3600.0, 3601.0, "bye")]
    assert transcript_text(cues) == "[0:02] hello\n[1:00:00] bye"


def test_mcnemar_exact_values() -> None:
    assert mcnemar_p(0, 0) == 1.0
    assert mcnemar_p(6, 0) == pytest.approx(0.03125)
    assert mcnemar_p(9, 1) == pytest.approx(22 / 1024)
    assert mcnemar_p(3, 3) == 1.0
    assert smallest_net(10) == 8
    assert smallest_net(4) is None


def test_parse_letter() -> None:
    assert parse_letter('{"answer": "C"}') == "C"
    assert parse_letter('```json\n{"answer": "b. thing"}\n```') == "B"
    assert parse_letter("The answer is D.") == "D"
    assert parse_letter("no idea") == ""


def test_round_caps_hold(monkeypatch: pytest.MonkeyPatch) -> None:
    assert run.budget_for("venice", "p0", None) == 5.0
    assert run.budget_for("gemini", "p0", None) == 4.0
    assert run.budget_for("gemini", "p0", 1.0) == 1.0
    with pytest.raises(SystemExit):
        run.budget_for("venice", "p0", 6.0)


def test_ledger_totals_by_round_and_gate_stops(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(run, "LEDGER", tmp_path / "ledger.jsonl")
    monkeypatch.setattr(run, "OUT", tmp_path)
    run.append_ledger({"provider": "venice", "cost_usd": 1.5}, "p0")
    run.append_ledger({"provider": "venice", "cost_usd": 2.0}, "other")
    run.append_ledger({"provider": "gemini", "cost_usd": 0.5}, "p0")
    assert run.ledger_total("venice", "p0") == 1.5
    price = run.Price(1.0, 1.0, 1000, 10, {}, None, 1000, 3.5)
    run.gate(run.Budget("p0", 0.0, 1.0), price, 1000)
    with pytest.raises(run.BudgetReached):
        run.gate(run.Budget("p0", 0.999, 1.0), price, 1000)
    lines = [json.loads(line) for line in (tmp_path / "ledger.jsonl").read_text().splitlines()]
    assert {line["round"] for line in lines} == {"p0", "other"}


def test_cache_key_follows_image_bytes(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(run, "ANSWERS", tmp_path / "answers")
    made = sheets(tmp_path, count=1)
    messages = single_request(CONDITIONS["s4x20"], QUESTIONS[0], made, "", 40)
    before = run.cache_path("venice", "m", "s4x20", "q0", 0, messages)
    run.image_digest.cache_clear()
    Image.new("RGB", (64, 64), (0, 200, 0)).save(made[0].path)
    after = run.cache_path("venice", "m", "s4x20", "q0", 0, messages)
    assert before != after


def test_condition_table_covers_the_brief() -> None:
    layouts = {c.layout for c in CONDITIONS.values()}
    assert layouts == {None, "s4x20", "s4x9", "s8x9", "f10", "scene", "even"}
    assert CONDITIONS["f10_t"] == Condition("f10", True)


def test_blocks_keep_each_group_together_in_order() -> None:
    names = ["s8x9", "blind", "s8x9_t", "even4x20", "scene4x20", "pinned"]
    assert run.blocks(names) == [["s8x9", "s8x9_t"], ["blind"], ["even4x20", "scene4x20"]]
