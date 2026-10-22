# vid2grid-cli (Python command line)

The `vid2grid` command: turns a video into collage sheets, grid JPEGs packing
many timestamped frames, from the shell. It is a thin layer over the
[vid2grid Python library](../python-library/), so its sheets match the
website's and the other ways of using vid2grid.

## Install

Run it without installing, with [uv](https://docs.astral.sh/uv/):

```bash
uvx --from "git+https://github.com/IanHeinrich/vid2grid#subdirectory=apps/python-cli" vid2grid clip.mp4 -o sheets
```

Or install the command with pip:

```bash
pip install "git+https://github.com/IanHeinrich/vid2grid#subdirectory=apps/python-cli"
```

With transcripts:

```bash
pip install "vid2grid-cli[transcribe] @ git+https://github.com/IanHeinrich/vid2grid#subdirectory=apps/python-cli"
```

`uvx --from git+...` builds the command and the library from the same commit.
`pip install git+...` of this package fetches the library from `main`'s
`apps/python-library`, whichever commit you named for the command.

## Usage

```bash
vid2grid clip.mp4 --fps 2 --frames-per-grid 16 -o sheets
vid2grid clip.mp4 --plan-only
vid2grid --help
```

Without `-o`, the sheets go in a new folder beside the video, named the way
the website names its download. `python -m vid2grid_cli` runs the same
command.

It prints one line per sheet with its path and the first and last timestamp
captured on it, then any transcript paths. Warnings go to stderr.

- `--plan-only` writes nothing. It prints the `RenderPlan` as JSON, with
  every sheet's file name and frame timestamps.
- `--json` prints the result as JSON instead: the same dict the MCP server
  returns for that call.

An error prints `vid2grid: <message>` to stderr and exits with 2 for a bad
request, a missing video among them, and 1 otherwise.

## Options

The flags come from core's option specs, the same list every way of using
vid2grid offers. A flag left off gets core's default.

| Flag                | Default              | What it does                                                        |
| ------------------- | -------------------- | ------------------------------------------------------------------- |
| `--start`           | 0                    | start time in seconds                                               |
| `--end`             | the video's duration | end time in seconds                                                 |
| `--fps`             | 1                    | frames sampled per second                                           |
| `--frames-per-grid` | 9                    | frames on each sheet                                                |
| `--resolution`      | 2048                 | sheet side in pixels                                                |
| `--quality`         | 80                   | JPEG quality, 1 to 100                                              |
| `--keyframes`       | off                  | capture the video's keyframes instead of sampling by fps            |
| `--max-keyframes`   |                      | with `--keyframes`, thin the keyframes evenly to at most this many  |
| `--frame-count`     |                      | exactly this many evenly spaced frames, in place of the fps         |
| `--transcript`      | none                 | `none`, `per-sheet` or `combined`; only with the `transcribe` extra |

## Development

From `apps/python-cli/`:

```bash
uv sync --all-groups
uv run vid2grid clip.mp4 -o sheets
uv run pytest
uv run ruff check .
uv run ruff format --check .
uv run mypy
```

`uv sync` installs the library from `../python-library` in editable mode, so
a change there shows up here at once.
