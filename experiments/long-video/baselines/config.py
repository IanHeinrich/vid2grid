from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
DATA = Path("D:/vid2grid-data/video-mme")
CACHE = DATA / "cache" / "baselines"
NODE_CLI = REPO / "apps" / "node-cli" / "dist" / "cli.js"
RESULTS = Path(__file__).parent / "results.json"

# Median (about 38 minutes) and longest of the 30 Video-MME videos, then the 2 hour join of three.
VIDEOS = {
    "median": DATA / "videos" / "aqFfjJrLkBA.mp4",
    "longest": DATA / "videos" / "Sm0lziolZyM.mp4",
    "long_2h": CACHE / "long_2h.mp4",
}

# Python option names; the Node CLI takes the same plans as flags.
PLANS = {
    "default": {},
    "sparse16": {"frameCount": 16},
}
NODE_FLAGS = {
    "default": [],
    "sparse16": ["--frame-count", "16"],
}
