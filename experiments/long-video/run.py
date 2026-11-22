import argparse
import contextlib
import hashlib
import json
import math
import os
import sys
import time
from collections.abc import Iterator
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import Any

from PIL import Image

from dataset import CACHE_ROOT, Question, load_cues, questions_by_video, transcript_text, video_path
from prompts import (
    CONDITIONS,
    GROUPS,
    PINNING,
    PINNING_LAYOUT,
    Message,
    pinning_request,
    single_request,
)
from providers import PROVIDERS, Provider, ProviderError, Reply, api_key, complete
from render import LAYOUTS, Sheet, render_grid_set, render_layout
from scene import PacketStats, even_times, pick_scene_times, read_packet_stats, scored_candidates

ROOT = Path(__file__).parent
OUT = ROOT / "out"
LEDGER = OUT / "ledger.jsonl"
LOCK = OUT / "run.lock"
PRICING = ROOT / "pricing.json"
ANSWERS = CACHE_ROOT / "answers"
RENDERS = CACHE_ROOT / "renders"
SCENE = CACHE_ROOT / "scene"
MODELS = {"venice": "qwen3-vl-235b-a22b", "gemini": "gemini-3.1-flash-lite"}
ROUND = "p0"
ROUND_CAPS = {"p0": {"venice": 5.00, "gemini": 4.00}}
DEFAULT_BUDGET = 4.0
# The budget gate pads the input estimate, since providers count tokens differently.
INPUT_SAFETY = 1.5
DEFAULT_CHARS_PER_TOKEN = 3.5
PINNING_TURN_ONE = "pinning"
PLACEHOLDER_REPLY = '{"answer": "A"}'


class BudgetReached(Exception):
    pass


@dataclass(frozen=True)
class Price:
    input: float
    output: float
    max_tokens: int
    expected_output: int
    extra: dict[str, Any]
    image_tokens_per_mpx: float | None
    image_tokens: int | None
    chars_per_token: float


@dataclass(frozen=True)
class Material:
    video: str
    minutes: int
    transcript: str
    sheets: dict[str, list[Sheet]]


@dataclass
class Budget:
    round_tag: str
    spent: float
    limit: float


def load_pricing() -> dict[str, dict[str, Any]]:
    pricing: dict[str, dict[str, Any]] = json.loads(PRICING.read_text())
    return pricing


def price_for(pricing: dict[str, dict[str, Any]], provider: str, model: str) -> Price | None:
    entry = pricing.get(provider, {}).get(model)
    if not isinstance(entry, dict):
        return None
    return Price(
        float(entry["input"]),
        float(entry["output"]),
        int(entry["max_tokens"]),
        int(entry["expected_output"]),
        dict(entry.get("extra", {})),
        entry.get("image_tokens_per_mpx"),
        entry.get("image_tokens"),
        float(entry.get("chars_per_token", DEFAULT_CHARS_PER_TOKEN)),
    )


def cost(price: Price, prompt_tokens: int, output_tokens: int) -> float:
    return (prompt_tokens * price.input + output_tokens * price.output) / 1_000_000


@cache
def image_size(path: Path) -> tuple[int, int]:
    with Image.open(path) as image:
        return image.size


def image_tokens(price: Price, path: Path) -> int:
    if price.image_tokens is not None:
        return price.image_tokens
    width, height = image_size(path)
    return math.ceil(width * height / 1_000_000 * (price.image_tokens_per_mpx or 1000))


def input_tokens(messages: list[Message], price: Price) -> int:
    total = 0
    for message in messages:
        total += 8
        for part in message.parts:
            if isinstance(part, Path):
                total += image_tokens(price, part)
            else:
                total += math.ceil(len(part) / price.chars_per_token)
    return total


@cache
def image_digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:24]


def messages_key(messages: list[Message]) -> list[Any]:
    return [
        [m.role, [image_digest(p) if isinstance(p, Path) else p for p in m.parts]] for m in messages
    ]


# The image bytes are part of the key, so a changed render never reuses an old answer.
def cache_path(
    provider: str, model: str, condition: str, question_id: str, turn: int, messages: list[Message]
) -> Path:
    key = [provider, model, condition, question_id, turn, messages_key(messages)]
    return ANSWERS / f"{hashlib.sha256(json.dumps(key).encode()).hexdigest()[:24]}.json"


