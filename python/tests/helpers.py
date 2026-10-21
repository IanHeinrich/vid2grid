from vid2grid.contract import CollageRequest

CURATOR_FRAMES = 16
CURATOR_OUTPUT_RESOLUTION = 1024


def collage_request(**overrides: object) -> CollageRequest:
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
    return CollageRequest(**fields)  # type: ignore[arg-type]
