import argparse
import hashlib
import json
import math
import sys
import time
from collections import defaultdict
from dataclasses import dataclass
from functools import cache
from itertools import zip_longest
from pathlib import Path
from typing import Any

import av
from PIL import Image

from conditions import CONDITIONS, Rendered, render, supports
from providers import (
    PROVIDERS,
    Provider,
    ProviderError,
    Reply,
    api_key,
    complete,
    complete_native_video,
    list_models,
)
from questions import prompt as build_prompt

ROOT = Path(__file__).parent
CLIPS = ROOT / "clips"
OUT = ROOT / "out"
RENDERS = OUT / "renders"
CACHE = OUT / "cache"
LEDGER = OUT / "ledger.jsonl"
PRICING = ROOT / "pricing.json"
TEMPCOMPASS = CLIPS / "tempcompass_manifest.json"
SETS = ("synthetic", "hard", "tempcompass", "all")
EXPECTED_OUTPUT = {False: 150, True: 1500}
DEFAULT_MAX_TOKENS = {False: 600, True: 4000}
# The budget gate pads the input estimate, since providers count image tokens differently.
INPUT_SAFETY = 1.5
# Gemini 3 bills every image at its default media resolution, measured at about 1120 tokens.
GEMINI_IMAGE_TOKENS = 1120
VIDEO_FRAME_TOKENS = 280
AUDIO_TOKENS_PER_SECOND = 32


@dataclass(frozen=True)
class Item:
    clip: dict[str, Any]
    condition: str
    rendered: Rendered
    prompt: str


@dataclass(frozen=True)
class Price:
    input: float
    output: float
    reasoning: bool
    max_tokens: int
    extra: dict[str, Any]
    image_tokens_per_mpx: float | None
    video_frame_tokens: int


def clip_set(clip: dict[str, Any]) -> str:
    if clip["id"].startswith("tc_"):
        return "tempcompass"
    return "hard" if clip["id"].startswith("hard_") else "synthetic"


def load_manifest(name: str = "all") -> list[dict[str, Any]]:
    clips: list[dict[str, Any]] = []
    for path, maker in [(CLIPS / "manifest.json", "make_clips.py"), (TEMPCOMPASS, None)]:
        if path.is_file():
            clips += json.loads(path.read_text())
        elif maker:
            sys.exit(f"no clips: run `uv run python {maker}` first")
    chosen = [clip for clip in clips if name == "all" or clip_set(clip) == name]
    if not chosen:
        sys.exit(f"no clips in set {name}; see the README for how to make it")
    return chosen


def select_clips(manifest: list[dict[str, Any]], spec: str) -> list[dict[str, Any]]:
    if spec == "all":
        return manifest
    by_id = {clip["id"]: clip for clip in manifest}
    kinds: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for clip in manifest:
        if clip["reverse_of"] is None:
            kinds[clip["kind"]].append(clip)
    ordered = []
    for group in zip_longest(*kinds.values()):
        for clip in group:
            if clip is None:
                continue
            ordered.append(clip)
            if f"{clip['id']}_rev" in by_id:
                ordered.append(by_id[f"{clip['id']}_rev"])
    return ordered[: int(spec)]


def load_pricing() -> dict[str, dict[str, Any]]:
    pricing: dict[str, dict[str, Any]] = json.loads(PRICING.read_text())
    return pricing


def price_for(pricing: dict[str, dict[str, Any]], provider: str, model: str) -> Price | None:
    entry = pricing.get(provider, {}).get(model)
    if not isinstance(entry, dict):
        return None
    reasoning = bool(entry.get("reasoning", False))
    return Price(
        float(entry["input"]),
        float(entry["output"]),
        reasoning,
        int(entry.get("max_tokens", DEFAULT_MAX_TOKENS[reasoning])),
        dict(entry.get("extra", {})),
        entry.get("image_tokens_per_mpx"),
        int(entry.get("video_frame_tokens", VIDEO_FRAME_TOKENS)),
    )


def image_tokens(provider: str, width: int, height: int, per_mpx: float | None) -> int:
    if per_mpx is not None:
        return math.ceil(width * height / 1_000_000 * per_mpx)
    if provider == "gemini":
        return GEMINI_IMAGE_TOKENS
    scale = min(1.0, 2048 / max(width, height))
    w, h = width * scale, height * scale
    scale = min(1.0, 768 / min(w, h))
    tiles = math.ceil(w * scale / 512) * math.ceil(h * scale / 512)
    return 85 + 170 * tiles


@cache
def has_audio(clip_file: str) -> bool:
    with av.open(str(CLIPS / clip_file)) as container:
        return bool(container.streams.audio)


