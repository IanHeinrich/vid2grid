import subprocess
import threading
import time
from dataclasses import dataclass

import psutil

SAMPLE_SECONDS = 0.1


@dataclass(frozen=True)
class Measurement:
    wall_s: float
    peak_rss_mb: float
    returncode: int
    stdout: str
    stderr: str


def tree_rss(process: psutil.Process) -> int:
    try:
        members = [process, *process.children(recursive=True)]
    except psutil.Error:
        return 0
    total = 0
    for member in members:
        try:
            total += member.memory_info().rss
        except psutil.Error:
            continue
    return total


def run(argv: list[str]) -> Measurement:
    """Wall time and peak RSS of the process and everything it spawns, sampled every 100 ms."""
    started = time.perf_counter()
    child = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    watched = psutil.Process(child.pid)
    peak = 0
    done = threading.Event()

    def sample() -> None:
        nonlocal peak
        while not done.is_set():
            peak = max(peak, tree_rss(watched))
            done.wait(SAMPLE_SECONDS)

    sampler = threading.Thread(target=sample)
    sampler.start()
    stdout, stderr = child.communicate()
    wall = time.perf_counter() - started
    done.set()
    sampler.join()
    return Measurement(wall, peak / 2**20, child.returncode, stdout, stderr)
