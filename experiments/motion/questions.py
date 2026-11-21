from dataclasses import dataclass
from typing import Any

DIRECTIONS = ["left", "right", "up", "down", "none"]
# Past this, the grid conditions hold 16 frames spread over the clip, not one a second.
GRID_MAX_SECONDS = 16


@dataclass(frozen=True)
class Question:
    text: str
    options: list[str]
    type: str


QUESTIONS = {
    "direction_red": Question(
        "Which way does the red ball move relative to the background over the clip?",
        DIRECTIONS,
        "direction",
    ),
    "direction_blue": Question(
        "Which way does the blue ball move relative to the background over the clip?",
        DIRECTIONS,
        "direction",
    ),
    "first_direction": Question(
        "Which way does the red ball move during the first half of the clip?",
        DIRECTIONS,
        "bounce",
    ),
    "second_direction": Question(
        "Which way does the red ball move during the second half of the clip?",
        DIRECTIONS,
        "bounce",
    ),
    "background": Question(
        "Which way does the background (the textured scene) move across the frame?",
        ["left", "right", "none"],
        "background",
    ),
    "count": Question(
        "How many times does the red ball go back and forth? Out and back counts as one.",
        ["1", "2", "3", "4", "5", "6"],
        "count",
    ),
    "faster": Question("Which ball moves faster?", ["red", "blue", "same"], "faster"),
    "moved": Question(
        "Does anything move during the clip, counting camera movement?", ["yes", "no"], "moved"
    ),
    "object_moved": Question(
        "Does either ball move relative to the background? Camera shake does not count.",
        ["yes", "no"],
        "object_moved",
    ),
}

GRID = (
    "a contact sheet of frames sampled at one per second, in reading order (left to right, "
    "then top to bottom), each stamped with its time in seconds at top left and its sample "
    "number at top right"
)
PAIR = "one image with two panels: on the left, the final frame of the clip as it is; on the right"
TRACK3X3 = (
    "Each text line is a 0.5 s step starting at its timestamp, with three groups of three "
    "digits for the top, middle and bottom rows of the frame, each left to right, giving "
    "motion from 0 (none) to 9 (most)."
)
WINDOWS = (
    "a few separate images spread over the clip, in time order, each covering about one second "
    "of video"
)
PATHS = (
    "the frame at the end of that second with a thin line for each of up to 3 moving things, "
    "tracing its path over that second after removing camera motion, coloured from yellow "
    "(early) through green to purple (late), with dots every 0.25 s and an arrowhead where it "
    "ended. The strip under each gives how the camera moved"
)
GHOSTS = (
    "the frame at the end of that second with faint tinted ghosts of moving things at up to 3 "
    "earlier moments in that second, aligned to cancel camera motion: yellow earliest, then "
    "green, then purple. The strip under each gives the ghost times and how the camera moved"
)
ROBUST = (
    "The digits count only things moving within the scene: camera movement and shake, "
    "brightness changes and steady noise are removed first, and 0 means nothing rose above "
    "the clip's own noise level."
)

