from dataclasses import dataclass
from pathlib import Path

from dataset import Question, format_span
from render import Sheet

SYSTEM = (
    "You answer multiple-choice questions about a video. You cannot watch it: you get only the "
    "material each message describes. Pick the single best option, even when unsure. Reply with "
    'only a JSON object, no other text: {"answer": "<letter>"}'
)
SHEETS = (
    "in time order across the sheets and in reading order within each (left to right, then top "
    "to bottom). Each frame is stamped with its time at top left and its sample number at top "
    "right."
)
SUBTITLES = "the video's subtitles, each line starting with its time as [m:ss]"
OVERVIEW_CALL = "overview"
PINNING_LAYOUT = "s4x20"


@dataclass(frozen=True)
class Condition:
    layout: str | None
    transcript: bool


CONDITIONS = {
    "blind": Condition(None, False),
    "transcript": Condition(None, True),
    "s4x20": Condition("s4x20", False),
    "s4x20_t": Condition("s4x20", True),
    "s4x9": Condition("s4x9", False),
    "s4x9_t": Condition("s4x9", True),
    "s8x9": Condition("s8x9", False),
    "s8x9_t": Condition("s8x9", True),
    "f10": Condition("f10", False),
    "f10_t": Condition("f10", True),
    "scene4x20": Condition("scene", False),
    "even4x20": Condition("even", False),
}
PINNING = ("pinned", "stubbed")
GROUPS = {
    "core": ("blind", "transcript", "s4x20", "s4x20_t", "s4x9", "s4x9_t", "f10", "f10_t"),
    "s8x9": ("s8x9", "s8x9_t"),
    "scene": ("scene4x20", "even4x20"),
    "pinning": PINNING,
}

Part = str | Path


@dataclass(frozen=True)
class Message:
    role: str
    parts: tuple[Part, ...]


def legend(layout: str | None, sheets: list[Sheet]) -> str:
    frames = sum(len(sheet.times) for sheet in sheets)
    if layout is None:
        return ""
    if layout == "f10":
        return (
            f"You get {len(sheets)} separate frames spread evenly over the whole video, in time "
            "order, each stamped with its time at top left and its sample number at top right."
        )
    spread = "from across" if layout in ("scene", "even") else "spread evenly over"
    count = f"{len(sheets)} contact sheets holding {frames} frames"
    return f"You get {count} {spread} the whole video, {SHEETS}"


def round_for_label(seconds: float) -> float:
    return round(seconds * 10) / 10


def sheet_contents(sheet: Sheet) -> str:
    frames = len(sheet.times)
    span = format_span(round_for_label(sheet.start), round_for_label(sheet.end))
    return f"{span}, {frames} frame{'' if frames == 1 else 's'}"


def sheet_line(sheet: Sheet) -> str:
    return f"{sheet.name}: {sheet_contents(sheet)}"


# Matches imageStub(ref, "earlier") in apps/chat/src/imageRefs.ts for an overview sheet.
def image_stub(sheet: Sheet, call: str = OVERVIEW_CALL) -> str:
    recall = f"{sheet.name} from {call}"
    return (
        f'[{recall}: {sheet_contents(sheet)}. Sent earlier; call recall("{recall}") to see it '
        "again.]"
    )


def question_block(question: Question) -> str:
    options = "\n".join(question.options)
    return f"Question: {question.question}\n{options}"


def transcript_block(transcript: str) -> str:
    body = transcript or "(no subtitles exist for this video)"
    return f"Subtitles:\n{body}"


def material_text(condition: Condition, sheets: list[Sheet], minutes: int) -> str:
    lines = [f"The video is about {minutes} minutes long."]
    if condition.layout is None and not condition.transcript:
        lines.append("You get no material from the video: answer from the question alone.")
    if condition.layout is not None:
        lines.append(legend(condition.layout, sheets))
    if condition.transcript:
        also = "You also get" if condition.layout is not None else "You get"
        none = "" if condition.layout is not None else " You get no images."
        lines.append(f"{also} {SUBTITLES}.{none}")
    if sheets:
        lines += ["", "Images:", *(sheet_line(sheet) for sheet in sheets)]
    return "\n".join(lines)


def first_turn(
    condition: Condition,
    question: Question,
    sheets: list[Sheet],
    transcript: str,
    minutes: int,
    stubbed: bool = False,
) -> Message:
    tail = [transcript_block(transcript)] if condition.transcript else []
    tail.append(question_block(question))
    material = material_text(condition, sheets, minutes)
    if stubbed:
        stubs = "\n".join(image_stub(sheet) for sheet in sheets)
        return Message("user", (f"{material}\n\n{stubs}\n\n" + "\n\n".join(tail),))
    images = tuple(sheet.path for sheet in sheets)
    return Message("user", (material, *images, "\n\n".join(tail)))


def single_request(
    condition: Condition, question: Question, sheets: list[Sheet], transcript: str, minutes: int
) -> list[Message]:
    turn = first_turn(condition, question, sheets, transcript, minutes)
    return [Message("system", (SYSTEM,)), turn]


def later_turn(question: Question) -> Message:
    return Message(
        "user", ("Another question about the same video.\n\n" + question_block(question),)
    )


def pinning_request(
    variant: str,
    questions: list[Question],
    replies: list[str],
    sheets: list[Sheet],
    transcript: str,
    minutes: int,
) -> list[Message]:
    turn = len(replies)
    condition = Condition(PINNING_LAYOUT, True)
    stubbed = variant == "stubbed" and turn > 0
    messages = [
        Message("system", (SYSTEM,)),
        first_turn(condition, questions[0], sheets, transcript, minutes, stubbed),
    ]
    for index, reply in enumerate(replies):
        messages.append(Message("assistant", (reply,)))
        messages.append(later_turn(questions[index + 1]))
    return messages
