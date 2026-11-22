import json
import math
import re
import statistics
from collections import defaultdict
from dataclasses import dataclass
from typing import Any

from dataset import Question, load_questions
from prompts import CONDITIONS
from run import ANSWERS, OUT, PINNING_TURN_ONE, ROUND, SCENE, ledger_entries

RESULTS = OUT / "results.md"
ALPHA = 0.05
MIN_GROUP = 10
LAYOUTS = ("s4x20", "s4x9", "s8x9", "f10")
TURN_LABELS = {0: "turn 1 (shared)", 1: "turn 2", 2: "turn 3"}

# (model, condition, question_id) -> correct
Outcomes = dict[tuple[str, str, str], bool]


@dataclass(frozen=True)
class Comparison:
    baseline: str
    condition: str
    note: str = ""


def comparisons() -> list[tuple[str, list[Comparison]]]:
    versus_blind = [Comparison("blind", c) for c in ("transcript", *LAYOUTS)]
    with_transcript = [Comparison(c, f"{c}_t") for c in LAYOUTS]
    images_on_transcript = [Comparison("transcript", f"{c}_t") for c in LAYOUTS]
    pairs = [(a, b) for i, a in enumerate(LAYOUTS) for b in LAYOUTS[i + 1 :]]
    layouts = [Comparison(a, b) for a, b in pairs]
    layouts_t = [Comparison(f"{a}_t", f"{b}_t") for a, b in pairs]
    scene = [
        Comparison("even4x20", "scene4x20"),
        Comparison("s4x20", "even4x20", "same frames, library sheet against own grid"),
    ]
    return [
        ("Each layout and the transcript against blind", versus_blind),
        ("Adding the transcript to each layout", with_transcript),
        ("Adding each layout's images to the transcript", images_on_transcript),
        ("Layouts against each other, no transcript", layouts),
        ("Layouts against each other, with transcript", layouts_t),
        ("Scene picks against even spacing", scene),
        ("Pinned overview against stubs, turns 2 and 3", [Comparison("pinned", "stubbed")]),
    ]


def parse_letter(text: str) -> str:
    unfenced = re.sub(r"```(?:json)?", "", text)
    match = re.search(r"\{.*\}", unfenced, re.DOTALL)
    if match:
        try:
            data = json.loads(match.group(0))
        except json.JSONDecodeError:
            data = None
        if isinstance(data, dict):
            found = re.match(r"^\s*\(?([A-Da-d])(?![A-Za-z])", str(data.get("answer", "")))
            return found.group(1).upper() if found else ""
    found = re.search(r"\b([A-D])\b", text)
    return found.group(1) if found else ""


def mcnemar_p(fixed: int, broke: int) -> float:
    n = fixed + broke
    if n == 0:
        return 1.0
    tail = sum(math.comb(n, i) for i in range(min(fixed, broke) + 1)) / 2**n
    return min(1.0, 2 * tail)


