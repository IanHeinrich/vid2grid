"""Prints results.json as the markdown tables in RESULTS.md."""

import json

from config import RESULTS, VIDEOS


def cell(value: object, digits: int = 1) -> str:
    return f"{value:.{digits}f}" if isinstance(value, float) else str(value)


def table(title: str, columns: list[str], rows: list[list[object]]) -> None:
    print(f"### {title}\n")
    print("| " + " | ".join(columns) + " |")
    print("|" + "|".join(" --- " for _ in columns) + "|")
    for row in rows:
        print("| " + " | ".join(cell(value) for value in row) + " |")
    print()


def pick(results: dict[str, dict[str, object]], prefix: str) -> list[tuple[list[str], dict]]:
    return [(key.split("|"), row) for key, row in results.items() if key.startswith(prefix + "|")]


def main() -> None:
    results = json.loads(RESULTS.read_text())
    order = {label: index for index, label in enumerate(VIDEOS)}
    for name in ("python_render", "node_render"):
        rows = []
        for (_, label, plan), row in sorted(pick(results, name), key=lambda x: order[x[0][1]]):
            rows.append(
                [
                    label,
                    plan,
                    row.get("frames", ""),
                    row["sheets"],
                    row["wall_s"],
                    row["peak_rss_mb"],
                ]
            )
        table(name, ["video", "plan", "frames", "sheets", "wall s", "peak RSS MB"], rows)
    rows = []
    for name in ("demux_pyav", "demux_ffprobe"):
        for (_, label, _), row in sorted(pick(results, name), key=lambda x: order[x[0][1]]):
            rows.append(
                [name, label, row["packets"], row["keyframes"], row["wall_s"], row["peak_rss_mb"]]
            )
    table("demux", ["tool", "video", "packets", "keyframes", "wall s", "peak RSS MB"], rows)
    rows = []
    for (_, label, _), row in sorted(pick(results, "plan"), key=lambda x: order[x[0][1]]):
        rows.append(
            [label, row["frames"], row["sheets"], row["plan_s"], row["wall_s"], row["peak_rss_mb"]]
        )
    table("plan", ["video", "frames", "sheets", "plan s", "process wall s", "peak RSS MB"], rows)
    rows = []
    for (_, label, variant), row in pick(results, "whisper"):
        model, device = variant.split(":")
        if "error" in row:
            rows.append([model, device, "failed", " ".join(row["error"]), "", "", "", ""])
        else:
            rows.append(
                [
                    model,
                    device,
                    row["audio_s"],
                    row["decode_s"],
                    row["load_s"],
                    row["transcribe_s"],
                    cell(row["real_time_factor"], 4),
                    row["peak_rss_mb"],
                ]
            )
    table(
        "whisper",
        ["model", "device", "audio s", "decode s", "load s", "transcribe s", "RTF", "peak RSS MB"],
        rows,
    )


if __name__ == "__main__":
    main()
