# Long-video baselines (phase 0)

Speed and peak memory of the Python library, the Node CLI, a no-decode demux
pass, faster-whisper and planning, on videos of 38 minutes to 2 hours. They are
numbers to compare later improvements against. No product code was changed. The
browser baselines (WebCodecs, the seek path, browser Whisper) are out of scope
for this run and not measured here.

Every number is a single run on a quiet machine, so treat differences of 10 to
15 percent as noise. The videos are Video-MME files kept on `D:` for internal
use and are not in the repo.

## Machine

| Part   | Value                                                                       |
| ------ | --------------------------------------------------------------------------- |
| CPU    | Intel Core i7-13700K, 24 threads                                            |
| GPU    | NVIDIA GeForce RTX 4080, 16 GB                                              |
| RAM    | 32 GB                                                                       |
| OS     | Windows 11 Pro                                                              |
| Python | 3.13.15 (uv), PyAV 19.0.2, Pillow 13.0.0, mini-racer 0.14.1                 |
| Whisper | faster-whisper 1.2.1, CTranslate2 4.9.0, cuBLAS 12.8.4.1, cuDNN 9.10.2.21 |
| Node   | 22.15.1, `@vid2grid/node` with its `ffmpeg-static` binary                   |
| ffmpeg | 8.1.2 (gyan.dev full build), used for ffprobe and the 2 hour join           |

## Files

Durations of the 30 Video-MME videos run from 1821 s to 3540 s, with a median
of 2241 s. The shortest was picked as the third file of the brief but, as asked,
only the median, longest and 2 hour files were measured.

| Label   | File                                | Duration       | Resolution | Codec / fps    | Size   |
| ------- | ----------------------------------- | -------------- | ---------- | -------------- | ------ |
| shortest (not measured) | `ZkhAbUGoD18.mp4`   | 1821 s (30.4 min) | 1280x720 | H.264, 30   | 131 MB |
| median  | `aqFfjJrLkBA.mp4`                   | 2308 s (38.5 min) | 1280x720 | H.264, 29.97 | 329 MB |
| longest | `Sm0lziolZyM.mp4`                   | 3540 s (59.0 min) | 640x360  | H.264, 30   | 141 MB |
| long_2h | `cache/baselines/long_2h.mp4`       | 7415 s (123.6 min) | 1280x720 | H.264, 29.97 | 802 MB |

`long_2h` joins `aqFfjJrLkBA`, `9bbWYVrQgZ8` and `eZ2Rt2DVGdU` (all 720p, Main
profile, 29.97 fps, same time base) with the concat demuxer and stream copy, so
it was not re-encoded. Decoding 40 s either side of both joins gave no errors.
All three have 44.1 kHz stereo AAC audio.

## Results

### Python library, rendered to sheets

`render_from_options` with the defaults (1 fps, 9 frames per sheet, 2048 px
sheets) and with `{"frameCount": 16}`. Each run is a fresh process; sheets are
written to `D:` and deleted afterwards. Time is split into frame extraction
(decode and scale) and rendering (painting and JPEG encoding), as the library
reports it.

| Video   | Plan     | Frames | Sheets | Wall s | Extract s | Render s | Peak RSS MB |
| ------- | -------- | ------ | ------ | ------ | --------- | -------- | ----------- |
| median  | default  | 2307   | 257    | 98.6   | 92.8      | 5.4      | 134         |
| median  | sparse16 | 16     | 2      | 2.4    | 1.8       | 0.1      | 124         |
| longest | default  | 3540   | 394    | 48.4   | 37.4      | 10.5     | 133         |
| longest | sparse16 | 16     | 2      | 1.0    | 0.4       | 0.1      | 115         |
| long_2h | default  | 7414   | 824    | 252.9  | 236.6     | 15.6     | 171         |
| long_2h | sparse16 | 16     | 2      | 1.4    | 0.9       | 0.1      | 127         |

### Node CLI

`node apps/node-cli/dist/cli.js VIDEO -o OUT` with no flags, and with
`--frame-count 16`. This runs the same entry point as the `vid2grid-node` bin.
Memory is the Node process plus its ffmpeg child. The extract and render times
are the ones the CLI prints.

