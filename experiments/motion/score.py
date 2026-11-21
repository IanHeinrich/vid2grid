import json
import re
from collections import defaultdict
from typing import Any

from conditions import CONDITIONS, supports
from make_clips import reversed_truth
from questions import QUESTIONS
from run import CACHE, LEDGER, OUT, clip_set, load_manifest

RESULTS = OUT / "results.md"
DIRECTION_KEYS = ("direction_red", "direction_blue", "first_direction", "second_direction")
MOTION_CLAIMS = {"moved": "no", "direction_red": "none", "background": "none"}

Answers = dict[tuple[str, str, str], dict[str, str] | None]
Counts = dict[tuple[str, str, str], int]


def parse_answer(text: str) -> dict[str, str] | None:
    unfenced = re.sub(r"```(?:json)?", "", text)
    match = re.search(r"\{.*\}", unfenced, re.DOTALL)
    if not match:
        return None
    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return None
    return {str(k): str(v).strip().lower() for k, v in data.items()}


def letter(value: str | None) -> str:
    match = re.match(r"^\(?([a-z])(?![a-z])", value or "")
    return match.group(1) if match else ""


def correct(key: str, expected: str, answer: dict[str, str] | None) -> bool:
    if answer is None:
        return False
    if key == "answer":
        return letter(answer.get(key)) == expected.lower()
    return answer.get(key) == expected


def question_type(clip: dict[str, Any], key: str) -> str:
    return clip["kind"] if key == "answer" else QUESTIONS[key].type


def pct(hits: int, total: int) -> str:
    return f"{100 * hits / total:.0f}% ({hits}/{total})" if total else "-"


def table(header: list[str], rows: list[list[str]]) -> list[str]:
    if not rows:
        return ["No data yet.", ""]
    lines = ["| " + " | ".join(header) + " |", "| " + " | ".join("---" for _ in header) + " |"]
    lines += ["| " + " | ".join(row) + " |" for row in rows]
    return [*lines, ""]


# Drops replies a provider was sent for a condition it cannot take, such as a video condition
# sent as a bare prompt by a run that predates the provider check.
def load_records() -> list[dict[str, Any]]:
    records = [json.loads(path.read_text()) for path in sorted(CACHE.glob("*.json"))]
    return [r for r in records if supports(r["condition"], r["provider"])]


def ledger_costs() -> dict[tuple[str, str, str], float]:
    costs: dict[tuple[str, str, str], float] = defaultdict(float)
    if LEDGER.is_file():
        for line in LEDGER.read_text().splitlines():
            if not line.strip():
                continue
            entry = json.loads(line)
            if supports(entry["condition"], entry["provider"]):
                model = f"{entry['provider']}/{entry['model']}"
                costs[(model, entry["condition"], entry["clip"])] += float(entry["cost_usd"])
    return costs


def tally(clips: dict[str, dict[str, Any]], answers: Answers) -> tuple[Counts, Counts, Counts]:
    hits: Counts = defaultdict(int)
    totals: Counts = defaultdict(int)
    failures: Counts = defaultdict(int)
    for (model, condition, clip_id), answer in answers.items():
        clip = clips[clip_id]
        if answer is None:
            failures[(model, condition, "all")] += 1
        for key, expected in clip["truth"].items():
            for bucket in ("all", question_type(clip, key)):
                totals[(model, condition, bucket)] += 1
                hits[(model, condition, bucket)] += int(correct(key, expected, answer))
    return hits, totals, failures


def accuracy_section(
    models: list[str], conditions: list[str], hits: Counts, totals: Counts, failures: Counts
) -> list[str]:
    rows = []
    for model in models:
        base_total = totals[(model, "single_frame", "all")]
        base = hits[(model, "single_frame", "all")] / base_total if base_total else None
        for condition in conditions:
            total = totals[(model, condition, "all")]
            if not total:
                continue
            accuracy = hits[(model, condition, "all")] / total
            gain = f"{100 * (accuracy - base):+.0f} pts" if base is not None else "-"
            unparsed = str(failures[(model, condition, "all")])
            rows.append(
                [model, condition, pct(hits[(model, condition, "all")], total), gain, unparsed]
            )
    header = ["model", "condition", "accuracy", "gain over single_frame", "unparsed"]
    return ["### Accuracy per model and condition", "", *table(header, rows)]


def type_section(
    title: str,
    models: list[str],
    conditions: list[str],
    types: list[str],
    hits: Counts,
    totals: Counts,
) -> list[str]:
    rows = []
    for model in models:
        for condition in conditions:
            if totals[(model, condition, "all")]:
                cells = [
                    pct(hits[(model, condition, t)], totals[(model, condition, t)]) for t in types
                ]
                rows.append([model, condition, *cells])
    return [f"### {title}", "", *table(["model", "condition", *types], rows)]


def reverse_section(
    clips: dict[str, dict[str, Any]], answers: Answers, models: list[str], conditions: list[str]
) -> list[str]:
    rows = []
    for model in models:
        for condition in conditions:
            consistent = total = 0
            for clip_id, clip in clips.items():
                forward = answers.get((model, condition, clip["reverse_of"] or ""))
                backward = answers.get((model, condition, clip_id))
                if forward is None or backward is None:
                    continue
                keys = [k for k in clip["truth"] if k in DIRECTION_KEYS or k == "background"]
                expected = reversed_truth({k: forward.get(k, "") for k in keys})
                for key in keys:
                    total += 1
                    consistent += int(backward.get(key) == expected[key])
            if total:
                rows.append([model, condition, pct(consistent, total)])
    note = (
        "Share of direction answers on a reversed copy that are the flip of the answer on "
        "the original, whether or not either is correct."
    )
    return [
        "### Reverse consistency",
        "",
        note,
        "",
        *table(["model", "condition", "consistent"], rows),
    ]


