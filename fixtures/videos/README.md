# Shared test videos

Real files every host can decode in its own tests, so they agree on more than
synthetic clips each host makes for itself.

`tiny.mp4` is a test asset borrowed from Curator, the first consumer of the
Python package. How it was made is not recorded beyond its muxer tag
(`Lavf62.12.102`, so an FFmpeg 8 build). Its properties:

- H.264 High profile, yuv420p, 160x120, no sample aspect ratio written
- 30 frames at 10 fps, one every 0.1 s from 0 to 2.9 s, so 3.0 s long
- time base 1/10240, a single keyframe at 0
- no audio track

`keyframes-20s.mp4` has a keyframe every second, so a sparse plan makes a host
seek more than once and keyframe sampling has many keyframes to pick from. It is
written with the libx264 encoder bundled in PyAV, so no system FFmpeg is needed.
From `python/`:

```sh
uv run python ../scripts/makeKeyframeVideo.py
```

The same PyAV build writes the same bytes. Its properties:

- H.264 High profile with B-frames, yuv420p, 160x120
- 200 frames at 10 fps, one every 0.1 s from 0 to 19.9 s, so 20.0 s long
- time base 1/10240, keyframes at every whole second from 0 to 19
- no audio track, about 11 KB

`fixtures/frames/` records which of their frames a host must pick for a few
plans. From `python/`, `uv run python ../scripts/recordFrameFixtures.py`
rewrites it: the picks come from a plain decode of every frame, and the script
stops if the Python package's capture picks differently.