| Video   | Plan     | Frames | Sheets | Wall s | Extract s | Render s | Peak RSS MB |
| ------- | -------- | ------ | ------ | ------ | --------- | -------- | ----------- |
| median  | default  | 2307   | 257    | 74.9   | 66.1      | 16.4     | 334         |
| median  | sparse16 | 16     | 2      | 66.1   | 65.8      | 0.1      | 267         |
| longest | default  | 3540   | 394    | 112.8  | 100.4     | 25.8     | 280         |
| longest | sparse16 | 16     | 2      | 94.5   | 94.3      | 0.1      | 223         |
| long_2h | default  | 7414   | 824    | 236.2  | 212.0     | 51.8     | 330         |
| long_2h | sparse16 | 16     | 2      | 195.3  | 195.0     | 0.1      | 274         |

Extract and render overlap in Node (ffmpeg decodes while sheets are painted),
so they add up to more than the wall time.

### No-decode demux pass

Packets of the video stream only. PyAV iterates `container.demux(stream)`,
recording keyframe times and compressed bytes per second. `ffprobe` runs
`-show_packets -show_entries packet=pts_time,size,flags` over the video stream
and its output is counted.

| Tool    | Video   | Packets | Keyframes | Wall s | Peak RSS MB |
| ------- | ------- | ------- | --------- | ------ | ----------- |
| PyAV    | median  | 69166   | 817       | 0.5    | 45          |
| PyAV    | longest | 106204  | 803       | 0.6    | 48          |
| PyAV    | long_2h | 222225  | 2289      | 1.3    | 62          |
| ffprobe | median  | 69166   | 817       | 0.4    | 27          |
| ffprobe | longest | 106204  | 803       | 0.5    | 30          |
| ffprobe | long_2h | 222225  | 2289      | 1.2    | 43          |

Keyframe spacing in the three files is irregular: mean gap 2.8 s (median video),
4.4 s (longest) and 3.2 s (2 hour file), with a maximum of 7.0 s in all three.
Both tools agree on every packet and keyframe count.

### Planning only

`plan_from_options` with the defaults: probes the file and runs core in
mini-racer, no frame decoded. "Plan s" is the call itself; "process wall s"
includes starting Python and loading the library.

| Video   | Frames | Sheets | Plan s | Process wall s | Peak RSS MB |
| ------- | ------ | ------ | ------ | -------------- | ----------- |
| median  | 2307   | 257    | 0.06   | 0.44           | 47          |
| longest | 3540   | 394    | 0.06   | 0.45           | 61          |
| long_2h | 7414   | 824    | 0.12   | 0.51           | 95          |

### Whisper