LEGENDS = {
    "single_frame": "one still frame from the middle of the clip.",
    "grid_1fps": f"{GRID}.",
    "frames_1fps": (
        "a series of separate images: frames sampled at one per second, in time order, each "
        "stamped with its time in seconds at top left."
    ),
    "burst": (
        "a contact sheet of 16 frames spread evenly over the clip, in reading order, each "
        "stamped with its time in seconds at top left and its sample number at top right."
    ),
    "trail_pair": (
        f"{PAIR}, the same final frame with coloured ghosts showing where moving things were "
        "in 6 earlier frames, aligned to cancel camera motion. The strip under the right panel "
        "gives each ghost colour's time, purple for the oldest to yellow for the newest."
    ),
    "trail_pair_nolegend": "",
    "trail_lines": (
        f"{PAIR}, the same final frame with a thin line tracing the path of each moving thing "
        "over the clip after cancelling camera motion, with dots at evenly spaced times and an "
        "arrowhead where it ended. Each path has its own colour."
    ),
    "onion_pair": (
        f"{PAIR}, the last 8 sampled frames blended together with later frames stronger, so "
        "moving things leave fading copies behind them. There is no camera alignment."
    ),
    "diff_pair": (
        f"{PAIR}, a heatmap of where the picture changed over the whole clip after cancelling "
        "camera motion, over a dimmed copy of the final frame. Brighter means more change."
    ),
    "grid_track1": (
        f"{GRID}, and a text motion track with one digit per 0.5 s of the clip in time order, "
        "from 0 (no motion) to 9 (most motion)."
    ),
    "grid_track3x3": f"{GRID}, and a text motion track. {TRACK3X3}",
    "grid_track3x3_cam": (
        f"{GRID}, and a text motion track. {TRACK3X3} Each line also gives 'bg', how far and "
        "which way the whole background shifted across the frame in that step (camera "
        "motion), and the digits measure the motion left after cancelling that shift."
    ),
    "grid_2048": f"{GRID}.",
    "grid_2048_large": (
        "a series of contact sheets of frames sampled at one per second, at most 4 frames to a "
        "sheet, in time order across the sheets and in reading order within each, each stamped "
        "with its time in seconds at top left and its sample number at top right."
    ),
    "grid_track3x3_v2": f"{GRID}, and a text motion track. {TRACK3X3} {ROBUST}",
    "grid_track3x3_cam_v2": (
        f"{GRID}, and a text motion track. {TRACK3X3} {ROBUST} Each line also gives 'bg', how "
        "far and which way the whole background shifted across the frame in that step "
        "(camera motion), or none."
    ),
    "window_frames": (
        "a few separate still frames spread over the clip, in time order, each stamped with its "
        "time."
    ),
    "trail_lines_v2": (
        f"{WINDOWS}. Each stacks two panels: on top, the frame at the end of that second as it "
        f"is; below, {PATHS}."
    ),
    "trail_ghosts_v2": (
        f"{WINDOWS}. Each stacks two panels: on top, the frame at the end of that second as it "
        f"is; below, {GHOSTS}."
    ),
    "grid_2048_lines": (
        f"{GRID}, followed by path images at a few moments spread over the clip, each covering "
        f"about one second and showing {PATHS}."
    ),
    **{
        f"native_{fps}fps": (
            f"the video clip itself, which you see sampled at {fps} frames per second."
        )
        for fps in (1, 8, 24)
    },
}


def legend_for(condition: str, clip: dict[str, Any]) -> str:
    legend = LEGENDS[condition]
    if float(clip.get("seconds", 5)) > GRID_MAX_SECONDS:
        legend = legend.replace(
            "frames sampled at one per second", "16 frames spread evenly over the clip"
        )
    return legend


def prompt(condition: str, clip: dict[str, Any], track: str, notes: str = "") -> str:
    if "question" in clip:
        return benchmark_prompt(condition, clip, track, notes)
    truth = clip["truth"]
    legend = LEGENDS[condition]
    lines = ["You are shown material made from a short video clip (about 5 seconds)."]
    if legend:
        lines.append(f"It is {legend}")
    if notes:
        lines.append(notes)
    if track:
        lines += ["", "Motion track:", track]
    lines += ["", "Answer every question by picking exactly one of its options."]
    keys = [key for key in QUESTIONS if key in truth]
    for key in keys:
        question = QUESTIONS[key]
        lines.append(f'- "{key}": {question.text} Options: {", ".join(question.options)}.')
    example = ", ".join(f'"{key}": "..."' for key in keys)
    lines += ["", f"Reply with only a JSON object, no other text: {{{example}}}"]
    return "\n".join(lines)


def benchmark_prompt(condition: str, clip: dict[str, Any], track: str, notes: str = "") -> str:
    legend = legend_for(condition, clip)
    seconds = round(float(clip["seconds"]))
    lines = [f"You are shown material made from a video clip (about {seconds} seconds)."]
    if legend:
        lines.append(f"It is {legend}")
    if notes:
        lines.append(notes)
    if track:
        lines += ["", "Motion track:", track]
    lines += ["", "Answer this multiple-choice question about the video.", "", clip["question"]]
    lines += ["", 'Reply with only a JSON object, no other text: {"answer": "<letter>"}']
    return "\n".join(lines)