def input_tokens(item: Item, provider: str, price: Price | None) -> int:
    per_mpx = price.image_tokens_per_mpx if price else None
    total = math.ceil(len(item.prompt) / 3.5) + 10
    if item.rendered.video_fps:
        seconds = float(item.clip["seconds"])
        frame_tokens = price.video_frame_tokens if price else VIDEO_FRAME_TOKENS
        total += math.ceil(seconds * item.rendered.video_fps) * frame_tokens
        if item.clip.get("audio", has_audio(item.clip["file"])):
            total += math.ceil(seconds * AUDIO_TOKENS_PER_SECOND)
    for path in item.rendered.images:
        with Image.open(path) as image:
            total += image_tokens(provider, image.width, image.height, per_mpx)
    return total


def cost(price: Price, prompt_tokens: int, output_tokens: int) -> float:
    return (prompt_tokens * price.input + output_tokens * price.output) / 1_000_000


def cache_path(provider: str, model: str, condition: str, clip_id: str, prompt: str) -> Path:
    digest = hashlib.sha256(
        json.dumps([provider, model, condition, clip_id, prompt]).encode()
    ).hexdigest()[:24]
    return CACHE / f"{digest}.json"


def ledger_total(provider: str) -> float:
    if not LEDGER.is_file():
        return 0.0
    total = 0.0
    for line in LEDGER.read_text().splitlines():
        if line.strip():
            entry = json.loads(line)
            if entry["provider"] == provider:
                total += float(entry["cost_usd"])
    return total


def build_items(clips: list[dict[str, Any]], conditions: list[str]) -> list[Item]:
    items = []
    for clip in clips:
        for condition in conditions:
            out_dir = RENDERS / clip["id"] / condition
            rendered = render(condition, CLIPS / clip["file"], out_dir)
            text = build_prompt(condition, clip, rendered.track)
            (out_dir / "prompt.txt").write_text(text + "\n")
            items.append(Item(clip, condition, rendered, text))
        print(f"rendered {clip['id']}", flush=True)
    return items


def dry_run(all_items: list[Item], targets: list[tuple[str, str]], pricing: dict[str, Any]) -> None:
    images = sum(len(item.rendered.images) for item in all_items)
    videos = sum(item.rendered.video_fps is not None for item in all_items)
    print(f"\n{images} images and {videos} native video requests, renders in {RENDERS}")
    for provider, model in targets:
        items = [item for item in all_items if supports(item.condition, provider)]
        price = price_for(pricing, provider, model)
        tokens_in = sum(input_tokens(item, provider, price) for item in items)
        cached = sum(
            cache_path(provider, model, i.condition, i.clip["id"], i.prompt).is_file()
            for i in items
        )
        label = f"{provider}/{model}"
        if price is None:
            print(f"{label}: ~{tokens_in:,} input tokens; no price in pricing.json")
            continue
        expected_out = EXPECTED_OUTPUT[price.reasoning] * len(items)
        worst_out = price.max_tokens * len(items)
        expected = cost(price, tokens_in, expected_out)
        worst = cost(price, round(tokens_in * INPUT_SAFETY), worst_out)
        print(
            f"{label}: {len(items)} requests ({cached} cached), ~{tokens_in:,} input tokens, "
            f"~{expected_out:,} output tokens, expected ${expected:.2f}, worst case ${worst:.2f}"
        )


def real_run(
    items: list[Item], provider: Provider, model: str, price: Price, budget: float
) -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    skipped = [item for item in items if not supports(item.condition, provider.name)]
    if skipped:
        names = sorted({item.condition for item in skipped})
        print(f"skipping {len(skipped)} requests {provider.name} cannot take: {', '.join(names)}")
        items = [item for item in items if supports(item.condition, provider.name)]
    spent = ledger_total(provider.name)
    print(f"{provider.name} ledger so far: ${spent:.4f} of ${budget:.2f}")
    sent = cached = 0
    for item in items:
        path = cache_path(provider.name, model, item.condition, item.clip["id"], item.prompt)
        if path.is_file():
            cached += 1
            continue
        estimate_in = round(input_tokens(item, provider.name, price) * INPUT_SAFETY)
        worst = cost(price, estimate_in, price.max_tokens)
        if spent + worst > budget:
            print(
                f"stopping: ${spent:.4f} spent + ${worst:.4f} worst case would pass ${budget:.2f}"
            )
            break
        started = time.monotonic()
        try:
            reply = send(item, provider, model, price)
        except ProviderError as exc:
            print(f"error on {item.clip['id']} {item.condition}: {exc}")
            continue
        usage = reply.usage
        spend = cost(price, usage["prompt_tokens"], usage["output_tokens"])
        spent += spend
        sent += 1
        record = {
            "provider": provider.name,
            "model": model,
            "served_model": reply.model,
            "clip": item.clip["id"],
            "condition": item.condition,
            "prompt": item.prompt,
            "images": [p.relative_to(ROOT).as_posix() for p in item.rendered.images],
            **video_fields(item),
            "response": reply.text,
            "usage": usage,
            "cost_usd": spend,
            "seconds": round(time.monotonic() - started, 2),
        }
        path.write_text(json.dumps(record, indent=2))
        ledger_entry = {k: record[k] for k in ("provider", "model", "clip", "condition", "usage")}
        with LEDGER.open("a") as ledger:
            ledger.write(json.dumps({**ledger_entry, "cost_usd": spend, "cache": path.name}) + "\n")
        print(
            f"{item.clip['id']} {item.condition}: {usage['prompt_tokens']}+"
            f"{usage['output_tokens']} tokens ${spend:.5f}, {provider.name} total ${spent:.4f}",
            flush=True,
        )
    print(f"done: {sent} sent, {cached} cached, {provider.name} total ${spent:.4f}")


