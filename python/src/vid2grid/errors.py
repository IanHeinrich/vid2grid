from typing import ClassVar, Literal

Vid2GridErrorCode = Literal["invalid_request", "no_audio", "no_frames", "internal"]


class Vid2GridError(Exception):
    code: ClassVar[Vid2GridErrorCode] = "internal"


# Each subclass also derives from the builtin this package raised before, so existing
# `except ValueError` and `except RuntimeError` callers keep catching it.
class InvalidRequestError(Vid2GridError, ValueError):
    code = "invalid_request"


class NoFramesError(Vid2GridError, ValueError):
    code = "no_frames"


class InternalError(Vid2GridError, RuntimeError):
    code = "internal"
