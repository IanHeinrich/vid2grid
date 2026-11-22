import base64
import os
import sys
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

import httpx

if TYPE_CHECKING:
    from prompts import Message


@dataclass(frozen=True)
class Provider:
    name: str
    base_url: str
    key_env: str
    max_tokens_field: str = "max_tokens"


PROVIDERS = {
    "venice": Provider("venice", "https://api.venice.ai/api/v1", "VENICE_API_KEY"),
    "gemini": Provider(
        "gemini", "https://generativelanguage.googleapis.com/v1beta/openai", "GEMINI_API_KEY"
    ),
}


class ProviderError(Exception):
    pass


@dataclass(frozen=True)
class Reply:
    text: str
    usage: dict[str, int]
    model: str


# The shell running this may predate the keys, so fall back to the stored user environment.
def api_key(provider: Provider) -> str | None:
    value = os.environ.get(provider.key_env)
    if value:
        return value
    if sys.platform != "win32":
        return None
    import winreg

    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as key:
            stored, _ = winreg.QueryValueEx(key, provider.key_env)
    except OSError:
        return None
    return str(stored) or None


def scrub(text: str, key: str) -> str:
    return text.replace(key, "[key]") if key else text


def require_key(provider: Provider) -> str:
    key = api_key(provider)
    if not key:
        raise ProviderError(f"{provider.name}: {provider.key_env} is not set, skipping")
    return key


def content(message: "Message") -> str | list[dict[str, Any]]:
    if all(isinstance(part, str) for part in message.parts):
        return "\n\n".join(str(part) for part in message.parts)
    parts: list[dict[str, Any]] = []
    for part in message.parts:
        if isinstance(part, Path):
            url = "data:image/jpeg;base64," + base64.b64encode(part.read_bytes()).decode("ascii")
            parts.append({"type": "image_url", "image_url": {"url": url}})
        else:
            parts.append({"type": "text", "text": part})
    return parts


def payload(
    provider: Provider,
    model: str,
    messages: list["Message"],
    max_tokens: int,
    extra: dict[str, Any],
    temperature: bool = True,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "model": model,
        "messages": [{"role": m.role, "content": content(m)} for m in messages],
        provider.max_tokens_field: max_tokens,
        **extra,
    }
    if temperature:
        body["temperature"] = 0
    return body


def _post(
    http: httpx.Client, path: str, build: Callable[[bool], dict[str, Any]], name: str, key: str
) -> dict[str, Any]:
    temperature = True
    for attempt in range(5):
        try:
            response = http.post(path, json=build(temperature))
        except httpx.HTTPError as exc:
            message = scrub(f"{name}: {type(exc).__name__}: {exc}", key)
            if attempt == 4:
                raise ProviderError(message) from None
            time.sleep(2**attempt)
            continue
        text = response.text
        # Some models accept only their default temperature; that 400 is not billed.
        if response.status_code == 400 and temperature and "temperature" in text.lower():
            temperature = False
            continue
        if response.status_code in (429, 500, 502, 503, 504) and attempt < 4:
            time.sleep(2 ** (attempt + 1))
            continue
        if response.status_code != 200:
            raise ProviderError(scrub(f"{name}: HTTP {response.status_code}: {text[:500]}", key))
        data: dict[str, Any] = response.json()
        return data
    raise ProviderError(f"{name}: gave up after retries")


def complete(
    provider: Provider,
    model: str,
    messages: list["Message"],
    *,
    max_tokens: int,
    extra: dict[str, Any] | None = None,
) -> Reply:
    key = require_key(provider)
    with httpx.Client(
        base_url=provider.base_url,
        headers={"Authorization": f"Bearer {key}"},
        timeout=httpx.Timeout(300, connect=20),
    ) as http:
        data = _post(
            http,
            "/chat/completions",
            lambda t: payload(provider, model, messages, max_tokens, extra or {}, t),
            provider.name,
            key,
        )
    return _reply(data, model)


def _reply(data: dict[str, Any], model: str) -> Reply:
    choices = data.get("choices") or [{}]
    message = choices[0].get("message") or {}
    text = message.get("content")
    if isinstance(text, list):
        text = "".join(part.get("text", "") for part in text if isinstance(part, dict))
    raw_usage = data.get("usage") or {}
    prompt_tokens = int(raw_usage.get("prompt_tokens") or 0)
    completion = int(raw_usage.get("completion_tokens") or 0)
    total = int(raw_usage.get("total_tokens") or prompt_tokens + completion)
    details = raw_usage.get("completion_tokens_details") or {}
    usage = {
        "prompt_tokens": prompt_tokens,
        # Gemini leaves thinking out of completion_tokens but bills it; total_tokens has it.
        "output_tokens": max(completion, total - prompt_tokens),
        "completion_tokens": completion,
        "reasoning_tokens": int(details.get("reasoning_tokens") or 0),
        "total_tokens": total,
    }
    return Reply(str(text or ""), usage, str(data.get("model") or model))