def ledger_entries() -> list[dict[str, Any]]:
    if not LEDGER.is_file():
        return []
    return [json.loads(line) for line in LEDGER.read_text().splitlines() if line.strip()]


def ledger_total(provider: str, round_tag: str) -> float:
    return sum(
        float(entry["cost_usd"])
        for entry in ledger_entries()
        if entry["provider"] == provider and str(entry.get("round")) == round_tag
    )


def append_ledger(entry: dict[str, Any], round_tag: str) -> None:
    OUT.mkdir(exist_ok=True)
    with LEDGER.open("a") as ledger:
        ledger.write(json.dumps({**entry, "round": round_tag}) + "\n")


def budget_for(provider: str, round_tag: str, requested: float | None) -> float:
    cap = ROUND_CAPS.get(round_tag, {}).get(provider)
    if cap is None:
        return DEFAULT_BUDGET if requested is None else requested
    if requested is not None and requested > cap:
        sys.exit(f"--budget-usd {requested:.2f} is over round {round_tag}'s {provider} cap")
    return cap if requested is None else requested


def gate(budget: Budget, price: Price, estimate_in: int) -> None:
    worst = cost(price, round(estimate_in * INPUT_SAFETY), price.max_tokens)
    if budget.spent + worst > budget.limit:
        raise BudgetReached(
            f"stopping: ${budget.spent:.4f} spent + ${worst:.4f} worst case would pass "
            f"${budget.limit:.2f}"
        )


# One chain at a time: an earlier round paid twice when two chains overlapped.
@contextlib.contextmanager
def run_lock() -> Iterator[None]:
    OUT.mkdir(exist_ok=True)
    try:
        handle = os.open(LOCK, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        sys.exit(f"{LOCK} exists: another run is going, or a crashed one left it; check first")
    os.write(handle, str(os.getpid()).encode())
    os.close(handle)
    try:
        yield
    finally:
        LOCK.unlink(missing_ok=True)


def scene_stats(video: str) -> tuple[PacketStats, list[float]]:
    path = SCENE / f"{video}.json"
    if path.is_file():
        data = json.loads(path.read_text())
        return PacketStats.from_dict(data["stats"]), [float(t) for t in data["picks"]]
    stats = read_packet_stats(video_path(video))
    picks = pick_scene_times(stats.duration, scored_candidates(stats))
    SCENE.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"stats": stats.to_dict(), "picks": picks}))
    return stats, picks


def prepare(video: str, layouts: set[str]) -> Material:
    source = video_path(video)
    stats, picks = scene_stats(video)
    sheets: dict[str, list[Sheet]] = {}
    for layout in LAYOUTS:
        if layout in layouts:
            sheets[layout] = render_layout(source, layout, RENDERS / video / layout)
    if "scene" in layouts:
        sheets["scene"] = render_grid_set(source, picks, RENDERS / video / "scene")
    if "even" in layouts:
        even = even_times(stats.duration)
        sheets["even"] = render_grid_set(source, even, RENDERS / video / "even")
    transcript = transcript_text(load_cues(video))
    return Material(video, round(stats.duration / 60), transcript, sheets)


def layouts_for(conditions: list[str]) -> set[str]:
    layouts = {CONDITIONS[c].layout for c in conditions if c in CONDITIONS}
    if any(c in PINNING for c in conditions):
        layouts.add(PINNING_LAYOUT)
    return {layout for layout in layouts if layout is not None}


def single_messages(condition: str, question: Question, material: Material) -> list[Message]:
    spec = CONDITIONS[condition]
    sheets = material.sheets[spec.layout] if spec.layout else []
    return single_request(spec, question, sheets, material.transcript, material.minutes)


def pinning_messages(
    variant: str, questions: list[Question], replies: list[str], material: Material
) -> list[Message]:
    sheets = material.sheets[PINNING_LAYOUT]
    return pinning_request(
        variant, questions, replies, sheets, material.transcript, material.minutes
    )


def pinning_condition(variant: str, turn: int) -> str:
    return PINNING_TURN_ONE if turn == 0 else variant


