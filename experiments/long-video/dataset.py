import json
import math
import os
import re
import zipfile
from dataclasses import dataclass
from functools import cache
from pathlib import Path

DATA = Path(os.environ.get("VIDEO_MME_DIR", r"D:\vid2grid-data\video-mme"))
CACHE_ROOT = DATA / "cache" / "p0"
VIDEOS = DATA / "videos"
TASK_GROUPS = {
    "Object Reasoning": "reasoning",
    "Action Reasoning": "reasoning",
    "Temporal Reasoning": "reasoning",
    "Information Synopsis": "synopsis",
    "Object Recognition": "perception",
    "Attribute Perception": "perception",
    "Action Recognition": "perception",
    "Temporal Perception": "perception",
    "Counting Problem": "counting",
}
TIME_LINE = re.compile(r"(\d+):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d+):(\d{2}):(\d{2})[,.](\d{3})")
TAG = re.compile(r"<[^>]*>")


@dataclass(frozen=True)
class Question:
    question_id: str
    video: str
    task_type: str
    domain: str
    question: str
    options: tuple[str, ...]
    answer: str

    @property
    def task_group(self) -> str:
        return TASK_GROUPS.get(self.task_type, "other")


@dataclass(frozen=True)
class Cue:
    start: float
    end: float
    text: str


def video_path(video: str) -> Path:
    return VIDEOS / f"{video}.mp4"


@cache
def picked_videos() -> tuple[str, ...]:
    return tuple(json.loads((DATA / "phase0_pick.json").read_text()))


@cache
def load_questions() -> tuple[Question, ...]:
    import pyarrow.parquet as pq

    picked = set(picked_videos())
    rows = pq.read_table(DATA / "test.parquet").to_pylist()
    questions = [
        Question(
            str(row["question_id"]),
            str(row["videoID"]),
            str(row["task_type"]),
            str(row["domain"]),
            str(row["question"]),
            tuple(str(option) for option in row["options"]),
            str(row["answer"]).strip().upper(),
        )
        for row in rows
        if row["videoID"] in picked and row["duration"] == "long"
    ]
    return tuple(sorted(questions, key=lambda q: (q.video, q.question_id)))


def questions_by_video() -> dict[str, list[Question]]:
    grouped: dict[str, list[Question]] = {}
    for question in load_questions():
        grouped.setdefault(question.video, []).append(question)
    return grouped


def parse_srt(text: str) -> list[Cue]:
    cues = []
    for block in re.split(r"\r?\n\s*\r?\n", text.strip()):
        lines = block.splitlines()
        for index, line in enumerate(lines):
            match = TIME_LINE.search(line)
            if not match:
                continue
            parts = [int(g) for g in match.groups()]
            start = parts[0] * 3600 + parts[1] * 60 + parts[2] + parts[3] / 1000
            end = parts[4] * 3600 + parts[5] * 60 + parts[6] + parts[7] / 1000
            body = " ".join(TAG.sub("", rest).strip() for rest in lines[index + 1 :])
            body = re.sub(r"\s+", " ", body).strip()
            if body:
                cues.append(Cue(start, end, body))
            break
    return cues


def load_cues(video: str) -> list[Cue]:
    with zipfile.ZipFile(DATA / "subtitle.zip") as archive:
        name = f"subtitle/{video}.srt"
        if name not in archive.namelist():
            return []
        return parse_srt(archive.read(name).decode("utf-8", "replace"))


# Matches formatTimestamp in apps/chat/src/time.ts, so labels read as the chat app writes them.
def format_timestamp(seconds: float, tenths: bool = False) -> str:
    tenths_total = math.floor(max(0.0, seconds) * 10 + 1e-6)
    whole = tenths_total // 10
    hours, minutes = whole // 3600, (whole % 3600) // 60
    fraction = f".{tenths_total % 10}" if tenths else ""
    secs = f"{whole % 60:02d}{fraction}"
    return f"{hours}:{minutes:02d}:{secs}" if hours > 0 else f"{minutes}:{secs}"


def format_span(start: float, end: float) -> str:
    if end <= start:
        return format_timestamp(start, start % 1 != 0)
    tenths = end - start < 10
    return f"{format_timestamp(start, tenths)} to {format_timestamp(end, tenths)}"


# Auto subtitles repeat each line as it scrolls, so a cue equal to the one before is dropped.
def transcript_text(cues: list[Cue]) -> str:
    lines = []
    previous = ""
    for cue in cues:
        if cue.text == previous:
            continue
        previous = cue.text
        lines.append(f"[{format_timestamp(cue.start)}] {cue.text}")
    return "\n".join(lines)
