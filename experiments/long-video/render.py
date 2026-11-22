import json
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

import av
from PIL import Image, ImageDraw, ImageFont
from vid2grid import plan_from_options, render_from_options

from dataset import format_timestamp

if TYPE_CHECKING:
    from vid2grid.contract import PlannedCell

EDGE = 2048
# The library's sheets come out at quality 80; the own grids match, and crops lose little more.
QUALITY = 80
CROP_QUALITY = 92
# Frames in all, frames per sheet; the vid2grid library renders these.
LAYOUTS = {"s4x20": (80, 20), "s4x9": (36, 9), "s8x9": (72, 9), "f10": (10, 1)}
GRID_COLS, GRID_ROWS = 4, 5
CELL_W, CELL_H = EDGE // GRID_COLS, EDGE // GRID_COLS * 9 // 16


@dataclass(frozen=True)
class Sheet:
    name: str
    path: Path
    times: tuple[float, ...]

    @property
    def start(self) -> float:
        return self.times[0]

    @property
    def end(self) -> float:
        return self.times[-1]

    def to_dict(self) -> dict[str, object]:
        return {"name": self.name, "path": str(self.path), "times": list(self.times)}

    @classmethod
    def from_dict(cls, data: dict[str, object]) -> "Sheet":
        times = data["times"]
        assert isinstance(times, list)
        return cls(str(data["name"]), Path(str(data["path"])), tuple(float(t) for t in times))


def load_manifest(out_dir: Path) -> list[Sheet] | None:
    manifest = out_dir / "manifest.json"
    if not manifest.is_file():
        return None
    sheets = [Sheet.from_dict(entry) for entry in json.loads(manifest.read_text())]
    return sheets if all(sheet.path.is_file() for sheet in sheets) else None


def save_manifest(out_dir: Path, sheets: list[Sheet]) -> list[Sheet]:
    (out_dir / "manifest.json").write_text(json.dumps([s.to_dict() for s in sheets], indent=1))
    return sheets


def render_layout(video: Path, layout: str, out_dir: Path) -> list[Sheet]:
    existing = load_manifest(out_dir)
    if existing is not None:
        return existing
    frames, per_sheet = LAYOUTS[layout]
    options = {"frameCount": frames, "framesPerGrid": per_sheet, "outputResolution": EDGE}
    plan = plan_from_options(video, options).plan
    out_dir.mkdir(parents=True, exist_ok=True)
    result = render_from_options(video, out_dir, options)
    written = {sheet.path.name: sheet.path for sheet in result.sheets}
    sheets = []
    for planned in plan.sheets:
        path = written[planned.file_name]
        if per_sheet == 1:
            crop_to_cell(path, planned.cells[0])
        times = tuple(cell.timestamp_seconds for cell in planned.cells)
        sheets.append(Sheet(Path(planned.file_name).stem, path, times))
    return save_manifest(out_dir, sheets)


# A one-frame sheet is letterboxed onto a square canvas; the bands carry nothing but tokens.
def crop_to_cell(path: Path, cell: "PlannedCell") -> None:
    with Image.open(path) as image:
        cropped = image.crop((cell.x, cell.y, cell.x + cell.width, cell.y + cell.height))
    cropped.save(path, quality=CROP_QUALITY)


def decode_at(video: Path, times: list[float]) -> list[Image.Image]:
    frames: list[Image.Image] = []
    with av.open(str(video)) as container:
        stream = container.streams.video[0]
        base = float(stream.time_base or 0)
        for target in times:
            container.seek(int(target / base), stream=stream, backward=True)
            chosen = None
            for frame in container.decode(stream):
                if frame.pts is None:
                    continue
                chosen = frame
                if float(frame.pts) * base >= target - 1e-3:
                    break
            if chosen is None:
                raise RuntimeError(f"no frame near {target:.2f}s in {video.name}")
            frames.append(chosen.to_image())
    return frames


def font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    try:
        return ImageFont.truetype("arial.ttf", size)
    except OSError:
        return ImageFont.load_default(size)


def compose_sheet(frames: list[Image.Image], times: list[float], first_index: int) -> Image.Image:
    rows = -(-len(frames) // GRID_COLS)
    canvas = Image.new("RGB", (GRID_COLS * CELL_W, max(rows, GRID_ROWS) * CELL_H), "black")
    draw = ImageDraw.Draw(canvas)
    label_font = font(22)
    for index, (frame, t) in enumerate(zip(frames, times, strict=True)):
        x, y = (index % GRID_COLS) * CELL_W, (index // GRID_COLS) * CELL_H
        cell = frame.copy()
        cell.thumbnail((CELL_W - 4, CELL_H - 4))
        cx, cy = x + (CELL_W - cell.width) // 2, y + (CELL_H - cell.height) // 2
        canvas.paste(cell, (cx, cy))
        style = {"font": label_font, "fill": "black", "stroke_width": 3, "stroke_fill": "white"}
        draw.text((cx + 4, cy + 4), format_timestamp(t), **style)
        draw.text((cx + cell.width - 4, cy + 4), str(first_index + index), anchor="ra", **style)
    return canvas


def render_grid_set(video: Path, times: list[float], out_dir: Path) -> list[Sheet]:
    existing = load_manifest(out_dir)
    if existing is not None:
        return existing
    out_dir.mkdir(parents=True, exist_ok=True)
    per_sheet = GRID_COLS * GRID_ROWS
    frames = decode_at(video, times)
    sheets = []
    for start in range(0, len(times), per_sheet):
        chunk = times[start : start + per_sheet]
        name = f"grid_{start // per_sheet + 1:04d}"
        path = out_dir / f"{name}.jpg"
        compose_sheet(frames[start : start + per_sheet], chunk, start).save(path, quality=QUALITY)
        sheets.append(Sheet(name, path, tuple(chunk)))
    return save_manifest(out_dir, sheets)
