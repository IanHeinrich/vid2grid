"""Runs the baselines and writes results.json. `uv run python run.py --help` for the choices."""

import argparse
import json
import shutil
import sys
from collections.abc import Callable

from config import CACHE, NODE_CLI, NODE_FLAGS, PLANS, RESULTS, VIDEOS
from measure import Measurement, run

Row = dict[str, object]


def task_argv(*args: str) -> list[str]:
    return [sys.executable, "tasks.py", *args]


def task_row(measurement: Measurement) -> Row:
    if measurement.returncode != 0:
        return {"error": measurement.stderr.strip().splitlines()[-1:]}
    return json.loads(measurement.stdout)


def timed(measurement: Measurement) -> Row:
    return {"wall_s": measurement.wall_s, "peak_rss_mb": measurement.peak_rss_mb}


def python_render(video: str, plan: str) -> Row:
    out_dir = str(CACHE / "sheets" / f"python_{plan}")
    measurement = run(task_argv("render", video, "--plan", plan, "--out-dir", out_dir))
    return timed(measurement) | task_row(measurement)


def node_render(video: str, plan: str) -> Row:
    out_dir = CACHE / "sheets" / f"node_{plan}"
    measurement = run(["node", str(NODE_CLI), video, "-o", str(out_dir), *NODE_FLAGS[plan]])
    sheets = len(list(out_dir.glob("grid_*.jpg")))
    shutil.rmtree(out_dir, ignore_errors=True)
    summary = measurement.stderr.strip().splitlines()[-1:]
    return timed(measurement) | {
        "sheets": sheets,
        "returncode": measurement.returncode,
        "stderr": summary,
    }


def python_plan(video: str, plan: str) -> Row:
    measurement = run(task_argv("plan", video, "--plan", plan))
    return timed(measurement) | task_row(measurement)


def demux(video: str, _: str) -> Row:
    measurement = run(task_argv("demux", video))
    return timed(measurement) | task_row(measurement)


def ffprobe_packets(video: str, _: str) -> Row:
    argv = ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_packets"]
    argv += ["-show_entries", "packet=pts_time,size,flags", "-of", "csv=p=0", video]
    measurement = run(argv)
    lines = measurement.stdout.splitlines()
    return timed(measurement) | {"packets": len(lines), "keyframes": sum("K" in x for x in lines)}


def whisper(video: str, variant: str) -> Row:
    model, device = variant.split(":")
    measurement = run(task_argv("whisper", video, "--model", model, "--device", device))
    return timed(measurement) | task_row(measurement)


def measurements(
    whisper_devices: list[str],
) -> dict[str, tuple[list[str], Callable[[str, str], Row]]]:
    return {
        "python_render": (list(PLANS), python_render),
        "node_render": (list(PLANS), node_render),
        "demux_pyav": (["packets"], demux),
        "demux_ffprobe": (["packets"], ffprobe_packets),
        "plan": (["default"], python_plan),
        "whisper": ([f"{m}:{d}" for m in ("tiny", "base") for d in whisper_devices], whisper),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", nargs="*", help="measurement names, default all")
    parser.add_argument("--videos", nargs="*", default=list(VIDEOS))
    parser.add_argument("--whisper-devices", nargs="*", default=["cpu", "cuda"])
    args = parser.parse_args()

    results: dict[str, Row] = json.loads(RESULTS.read_text()) if RESULTS.exists() else {}
    for name, (variants, function) in measurements(args.whisper_devices).items():
        if args.only and name not in args.only:
            continue
        for label in args.videos:
            if name == "whisper" and label != "median":
                continue
            for variant in variants:
                key = f"{name}|{label}|{variant}"
                video = str(VIDEOS[label])
                row = function(video, variant)
                results[key] = row
                print(key, json.dumps(row), flush=True)
                RESULTS.write_text(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
