# @vid2grid/node-cli (Node command line)

The `vid2grid-node` command: turns a video into collage sheets, grid JPEGs
packing many timestamped frames, from the shell, with no Python involved. It
is a thin layer over the [Node library](../node-library/), which brings its
own ffmpeg and ffprobe, so its sheets match the website's and the other ways
of using vid2grid. It does not transcribe.

## Install

The package is private and not on npm, so it runs from a clone. It needs
Node 20 or later. From the repo root, build the library first, because the
command line loads the library's built `dist/` at run time:

```bash
npm ci
npm run build --workspace apps/node-library --workspace apps/node-cli
```

## Usage

```bash
node apps/node-cli/dist/cli.js clip.mp4 -o sheets
node apps/node-cli/dist/cli.js clip.mp4 -o sheets --fps 4 --frames-per-grid 9
node apps/node-cli/dist/cli.js --help
```

The package declares `vid2grid-node` as the bin for the same entry point.

`-o` (or `--out`) is required. It prints the path of each sheet it wrote,
`grid_0001.jpg` onwards, then a line on stderr with the frame and sheet count
and the time spent extracting and rendering. Warnings go to stderr. An error
prints its message and exits with 1.

## Options

The flags come from core's option specs, the same list every way of using
vid2grid offers, and core fills in the same defaults. `--help` prints them.

| Flag                | Default              | What it does                                                       |
| ------------------- | -------------------- | ------------------------------------------------------------------ |
| `--start`           | 0                    | start time in seconds                                              |
| `--end`             | the video's duration | end time in seconds                                                |
| `--fps`             | 1                    | frames sampled per second                                          |
| `--frames-per-grid` | 9                    | frames on each sheet                                               |
| `--resolution`      | 2048                 | sheet side in pixels                                               |
| `--quality`         | 80                   | JPEG quality, 1 to 100                                             |
| `--keyframes`       | off                  | capture the video's keyframes instead of sampling by fps           |
| `--max-keyframes`   |                      | with `--keyframes`, thin the keyframes evenly to at most this many |
| `--frame-count`     |                      | exactly this many evenly spaced frames, in place of the fps        |

`--transcript` is not offered, because this host has no transcription.

## Development

From the repo root:

```bash
npx vitest run --root apps/node-cli
npm run build --workspace apps/node-library --workspace apps/node-cli
```

The build bundles core into `dist/cli.js` and leaves `@vid2grid/node`
external, so a change to the library needs the library rebuilt too.