def ask(
    provider: Provider,
    model: str,
    price: Price,
    budget: Budget,
    condition: str,
    question: Question,
    turn: int,
    messages: list[Message],
) -> str | None:
    path = cache_path(provider.name, model, condition, question.question_id, turn, messages)
    if path.is_file():
        return str(json.loads(path.read_text())["response"])
    gate(budget, price, input_tokens(messages, price))
    started = time.monotonic()
    try:
        reply: Reply = complete(
            provider, model, messages, max_tokens=price.max_tokens, extra=price.extra
        )
    except ProviderError as exc:
        print(f"error on {question.question_id} {condition} turn {turn}: {exc}", flush=True)
        return None
    usage = reply.usage
    spend = cost(price, usage["prompt_tokens"], usage["output_tokens"])
    budget.spent += spend
    record = {
        "provider": provider.name,
        "model": model,
        "served_model": reply.model,
        "condition": condition,
        "question_id": question.question_id,
        "video": question.video,
        "turn": turn,
        "images": sum(isinstance(p, Path) for m in messages for p in m.parts),
        "response": reply.text,
        "usage": usage,
        "cost_usd": spend,
        "seconds": round(time.monotonic() - started, 2),
        "round": budget.round_tag,
        "messages": messages_key(messages),
    }
    ANSWERS.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(record, indent=1))
    ledger = {k: record[k] for k in ("provider", "model", "condition", "question_id", "turn")}
    append_ledger(
        {**ledger, "usage": usage, "cost_usd": spend, "cache": path.name}, budget.round_tag
    )
    print(
        f"{question.question_id} {condition} t{turn}: {usage['prompt_tokens']}+"
        f"{usage['output_tokens']} tokens ${spend:.5f}, {provider.name} total ${budget.spent:.4f}",
        flush=True,
    )
    return reply.text


# A group's conditions run question by question, so a budget stop leaves them paired.
def blocks(conditions: list[str]) -> list[list[str]]:
    grouped: dict[str, list[str]] = {}
    for condition in conditions:
        if condition in CONDITIONS:
            group = next((g for g, names in GROUPS.items() if condition in names), condition)
            grouped.setdefault(group, []).append(condition)
    return list(grouped.values())


def run_chain(
    provider: Provider,
    model: str,
    price: Price,
    budget: Budget,
    conditions: list[str],
    materials: dict[str, Material],
) -> None:
    grouped = questions_by_video()
    for block in blocks(conditions):
        for video, material in materials.items():
            for question in grouped[video]:
                for condition in block:
                    messages = single_messages(condition, question, material)
                    ask(provider, model, price, budget, condition, question, 0, messages)
    variants = [c for c in conditions if c in PINNING]
    for video, material in materials.items():
        questions = grouped[video]
        for variant in variants:
            replies: list[str] = []
            for turn, question in enumerate(questions):
                messages = pinning_messages(variant, questions, replies, material)
                condition = pinning_condition(variant, turn)
                text = ask(provider, model, price, budget, condition, question, turn, messages)
                if text is None:
                    break
                replies.append(text)


def estimate_rows(
    provider: str, model: str, price: Price, conditions: list[str], materials: dict[str, Material]
) -> list[tuple[str, int, int, int]]:
    grouped = questions_by_video()
    rows = []
    for condition in conditions:
        requests = cached = tokens = 0
        for video, material in materials.items():
            questions = grouped[video]
            if condition in CONDITIONS:
                plans = [
                    (condition, q, 0, single_messages(condition, q, material)) for q in questions
                ]
            else:
                plans = []
                for turn, q in enumerate(questions):
                    replies = [PLACEHOLDER_REPLY] * turn
                    messages = pinning_messages(condition, questions, replies, material)
                    plans.append((pinning_condition(condition, turn), q, turn, messages))
                # Turn one is shared by both variants, so it is counted under pinned only.
                if condition == "stubbed":
                    plans = plans[1:]
            for name, question, turn, messages in plans:
                requests += 1
                path = cache_path(provider, model, name, question.question_id, turn, messages)
                if path.is_file():
                    cached += 1
                else:
                    tokens += input_tokens(messages, price)
        rows.append((condition, requests, cached, tokens))
    return rows