def send(item: Item, provider: Provider, model: str, price: Price) -> Reply:
    if item.rendered.video_fps is not None:
        return complete_native_video(
            model,
            item.prompt,
            (CLIPS / item.clip["file"]).read_bytes(),
            item.rendered.video_fps,
            max_tokens=price.max_tokens,
            extra=price.extra,
        )
    images = [p.read_bytes() for p in item.rendered.images]
    return complete(
        provider, model, item.prompt, images, max_tokens=price.max_tokens, extra=price.extra
    )


def video_fields(item: Item) -> dict[str, Any]:
    if item.rendered.video_fps is None:
        return {}
    video = (CLIPS / item.clip["file"]).relative_to(ROOT).as_posix()
    return {"video": video, "video_fps": item.rendered.video_fps}


def show_models(names: list[str]) -> None:
    for name in names:
        try:
            models = list_models(PROVIDERS[name])
        except ProviderError as exc:
            print(exc)
            continue
        vision = [m for m in models if m.vision is not False]
        print(
            f"\n{name}: {len(vision)} vision-capable models"
            + (
                ""
                if name == "venice"
                else " (ids only; vision not reported, non-vision names dropped)"
            )
        )
        for m in vision:
            if m.input_usd_per_m is not None:
                print(f"  {m.id}  in ${m.input_usd_per_m}/M  out ${m.output_usd_per_m}/M")
            else:
                print(f"  {m.id}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Ask vision models motion questions under each condition."
    )
    parser.add_argument("--provider", default="all", help="venice, gemini, openai or all")
    parser.add_argument(
        "--model", help="model id; a dry run without it estimates every priced model"
    )
    parser.add_argument("--conditions", default="all", help="comma-separated, default all")
    parser.add_argument("--clips", default="all", help="all, or a count for a balanced pilot")
    parser.add_argument("--set", default="synthetic", choices=SETS, help="default synthetic")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--budget-usd", type=float, default=4.0, help="per provider, default 4.0")
    parser.add_argument("--list-models", action="store_true")
    args = parser.parse_args()

    names = list(PROVIDERS) if args.provider == "all" else args.provider.split(",")
    unknown = [n for n in names if n not in PROVIDERS]
    if unknown:
        sys.exit(f"unknown provider: {', '.join(unknown)}")
    if args.list_models:
        show_models(names)
        return

    conditions = list(CONDITIONS) if args.conditions == "all" else args.conditions.split(",")
    unknown = [c for c in conditions if c not in CONDITIONS]
    if unknown:
        sys.exit(f"unknown condition: {', '.join(unknown)}")
    pricing = load_pricing()
    clips = select_clips(load_manifest(args.set), args.clips)
    if args.dry_run:
        targets = [
            (name, model)
            for name in names
            for model in ([args.model] if args.model else pricing.get(name, {}))
            if not model.startswith("_")
        ]
        dry_run(build_items(clips, conditions), targets, pricing)
        return

    if len(names) != 1 or not args.model:
        sys.exit("a real run needs one --provider and a --model")
    provider = PROVIDERS[names[0]]
    price = price_for(pricing, provider.name, args.model)
    if price is None:
        sys.exit(f"no price for {provider.name}/{args.model} in pricing.json; add one first")
    if api_key(provider) is None:
        sys.exit(f"{provider.name}: {provider.key_env} is not set, skipping")
    real_run(build_items(clips, conditions), provider, args.model, price, args.budget_usd)


if __name__ == "__main__":
    main()
