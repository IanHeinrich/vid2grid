import json
from pathlib import Path
from typing import Any

from vid2grid.contract import CollagePlanRequest

CURATOR_FRAMES = 16
CURATOR_OUTPUT_RESOLUTION = 1024


def collage_request(**overrides: object) -> CollagePlanRequest:
    """A request over the whole `tiny_video` range; pass overrides for anything else."""
    fields: dict[str, object] = {
        "start_seconds": 0.0,
        "end_seconds": 3.0,
        "target_fps": 4.0,
        "frames_per_grid": 4,
        "output_resolution": 512,
        "jpeg_quality": 85,
    }
    fields.update(overrides)
    return CollagePlanRequest(**fields)  # type: ignore[arg-type]


def repo_root() -> Path:
    for parent in Path(__file__).resolve().parents:
        if (parent / "fixtures" / "render-plans").is_dir():
            return parent
    raise FileNotFoundError("fixtures/ is not reachable from this checkout")


# Raises rather than returning nothing, so a missing golden set fails instead of skipping.
def fixture_paths(kind: str) -> list[Path]:
    paths = sorted((repo_root() / "fixtures" / kind).glob("*.json"))
    if not paths:
        raise FileNotFoundError(f"fixtures/{kind}/ has no goldens")
    return paths


def read_fixture(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))