def dry_run(
    targets: list[tuple[Provider, str]],
    pricing: dict[str, dict[str, Any]],
    conditions: list[str],
    materials: dict[str, Material],
    round_tag: str,
    requested: float | None,
) -> None:
    for provider, model in targets:
        price = price_for(pricing, provider.name, model)
        if price is None:
            print(f"{provider.name}/{model}: no price in pricing.json")
            continue
        spent = ledger_total(provider.name, round_tag)
        limit = budget_for(provider.name, round_tag, requested)
        print(f"\n{provider.name}/{model}: round {round_tag} spent ${spent:.4f} of ${limit:.2f}")
        total = worst_total = 0.0
        for condition, requests, cached, tokens in estimate_rows(
            provider.name, model, price, conditions, materials
        ):
            fresh = requests - cached
            expected = cost(price, tokens, price.expected_output * fresh)
            worst = cost(price, round(tokens * INPUT_SAFETY), price.max_tokens * fresh)
            total += expected
            worst_total += worst
            print(
                f"  {condition:<11} {requests:>4} requests ({cached} cached), "
                f"~{tokens:>10,} input tokens, expected ${expected:.3f}, worst ${worst:.3f}"
            )
        print(f"  total expected ${total:.3f}, worst ${worst_total:.3f}, left ${limit - spent:.3f}")


def expand(spec: str) -> list[str]:
    names: list[str] = []
    for token in spec.split(","):
        names += GROUPS.get(token, (token,))
    unknown = [n for n in names if n not in CONDITIONS and n not in PINNING]
    if unknown:
        sys.exit(f"unknown condition: {', '.join(unknown)}")
    return list(dict.fromkeys(names))


def select_videos(spec: str) -> list[str]:
    videos = list(questions_by_video())
    if spec == "all":
        return videos
    if spec.isdigit():
        return videos[: int(spec)]
    return spec.split(",")


def main() -> None:
    parser = argparse.ArgumentParser(description="Phase 0 long-video model runs.")
    parser.add_argument("--provider", default="all", help="venice, gemini or all")
    parser.add_argument("--model", help="defaults to the provider's model in MODELS")
    parser.add_argument(
        "--conditions",
        default="core,s8x9,scene,pinning",
        help="comma-separated names or groups (core, s8x9, scene, pinning)",
    )
    parser.add_argument("--videos", default="all", help="all, a count, or comma-separated ids")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--prepare", action="store_true", help="render and demux only")
    parser.add_argument("--budget-usd", type=float, help="defaults to the round's cap")
    parser.add_argument(
        "--round", default=ROUND, help=f"ledger tag and budget scope, default {ROUND}"
    )
    args = parser.parse_args()

    names = list(PROVIDERS) if args.provider == "all" else args.provider.split(",")
    unknown = [n for n in names if n not in PROVIDERS]
    if unknown:
        sys.exit(f"unknown provider: {', '.join(unknown)}")
    conditions = expand(args.conditions)
    layouts = layouts_for(conditions)
    materials = {}
    for video in select_videos(args.videos):
        materials[video] = prepare(video, layouts)
        print(f"prepared {video}", flush=True)
    if args.prepare:
        return
    pricing = load_pricing()
    targets = [(PROVIDERS[n], args.model or MODELS[n]) for n in names]
    if args.dry_run:
        dry_run(targets, pricing, conditions, materials, args.round, args.budget_usd)
        return
    if len(targets) != 1:
        sys.exit("a real run takes one --provider")
    provider, model = targets[0]
    price = price_for(pricing, provider.name, model)
    if price is None:
        sys.exit(f"no price for {provider.name}/{model} in pricing.json; add one first")
    if api_key(provider) is None:
        sys.exit(f"{provider.name}: {provider.key_env} is not set")
    limit = budget_for(provider.name, args.round, args.budget_usd)
    budget = Budget(args.round, ledger_total(provider.name, args.round), limit)
    print(f"{provider.name} round {args.round} ledger so far: ${budget.spent:.4f} of ${limit:.2f}")
    with run_lock():
        try:
            run_chain(provider, model, price, budget, conditions, materials)
        except BudgetReached as exc:
            print(exc)
    print(f"done: {provider.name} round {args.round} total ${budget.spent:.4f}")


if __name__ == "__main__":
    main()
