"""One unit of work per process, so measure.py sees a fresh interpreter's memory."""

import argparse
import itertools
import json
import os
import shutil
import sys
import time
from collections import defaultdict
from pathlib import Path

import av

from config import PLANS


def plan(video: str, plan_name: str) -> dict[str, object]:
    from vid2grid import plan_from_options

    started = time.perf_counter()
    planned = plan_from_options(video, PLANS[plan_name])
    return {
        "plan_s": time.perf_counter() - started,
        "frames": len(planned.plan.frames),
        "sheets": len(planned.plan.sheets),
        "warnings": list(planned.warnings),
    }


def render(video: str, plan_name: str, out_dir: str) -> dict[str, object]:
    from vid2grid import render_from_options

    result = render_from_options(video, out_dir, PLANS[plan_name])
    shutil.rmtree(out_dir, ignore_errors=True)
    return {
        "frames": result.frame_count,
        "sheets": len(result.sheets),
        "timings_ms": result.timings_ms,
        "warnings": list(result.warnings),
    }


def demux(video: str) -> dict[str, object]:
    """Packets only: keyframe times and compressed bytes per second, nothing decoded."""
    keyframe_times: list[float] = []
    bytes_per_second: dict[int, int] = defaultdict(int)
    packets = 0
    with av.open(video) as container:
        stream = container.streams.video[0]
        time_base = stream.time_base
        for packet in container.demux(stream):
            if packet.pts is None or time_base is None:
                continue
            seconds = float(packet.pts * time_base)
            packets += 1
            bytes_per_second[int(seconds)] += packet.size
            if packet.is_keyframe:
                keyframe_times.append(seconds)
    keyframe_times.sort()
    gaps = [b - a for a, b in itertools.pairwise(keyframe_times)]
    return {
        "packets": packets,
        "keyframes": len(keyframe_times),
        "mean_keyframe_gap_s": sum(gaps) / len(gaps) if gaps else None,
        "max_keyframe_gap_s": max(gaps, default=None),
        "seconds_with_bytes": len(bytes_per_second),
    }


def add_cuda_libraries() -> None:
    import nvidia.cublas
    import nvidia.cudnn

    for package in (nvidia.cublas, nvidia.cudnn):
        for folder in package.__path__:
            os.add_dll_directory(str(Path(folder) / "bin"))
            os.environ["PATH"] = str(Path(folder) / "bin") + os.pathsep + os.environ["PATH"]


def whisper(video: str, model_name: str, device: str) -> dict[str, object]:
    if device == "cuda":
        add_cuda_libraries()
    from faster_whisper import WhisperModel
    from vid2grid.transcribe import SAMPLE_RATE, decode_audio

    started = time.perf_counter()
    samples = decode_audio(video, 0.0, 1e9)
    decoded = time.perf_counter()
    compute_type = "int8" if device == "cpu" else "float16"
    model = WhisperModel(model_name, device=device, compute_type=compute_type)
    loaded = time.perf_counter()
    segments = list(model.transcribe(samples)[0])
    finished = time.perf_counter()
    audio_s = samples.size / SAMPLE_RATE
    return {
        "audio_s": audio_s,
        "segments": len(segments),
        "decode_s": decoded - started,
        "load_s": loaded - decoded,
        "transcribe_s": finished - loaded,
        "real_time_factor": (finished - loaded) / audio_s,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("task", choices=["plan", "render", "demux", "whisper"])
    parser.add_argument("video")
    parser.add_argument("--plan", default="default")
    parser.add_argument("--out-dir", default="")
    parser.add_argument("--model", default="tiny")
    parser.add_argument("--device", default="cpu")
    args = parser.parse_args()
    if args.task == "plan":
        result = plan(args.video, args.plan)
    elif args.task == "render":
        result = render(args.video, args.plan, args.out_dir)
    elif args.task == "demux":
        result = demux(args.video)
    else:
        result = whisper(args.video, args.model, args.device)
    json.dump(result, sys.stdout)


if __name__ == "__main__":
    main()
