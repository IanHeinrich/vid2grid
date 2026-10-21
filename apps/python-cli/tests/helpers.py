from pathlib import Path


def repo_root() -> Path:
    for parent in Path(__file__).resolve().parents:
        if (parent / "fixtures" / "render-plans").is_dir():
            return parent
    raise FileNotFoundError("fixtures/ is not reachable from this checkout")