# The smallest net gain (fixed minus broke) that reaches ALPHA when `discordant` questions change.
def smallest_net(discordant: int) -> int | None:
    for fixed in range((discordant + 1) // 2, discordant + 1):
        if mcnemar_p(fixed, discordant - fixed) < ALPHA:
            return 2 * fixed - discordant
    return None


def pct(hits: int, total: int) -> str:
    return f"{100 * hits / total:.0f}% ({hits}/{total})" if total else "-"


def table(header: list[str], rows: list[list[str]]) -> list[str]:
    if not rows:
        return ["No data yet.", ""]
    lines = ["| " + " | ".join(header) + " |", "| " + " | ".join("---" for _ in header) + " |"]
    lines += ["| " + " | ".join(row) + " |" for row in rows]
    return [*lines, ""]


def load_records() -> list[dict[str, Any]]:
    paths = sorted(ANSWERS.glob("*.json"), key=lambda path: path.stat().st_mtime)
    records = [json.loads(path.read_text()) for path in paths]
    return [r for r in records if r.get("round") == ROUND]


def model_name(record: dict[str, Any]) -> str:
    return f"{record['provider']}/{record['model']}"


def outcomes_of(records: list[dict[str, Any]], questions: dict[str, Question]) -> Outcomes:
    outcomes: Outcomes = {}
    for record in records:
        question = questions[record["question_id"]]
        right = parse_letter(record["response"]) == question.answer
        outcomes[(model_name(record), record["condition"], question.question_id)] = right
    return outcomes


def paired(outcomes: Outcomes, model: str, comparison: Comparison) -> list[tuple[bool, bool]]:
    pairs = []
    for (m, condition, qid), right in outcomes.items():
        if m == model and condition == comparison.condition:
            base = outcomes.get((model, comparison.baseline, qid))
            if base is not None:
                pairs.append((base, right))
    return pairs


def comparison_row(label: str, pairs: list[tuple[bool, bool]], comparison: Comparison) -> list[str]:
    fixed = sum(1 for base, new in pairs if new and not base)
    broke = sum(1 for base, new in pairs if base and not new)
    base_hits = sum(base for base, _ in pairs)
    new_hits = sum(new for _, new in pairs)
    n = len(pairs)
    diff = f"{100 * (new_hits - base_hits) / n:+.0f} pts" if n else "-"
    return [
        label,
        f"{comparison.condition} vs {comparison.baseline}",
        str(n),
        pct(base_hits, n),
        pct(new_hits, n),
        diff,
        str(fixed),
        str(broke),
        f"{mcnemar_p(fixed, broke):.3f}",
    ]


def comparison_section(outcomes: Outcomes, models: list[str]) -> list[str]:
    header = ["model", "comparison", "n", "baseline", "condition", "diff", "fixed", "broke", "p"]
    lines = [
        "## Paired comparisons",
        "",
        "Each row pairs the same questions under a baseline and a condition. Fixed counts "
        "questions the condition got right and the baseline wrong; broke counts the reverse. "
        "p is the exact two-sided McNemar test on those two counts. Pooled stacks both models' "
        "pairs, so it has up to twice the questions. The two models' answers on one question "
        "are not independent, so a pooled p is optimistic.",
        "",
    ]
    for title, items in comparisons():
        rows = []
        for comparison in items:
            pooled: list[tuple[bool, bool]] = []
            contributing = 0
            for model in models:
                pairs = paired(outcomes, model, comparison)
                pooled += pairs
                if pairs:
                    contributing += 1
                    rows.append(comparison_row(model, pairs, comparison))
            if contributing > 1:
                rows.append(comparison_row("pooled", pooled, comparison))
        notes = [c.note for c in items if c.note]
        lines += [f"### {title}", "", *([f"{'; '.join(notes)}.", ""] if notes else [])]
        lines += table(header, rows)
    return lines


def power_section() -> list[str]:
    rows = []
    for discordant in (6, 10, 15, 20, 30, 40):
        net = smallest_net(discordant)
        cells = [str(discordant), "-" if net is None else str(net)]
        for n in (90, 180):
            cells.append("-" if net is None else f"{100 * net / n:.0f} pts")
        rows.append(cells)
    note = (
        "What 90 paired questions can detect. A difference needs a lopsided split of the "
        "questions that changed answer: the table gives the smallest net gain (fixed minus "
        f"broke) that reaches p < {ALPHA} for a given number of changed questions, and what "
        "that is in accuracy points on one model (90) or pooled (180). Most comparisons here "
        "changed 5 to 25 answers, so one model needs a gap of about 8 to 12 points and the "
        "pooled figures about 5 to 7; anything smaller reads as noise."
    )
    header = ["changed questions", "smallest net gain", "on 90", "on 180"]
    return ["## What this sample can detect", "", note, "", *table(header, rows)]


def accuracy_section(
    records: list[dict[str, Any]], outcomes: Outcomes, models: list[str], conditions: list[str]
) -> list[str]:
    tokens: dict[tuple[str, str], list[int]] = defaultdict(list)
    spend: dict[tuple[str, str], float] = defaultdict(float)
    unparsed: dict[tuple[str, str], int] = defaultdict(int)
    for record in records:
        key = (model_name(record), record["condition"])
        tokens[key].append(int(record["usage"]["prompt_tokens"]))
        spend[key] += float(record["cost_usd"])
        unparsed[key] += int(parse_letter(record["response"]) == "")
    rows = []
    for model in models:
        for condition in conditions:
            results = [r for (m, c, _), r in outcomes.items() if m == model and c == condition]
            if not results:
                continue
            key = (model, condition)
            right = sum(results)
            per = f"${spend[key] / right:.4f}" if right else "-"
            rows.append(
                [
                    model,
                    condition,
                    pct(right, len(results)),
                    f"{statistics.mean(tokens[key]):,.0f}",
                    f"${spend[key]:.3f}",
                    per,
                    str(unparsed[key]),
                ]
            )
    header = [
        "model",
        "condition",
        "accuracy",
        "input tokens",
        "spent",
        "per correct",
        "unparsed",
    ]
    note = (
        "Input tokens are the mean prompt tokens per request as billed. Chance is 25%. For "
        "pinned and stubbed, only turns 2 and 3 are counted; turn 1 is listed as pinning."
    )
    return ["## Accuracy, tokens and cost", "", note, "", *table(header, rows)]


def group_section(
    title: str,
    outcomes: Outcomes,
    models: list[str],
    conditions: list[str],
    group_of: dict[str, str],
) -> list[str]:
    sizes: dict[str, int] = defaultdict(int)
    for group in group_of.values():
        sizes[group] += 1
    groups = sorted((g for g in sizes if sizes[g] >= MIN_GROUP), key=lambda g: -sizes[g])
    dropped = sorted(g for g in sizes if sizes[g] < MIN_GROUP)
    rows = []
    for model in models:
        for condition in conditions:
            cells = []
            for group in groups:
                results = [
                    r
                    for (m, c, qid), r in outcomes.items()
                    if m == model and c == condition and group_of.get(qid) == group
                ]
                cells.append(pct(sum(results), len(results)))
            if any(cell != "-" for cell in cells):
                rows.append([model, condition, *cells])
    header = ["model", "condition", *(f"{g} ({sizes[g]})" for g in groups)]
    note = f"Groups under {MIN_GROUP} questions are left out: {', '.join(dropped) or 'none'}."
    return [f"## {title}", "", note, "", *table(header, rows)]


def pinning_section(
    records: list[dict[str, Any]], outcomes: Outcomes, models: list[str]
) -> list[str]:
    rows = []
    for model in models:
        for variant in ("pinned", "stubbed"):
            for turn in (0, 1, 2):
                condition = PINNING_TURN_ONE if turn == 0 else variant
                chosen = [
                    r
                    for r in records
                    if model_name(r) == model and r["condition"] == condition and r["turn"] == turn
                ]
                if not chosen:
                    continue
                right = sum(outcomes[(model, condition, r["question_id"])] for r in chosen)
                tokens = statistics.mean(int(r["usage"]["prompt_tokens"]) for r in chosen)
                spent = statistics.mean(float(r["cost_usd"]) for r in chosen)
                rows.append(
                    [
                        model,
                        variant,
                        TURN_LABELS[turn],
                        pct(right, len(chosen)),
                        f"{tokens:,.0f}",
                        f"${spent:.5f}",
                    ]
                )
    header = ["model", "variant", "turn", "accuracy", "input tokens", "cost per turn"]
    note = (
        "Each video's three questions as one conversation, with the s4x20 overview and the "
        "transcript in turn 1. Pinned resends the overview images every turn; stubbed replaces "
        "them with the chat app's text stubs from turn 2. Turn 1 is the same request for both."
    )
    return ["## Pinning per turn", "", note, "", *table(header, rows)]


def scene_section() -> list[str]:
    stats = [json.loads(path.read_text())["stats"] for path in sorted(SCENE.glob("*.json"))]
    if not stats:
        return []
    seconds = [float(s["demux_seconds"]) for s in stats]
    hours = sum(float(s["duration"]) for s in stats) / 3600
    keyframes = [len(s["keyframes"]) for s in stats]
    return [
        "## Demux pass",
        "",
        f"{len(stats)} videos, {hours:.1f} hours in all. Reading every packet's time, size and "
        f"keyframe flag took {statistics.mean(seconds):.2f} s per video on average (max "
        f"{max(seconds):.2f} s), {sum(seconds) / hours:.1f} s per hour of video. Videos had "
        f"{min(keyframes)} to {max(keyframes)} keyframes.",
        "",
    ]


def spend_section() -> list[str]:
    totals: dict[tuple[str, str], float] = defaultdict(float)
    counts: dict[tuple[str, str], int] = defaultdict(int)
    for entry in ledger_entries():
        key = (str(entry.get("round")), entry["provider"])
        totals[key] += float(entry["cost_usd"])
        counts[key] += 1
    rows = [
        [tag, provider, str(counts[(tag, provider)]), f"${spent:.4f}"]
        for (tag, provider), spent in sorted(totals.items())
    ]
    return ["## Spend", "", *table(["round", "provider", "requests", "spent"], rows)]


def main() -> None:
    questions = {q.question_id: q for q in load_questions()}
    records = load_records()
    if not records:
        print(f"no cached responses in {ANSWERS}; run run.py first")
        return
    outcomes = outcomes_of(records, questions)
    models = sorted({model_name(r) for r in records})
    present = {c for _, c, _ in outcomes}
    conditions = [c for c in (*CONDITIONS, PINNING_TURN_ONE, "pinned", "stubbed") if c in present]
    singles = [c for c in conditions if c in CONDITIONS]
    task_of = {qid: q.task_group for qid, q in questions.items()}
    domain_of = {qid: q.domain for qid, q in questions.items()}
    videos = {q.video for q in questions.values()}
    lines = [
        "# Long-video phase 0 results",
        "",
        f"{len(questions)} Video-MME long questions on {len(videos)} videos, "
        f"{len(records)} responses. Only aggregates and question ids appear here.",
        "",
        *spend_section(),
        *power_section(),
        *accuracy_section(records, outcomes, models, conditions),
        *comparison_section(outcomes, models),
        *pinning_section(records, outcomes, models),
        *group_section("Accuracy by task group", outcomes, models, singles, task_of),
        *group_section("Accuracy by domain", outcomes, models, singles, domain_of),
        *scene_section(),
    ]
    RESULTS.write_text("\n".join(lines))
    print(f"wrote {RESULTS}")


if __name__ == "__main__":
    main()
