import argparse
import json
import sys
from collections.abc import Sequence

from ._core import OptionSpec, option_specs
from .errors import Vid2GridError
from .options import host_capabilities, plan_from_options, render_from_options
from .sheets import PlanResult, RenderResult


def main(argv: Sequence[str] | None = None) -> int:
    specs = option_specs(host_capabilities())
    args = _parser(specs).parse_args(argv)
    values = {spec["name"]: getattr(args, spec["name"]) for spec in specs}
    try:
        result = (
            plan_from_options(args.video, values)
            if args.plan_only
            else render_from_options(args.video, args.out_dir, values)
        )
    except Vid2GridError as exc:
        print(f"vid2grid: {exc}", file=sys.stderr)
        return 2 if exc.code == "invalid_request" else 1

    if args.json:
        print(json.dumps(result.to_dict(), indent=2))
        return 0
    if isinstance(result, PlanResult):
        print(json.dumps(result.plan.to_dict(), indent=2))
    else:
        _print_sheets(result)
    for warning in result.warnings:
        print(f"vid2grid: warning: {warning}", file=sys.stderr)
    return 0


def _parser(specs: Sequence[OptionSpec]) -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="vid2grid",
        allow_abbrev=False,
        description="Turn a video into collage sheets: grid JPEGs packing many timestamped frames.",
    )
    parser.add_argument("video", help="the video file to read")
    parser.add_argument(
        "-o",
        dest="out_dir",
        metavar="OUT_DIR",
        help="directory for the sheets (default: a folder named for the video, beside it)",
    )
    parser.add_argument(
        "--plan-only", action="store_true", help="print the RenderPlan as JSON and write nothing"
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="print the result as JSON, the same dict the MCP server returns",
    )
    for spec in specs:
        _add_option(parser, spec)
    return parser


def _add_option(parser: argparse.ArgumentParser, spec: OptionSpec) -> None:
    flag = f"--{spec['flag']}"
    metavar = spec["flag"].upper().replace("-", "_")
    help_text = spec["help"].replace("%", "%%")
    if spec["type"] == "boolean":
        parser.add_argument(
            flag, dest=spec["name"], action="store_true", default=None, help=help_text
        )
        return
    if "default" in spec:
        help_text += f" (default: {spec['default']})"
    if spec["type"] == "enum":
        parser.add_argument(flag, dest=spec["name"], choices=spec["values"], help=help_text)
    else:
        parser.add_argument(flag, dest=spec["name"], type=_number, metavar=metavar, help=help_text)


# Integers go to core as given, so it can reject 2.5 for an integer option with its own message.
def _number(text: str) -> int | float:
    try:
        return int(text)
    except ValueError:
        return float(text)


def _print_sheets(result: RenderResult) -> None:
    for sheet in result.sheets:
        first, last = sheet.first_timestamp_seconds, sheet.last_timestamp_seconds
        print(f"{sheet.path}  {first:.2f}s to {last:.2f}s")
    for path in result.transcript_paths:
        print(path)


if __name__ == "__main__":
    sys.exit(main())