def static_section(
    clips: dict[str, dict[str, Any]], answers: Answers, models: list[str], conditions: list[str]
) -> list[str]:
    rows = []
    for model in models:
        for condition in conditions:
            moved = claims = objects = total = 0
            for clip_id, clip in clips.items():
                answer = answers.get((model, condition, clip_id))
                if not clip["kind"].endswith("static") or answer is None:
                    continue
                total += 1
                moved += int(answer.get("moved") == "yes")
                claims += int(any(answer.get(k, v) != v for k, v in MOTION_CLAIMS.items()))
                objects += int(answer.get("object_moved") == "yes")
            if total:
                rows.append(
                    [model, condition, pct(moved, total), pct(claims, total), pct(objects, total)]
                )
    note = (
        "On hard static clips the camera shakes, so the right answer to moved is yes; "
        "object_moved (asked only on hard clips) is the false-motion measure there."
    )
    header = ["model", "condition", "said moved", "claimed any motion", "said a ball moved"]
    return ["### False motion on static clips", "", note, "", *table(header, rows)]


def count_section(
    clips: dict[str, dict[str, Any]], answers: Answers, models: list[str], conditions: list[str]
) -> list[str]:
    rows = []
    for model in models:
        for condition in conditions:
            over = under = total = error = 0
            for clip_id, clip in clips.items():
                answer = answers.get((model, condition, clip_id))
                if "count" not in clip["truth"] or answer is None:
                    continue
                truth = int(clip["truth"]["count"])
                given = answer.get("count", "")
                total += 1
                if not given.isdigit():
                    under += 1
                    error += truth
                    continue
                over += int(int(given) > truth)
                under += int(int(given) < truth)
                error += abs(int(given) - truth)
            if total:
                rows.append(
                    [model, condition, pct(over, total), pct(under, total), f"{error / total:.2f}"]
                )
    note = "Over-counting is the likely sign of ghosts or blended copies read as extra passes."
    header = ["model", "condition", "over", "under or missing", "mean abs error"]
    return ["### Count errors", "", note, "", *table(header, rows)]


def chance_section(clips: dict[str, dict[str, Any]], types: list[str]) -> list[str]:
    rows = []
    for kind in types:
        chances = [1 / len(c["options"]) for c in clips.values() if c["kind"] == kind]
        if chances:
            rows.append([kind, str(len(chances)), f"{100 * sum(chances) / len(chances):.0f}%"])
    note = "Chance is the mean of 1 / number of options over the questions in each dimension."
    return ["### Chance level", "", note, "", *table(["dimension", "questions", "chance"], rows)]


def cost_section(
    clips: dict[str, dict[str, Any]],
    models: list[str],
    conditions: list[str],
    hits: Counts,
    totals: Counts,
) -> list[str]:
    costs = ledger_costs()
    rows = []
    for model in models:
        for condition in conditions:
            if not totals[(model, condition, "all")]:
                continue
            spent = sum(costs.get((model, condition, clip_id), 0.0) for clip_id in clips)
            right = hits[(model, condition, "all")]
            per = f"${spent / right:.5f}" if right else "-"
            rows.append([model, condition, f"${spent:.4f}", str(right), per])
    header = ["model", "condition", "spent", "correct", "per correct"]
    return ["### Estimated cost per correct answer", "", *table(header, rows)]


def set_section(name: str, clips: dict[str, dict[str, Any]], answers: Answers) -> list[str]:
    answers = {k: v for k, v in answers.items() if k[2] in clips}
    lines = [f"## {name}", "", f"{len(answers)} responses over {len(clips)} clips.", ""]
    if not answers:
        return [*lines, "No data yet.", ""]
    models = sorted({m for m, _, _ in answers})
    present = {c for _, c, _ in answers}
    conditions = [c for c in CONDITIONS if c in present]
    types = list(
        dict.fromkeys(
            question_type(clip, key) for clip in clips.values() for key in sorted(clip["truth"])
        )
    )
    hits, totals, failures = tally(clips, answers)
    lines += accuracy_section(models, conditions, hits, totals, failures)
    if name == "tempcompass":
        lines += type_section("Accuracy per dimension", models, conditions, types, hits, totals)
        lines += chance_section(clips, types)
    else:
        lines += type_section("Accuracy per question type", models, conditions, types, hits, totals)
        lines += reverse_section(clips, answers, models, conditions)
        lines += static_section(clips, answers, models, conditions)
        lines += count_section(clips, answers, models, conditions)
    lines += cost_section(clips, models, conditions, hits, totals)
    return lines


def main() -> None:
    clips = {clip["id"]: clip for clip in load_manifest()}
    records = load_records()
    if not records:
        print(f"no cached responses in {CACHE}; run run.py first")
        return
    answers: Answers = {}
    for record in records:
        if record["clip"] in clips:
            model = f"{record['provider']}/{record['model']}"
            answers[(model, record["condition"], record["clip"])] = parse_answer(record["response"])

    lines = ["# Motion view experiment results", ""]
    for name in ("synthetic", "hard", "tempcompass"):
        members = {k: v for k, v in clips.items() if clip_set(v) == name}
        if members:
            lines += set_section(name, members, answers)
    RESULTS.write_text("\n".join(lines))
    print(f"wrote {RESULTS}")


if __name__ == "__main__":
    main()