faster-whisper over the median video's whole audio (2307.9 s), as one call
with default decoding settings, no VAD. CPU uses `int8` and CUDA `float16`.
"Decode" is PyAV decoding and resampling the audio to 16 kHz mono (the
library's own `decode_audio`), "load" is loading the model from the local
cache, and the real-time factor is transcribe time divided by audio time. The
first CUDA attempt failed with `Library cublas64_12.dll is not found or cannot
be loaded`; it works once the `cuda` dependency group is installed.

| Model | Device | Decode s | Load s | Transcribe s | Real-time factor | Speed vs real time | Peak RSS MB |
| ----- | ------ | -------- | ------ | ------------ | ---------------- | ------------------ | ----------- |
| tiny  | CPU    | 2.6      | 4.1    | 145.2        | 0.063            | 16x                | 1996        |
| tiny  | CUDA   | 2.6      | 0.9    | 51.9         | 0.023            | 44x                | 2116        |
| base  | CPU    | 2.6      | 4.1    | 206.1        | 0.089            | 11x                | 2138        |
| base  | CUDA   | 2.6      | 1.0    | 68.4         | 0.030            | 34x                | 2211        |

Segment counts differ by model and device (tiny CPU 1616, tiny CUDA 1487, base
CPU 1008, base CUDA 1584), so the two devices are not producing identical text.

## What stands out

- **Memory is flat in duration for the rendering paths.** Python peaks at
  115 to 171 MB and Node at 223 to 334 MB from 38 minutes to 2 hours. Only the
  default plan on the 2 hour file is visibly higher in Python (171 MB against
  134 MB), which follows the size of the plan (824 sheets, 7414 frames), not the
  video. Nothing in either executor holds the decoded video.
- **Decoding dominates the default plan, rendering does not.** Python spends
  77 to 94 percent of the default run extracting frames. At 1 fps on 29.97 fps
  720p, extraction runs at about 0.03 to 0.04 s of work per second of video (92.8 s for
  2308 s, 236.6 s for 7415 s), so a 2 hour video costs about 4 minutes and
  extrapolates linearly. The 360p file is more than twice as fast per second
  of video (0.011 s per second).
- **Python seeks, Node decodes straight through.** Python's 16 frame plan takes
  1 to 2.4 s on every file, including 2 hours. Node's takes 66, 94 and 195 s,
  within 15 percent of its own default plan, because the library runs one ffmpeg
  over the whole range and discards what it does not need
  (`apps/node-library/src/capture.ts`). Node is the faster of the two on the
  dense default plan (75 s against 99 s on the median video, 236 s against 253 s
  at 2 hours, but 113 s against 48 s on the 360p file), and far slower on sparse
  plans. Any later improvement to Node's sparse path is worth 100x or more
  on a 2 hour video.
- **Node spends longer rendering.** Its render stage is 2.5 to 3 times Python's
  (16 s against 5 s on the median video) and its memory is 2 to 2.5 times
  higher, since it holds an ffmpeg process and the canvas library beside Node.
- **Planning is free.** 0.06 to 0.12 s for up to 824 sheets, and about 0.5 s
  with process start. Plan memory does grow with frame count: 47 MB for 2307
  frames, 95 MB for 7414.
- **A packet-only pass is nearly free and scales as expected.** 1.3 s for 222k
  packets of a 2 hour file at 62 MB, about 200 times cheaper than Python's
  default decode pass over the same file. `ffprobe` is the same speed with less memory. Keyframes are 2 to
  7 s apart in these files, so a keyframe index of a 2 hour video has about 2300
  entries.
- **Whisper is the cost that grows with duration.** On the CPU the `tiny`
  model is 16 times faster than real time, so a 2 hour video would take about 8
  minutes, and `base` about 11 to 12 minutes (extrapolated linearly, not
  measured). CUDA brings that to about 3 and 4 minutes, only 2 to 3 times
  faster than the CPU here. Peak memory is about 2 GB for either model, mostly
  the audio array (148 MB at 16 kHz float32 for 38 minutes, growing with
  duration) and the runtime, so it would grow by a few hundred MB at 2 hours.
- **Caveats.** One run each. PyAV and the Node ffmpeg-static are
  different decoders, so cross-executor timings are not a pure comparison of
  the planner. The files are ordinary web video with GOPs of 2 to 7 s; a file
  with sparse keyframes would stress seeking differently. Peak RSS is a sum
  over the process tree sampled every 100 ms, so a sharp peak shorter than that
  can be missed.

## Rerun

Everything runs from `experiments/long-video/baselines/`, with the Node packages
built once from the repo root.

```bash
# repo root, once
npm ci
npm run build --workspace apps/node-library --workspace apps/node-cli

# the 2 hour file (stream copy; the three inputs share codec settings)
mkdir -p /d/vid2grid-data/video-mme/cache/baselines
cd /d/vid2grid-data/video-mme/cache/baselines
printf "file 'D:/vid2grid-data/video-mme/videos/aqFfjJrLkBA.mp4'\nfile 'D:/vid2grid-data/video-mme/videos/9bbWYVrQgZ8.mp4'\nfile 'D:/vid2grid-data/video-mme/videos/eZ2Rt2DVGdU.mp4'\n" > concat.txt
ffmpeg -f concat -safe 0 -i concat.txt -c copy -movflags +faststart long_2h.mp4

# the measurements, written to results.json
cd experiments/long-video/baselines
uv sync --all-groups
uv run python run.py                              # everything
uv run python run.py --only plan demux_pyav       # a subset
uv run python run.py --only whisper --whisper-devices cpu
uv run python tables.py                           # results.json as markdown tables

# checks
uv run ruff check .
uv run ruff format --check .
```

| File         | What it does                                                                   |
| ------------ | ------------------------------------------------------------------------------ |
| `config.py`  | Paths, the three videos and the two plans.                                     |
| `measure.py` | Runs a command and returns wall time and peak RSS of its process tree.         |
| `tasks.py`   | One unit of Python work per process: plan, render, demux, whisper.             |
| `run.py`     | Runs every measurement and writes `results.json`.                              |
| `tables.py`  | Prints `results.json` as markdown tables.                                      |
| `results.json` | The raw numbers behind this file.                                            |
