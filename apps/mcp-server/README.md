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
dict the command line's `--json` prints.

**`plan_video`** plans without rendering. It returns the `RenderPlan`, with
every sheet's file name and frame timestamps, and any warnings, so an agent
can check the sheet count before calling `video_to_sheets`.

Both take:

| Input              | Default                       | What it is                                                             |
| ------------------ | ----------------------------- | ---------------------------------------------------------------------- |
| `path`             | required                      | path to the video file                                                 |
| `outDir`           | a new folder beside the video | folder for the sheets; `video_to_sheets` only                          |
| `startSeconds`     | 0                             | start time in seconds                                                  |
| `endSeconds`       | the video's duration          | end time in seconds                                                    |
| `targetFps`        | 1                             | frames sampled per second                                              |
| `framesPerGrid`    | 9                             | frames on each sheet                                                   |
| `outputResolution` | 2048                          | sheet side in pixels                                                   |
| `jpegQuality`      | 80                            | JPEG quality, 1 to 100                                                 |
| `keyframeSampling` | false                         | capture the video's keyframes instead of sampling by fps               |
| `maxKeyframes`     |                               | with keyframe sampling, thin the keyframes evenly to at most this many |
| `frameCount`       |                               | exactly this many evenly spaced frames, in place of the fps            |
| `transcript`       | `none`                        | `none`, `per-sheet` or `combined`; only with the `transcribe` extra    |

The options are core's option specs, the same ones every way of using
vid2grid offers, and core checks the values. A bad value comes back as a tool
error carrying core's error code and message.

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
