from collections.abc import Sequence
from dataclasses import replace
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from ._core import sheet_draw_ops
from .contract import PlannedSheet, RenderPlan

_ANCHORS = {"top-left": "la", "top-right": "ra"}


def paint_sheet(
    plan: RenderPlan, sheet: PlannedSheet, images: Sequence[Image.Image | None]
) -> Image.Image:
    canvas = Image.new("RGB", plan.canvas.as_tuple())
    draw = ImageDraw.Draw(canvas)
    # Only this sheet crosses into core, so painting a long video stays linear in its length.
    single_sheet_plan = replace(plan, frames=(), sheets=(sheet,))

    for op in sheet_draw_ops(single_sheet_plan, 0):
        if op["kind"] == "fillRect":
            if op["width"] > 0 and op["height"] > 0:
                right = op["x"] + op["width"] - 1
                bottom = op["y"] + op["height"] - 1
                draw.rectangle((op["x"], op["y"], right, bottom), fill=op["color"])
            continue
        image = _image_at(images, op["cellIndex"])
        if image is None:
            continue
        if op["kind"] == "image":
            canvas.paste(image, (op["x"], op["y"]))
        else:
            draw.text(
                (op["x"], op["y"]),
                op["text"],
                font=_font(op["fontSizePx"]),
                anchor=_ANCHORS[op["anchor"]],
                fill=op["fill"],
                stroke_width=op["strokeWidthPx"],
                stroke_fill=op["stroke"],
            )
    return canvas


def save_jpeg(image: Image.Image, path: str | Path, quality: int) -> None:
    image.save(path, format="JPEG", quality=quality)


def _image_at(images: Sequence[Image.Image | None], cell_index: int) -> Image.Image | None:
    return images[cell_index] if cell_index < len(images) else None


# fontFamily is a CSS generic family Pillow cannot resolve, so its bundled default font stands in.
@lru_cache
def _font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    return ImageFont.load_default(size=size)
