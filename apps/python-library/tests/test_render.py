from dataclasses import replace

from helpers import collage_request
from PIL import Image

from vid2grid import build_render_plan
from vid2grid._core import sheet_draw_ops
from vid2grid.contract import RenderPlan, VideoInfo
from vid2grid.render import paint_sheet

FLAT_FILL = (128, 128, 128)


def _plan() -> RenderPlan:
    request = collage_request(end_seconds=2.0, target_fps=2.0)
    return build_render_plan(request, VideoInfo(duration_seconds=2.0, width=320, height=240))


def test_a_missing_image_leaves_the_cell_as_background() -> None:
    plan = _plan()
    sheet = plan.sheets[0]
    filled = Image.new("RGB", (plan.cell.width, plan.cell.height), FLAT_FILL)

    canvas = paint_sheet(plan, sheet, [None, filled, None, None])

    empty, painted = sheet.cells[0], sheet.cells[1]
    assert canvas.getpixel((empty.x + empty.width // 2, empty.y + empty.height // 2)) == (0, 0, 0)
    assert (
        canvas.getpixel((painted.x + painted.width // 2, painted.y + painted.height // 2))
        == FLAT_FILL
    )


def test_a_right_anchored_watermark_stays_inside_its_cell() -> None:
    plan = _plan()
    sheet = plan.sheets[0]
    cell = sheet.cells[0]
    watermark = cell.watermarks[1]
    assert watermark.anchor == "top-right"

    images = [Image.new("RGB", (plan.cell.width, plan.cell.height), FLAT_FILL)]
    unmarked = replace(sheet, cells=tuple(replace(c, watermarks=()) for c in sheet.cells))
    painted = paint_sheet(plan, sheet, images)
    reference = paint_sheet(plan, unmarked, images)

    ink_columns = [
        x
        for x in range(plan.canvas.width)
        for y in range(cell.y, cell.y + watermark.font_size_px + 8)
        if painted.getpixel((x, y)) != reference.getpixel((x, y))
    ]
    assert ink_columns
    assert max(ink_columns) < cell.x + cell.width


def test_a_missing_image_also_skips_its_cells_text() -> None:
    plan = _plan()
    sheet = plan.sheets[0]
    filled = Image.new("RGB", (plan.cell.width, plan.cell.height), FLAT_FILL)

    canvas = paint_sheet(plan, sheet, [None, filled])

    for empty in sheet.cells[:1] + sheet.cells[2:]:
        region = canvas.crop((empty.x, empty.y, empty.x + empty.width, empty.y + empty.height))
        assert region.getbbox() is None


def test_draw_ops_paint_the_background_then_each_cells_image_and_text() -> None:
    plan = _plan()
    ops = sheet_draw_ops(plan, 0)

    assert ops[0] == {
        "kind": "fillRect",
        "x": 0,
        "y": 0,
        "width": plan.canvas.width,
        "height": plan.canvas.height,
        "color": plan.style.background,
    }
    expected = [
        (kind, index)
        for index, cell in enumerate(plan.sheets[0].cells)
        for kind in ["image"] + ["text"] * len(cell.watermarks)
    ]
    assert [(op["kind"], op["cellIndex"]) for op in ops[1:] if op["kind"] != "fillRect"] == expected
