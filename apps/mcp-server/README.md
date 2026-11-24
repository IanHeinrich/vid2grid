# vid2grid-mcp (MCP server)

The `vid2grid-mcp` command: an MCP server on stdio that lets an AI agent turn
a local video into collage sheets, grid JPEGs packing many timestamped
frames. It is built on the [vid2grid Python library](../python-library/), so
its sheets match the website's and the other ways of using vid2grid.

## Install

Add it to Claude Code:

```bash
claude mcp add vid2grid -- uvx --from "git+https://github.com/IanHeinrich/vid2grid#subdirectory=apps/mcp-server" vid2grid-mcp
```

With transcripts:

```bash
claude mcp add vid2grid -- uvx --from "vid2grid-mcp[transcribe] @ git+https://github.com/IanHeinrich/vid2grid#subdirectory=apps/mcp-server" vid2grid-mcp
```

From a checkout, give uv the folder's absolute path, since the client may start
the server from any directory:

```bash
claude mcp add vid2grid -- uv run --directory /path/to/vid2grid/apps/mcp-server vid2grid-mcp
```

Any MCP client that launches a stdio server works the same way: give it the
command after `--`.

`uvx --from git+...` builds the server and the library from the same commit.
`pip install git+...` of this package fetches the library from `main`'s
`apps/python-library`, whichever commit you named for the server.

## Tools

**`video_to_sheets`** renders the sheets. It returns each sheet's path with
the first and last timestamp captured on it, any transcript paths, any
warnings, the frame count, the timings and the vid2grid version: the same
dict the command line's `--json` prints. Each sheet also comes back as an MCP
image block, in sheet order, so a client without access to the local files
still sees the frames. Past 10 sheets only the paths come back, with a note
saying so. Set `includeImages` to false to skip the images altogether.

**`plan_video`** plans without rendering. It returns the `RenderPlan`, with
every sheet's file name and frame timestamps, and any warnings, so an agent
can check the sheet count before calling `video_to_sheets`.

Both take:

| Input              | Default                       | What it is                                                             |
| ------------------ | ----------------------------- | ---------------------------------------------------------------------- |
| `path`             | required                      | path to the video file                                                 |
| `outDir`           | a new folder beside the video | folder for the sheets; `video_to_sheets` only                          |
| `includeImages`    | true                          | return the sheets as images as well as paths; `video_to_sheets` only   |
| `startSeconds`     | 0                             | start time in seconds                                                  |
| `endSeconds`       | the video's duration          | end time in seconds                                                    |
| `targetFps`        | 1                             | frames sampled per second                                              |
| `framesPerGrid`    | 9                             | frames on each sheet                                                   |
| `outputResolution` | 2048                          | sheet side in pixels                                                   |
| `jpegQuality`      | 80                            | JPEG quality, 1 to 100                                                 |
| `keyframeSampling` | false                         | capture the video's keyframes instead of sampling by fps               |
| `maxKeyframes`     |                               | with keyframe sampling, thin the keyframes evenly to at most this many |
| `frameCount`       |                               | exactly this many evenly spaced frames, in place of the fps            |
| `timestampsSeconds` |                               | exact times in seconds to capture, in place of sampling by fps         |
| `area`             |                               | left, top, right, bottom to show, in thousandths of the picture        |
| `transcript`       | `none`                        | `none`, `per-sheet` or `combined`; only with the `transcribe` extra    |

The options are core's option specs, the same ones every way of using
vid2grid offers, and core checks the values. A bad value comes back as a tool
error carrying core's error code and message.

**`zoom_frame`** shows one moment up close: one frame, or part of it, as an
MCP image block. An agent looks at sheets first, then zooms into a moment it
wants to see better. It also returns the timestamp really captured, the area,
the image's size in pixels and any warnings. No files are written. It takes:

| Input              | Default            | What it is                                               |
| ------------------ | ------------------ | -------------------------------------------------------- |
| `path`             | required           | path to the video file                                   |
| `timeSeconds`      | required           | time in seconds; the first frame at or after it is shown |
| `left`             | the whole frame    | left edge of the area, 0 to 1000 across the whole frame  |
| `top`              | the whole frame    | top edge of the area, 0 to 1000 down the whole frame     |
| `right`            | the whole frame    | right edge of the area, 0 to 1000 across the whole frame |
| `bottom`           | the whole frame    | bottom edge of the area, 0 to 1000 down the whole frame  |
| `outputResolution` | fitted to the area | side in pixels of a square the image fits inside         |
| `jpegQuality`      | 80                 | JPEG quality, 1 to 100                                   |

`left`, `top`, `right` and `bottom` count from the frame's top left, in
thousandths of the whole frame, not of the sheet it was seen on. Give all four
or none. With none, the whole frame comes back at full size. An area is shown
at up to twice its size in the video, and never smaller than its size there,
unless `outputResolution` says otherwise.

`timestampSeconds` in the result is the time of the frame shown, which is the
first one at or after the time asked for.

## Development

From `apps/mcp-server/`:

```bash
uv sync --all-groups
uv run pytest
uv run ruff check .
uv run ruff format --check .
uv run mypy
```

`uv sync` installs the library from `../python-library` in editable mode, so
a change there shows up here at once.
