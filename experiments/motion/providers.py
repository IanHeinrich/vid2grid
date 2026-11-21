import base64
import os
import sys
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import httpx


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
    "openai": Provider(
        "openai", "https://api.openai.com/v1", "OPENAI_API_KEY", "max_completion_tokens"
    ),
}

NOT_VISION = (
    "embed",
    "tts",
    "audio",
    "realtime",
    "transcribe",
    "image",
    "imagen",
    "veo",
    "aqa",
    "search",
    "moderation",
    "whisper",
    "dall-e",
    "live",
    "codex",
    "babbage",
    "davinci",
    "lyria",
    "genie",
    "banana",
)


GEMINI_NATIVE_URL = "https://generativelanguage.googleapis.com/v1beta"
# Gemini 3 treats medium video like low (about 70 tokens a frame); high is about 280.
NATIVE_MEDIA_RESOLUTION = "MEDIA_RESOLUTION_HIGH"
THINKING_BUDGETS = {"none": 0, "minimal": 512, "low": 1024, "medium": 8192, "high": 24576}


class ProviderError(Exception):
    pass


@dataclass(frozen=True)
class Reply:
    text: str
    usage: dict[str, int]
    model: str


@dataclass(frozen=True)
class ModelInfo:
    id: str
    vision: bool | None
    input_usd_per_m: float | None = None
    output_usd_per_m: float | None = None


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


def client(provider: Provider, key: str) -> httpx.Client:
    return httpx.Client(
        base_url=provider.base_url,
        headers={"Authorization": f"Bearer {key}"},
        timeout=httpx.Timeout(180, connect=20),
    )


def require_key(provider: Provider) -> str:
    key = api_key(provider)
    if not key:
        raise ProviderError(f"{provider.name}: {provider.key_env} is not set, skipping")
    return key


def list_models(provider: Provider) -> list[ModelInfo]:
    key = require_key(provider)
    params = {"type": "text"} if provider.name == "venice" else {}
    try:
        with client(provider, key) as http:
            response = http.get("/models", params=params)
    except httpx.HTTPError as exc:
        raise ProviderError(scrub(f"{provider.name}: {type(exc).__name__}: {exc}", key)) from None
    if response.status_code != 200:
        raise ProviderError(
            scrub(f"{provider.name}: HTTP {response.status_code}: {response.text[:300]}", key)
        )
    models = []
    for entry in response.json().get("data", []):
        model_id = str(entry.get("id", "")).removeprefix("models/")
        spec = entry.get("model_spec")
        if isinstance(spec, dict):
            pricing = spec.get("pricing") or {}
            models.append(
                ModelInfo(
                    model_id,
                    bool((spec.get("capabilities") or {}).get("supportsVision")),
                    _usd(pricing.get("input")),
                    _usd(pricing.get("output")),
                )
            )
        elif not any(word in model_id.lower() for word in NOT_VISION):
            models.append(ModelInfo(model_id, None))
    return sorted(models, key=lambda m: m.id)


def _usd(value: Any) -> float | None:
    if isinstance(value, dict) and isinstance(value.get("usd"), int | float):
        return float(value["usd"])
    return None


def payload(
    provider: Provider,
    model: str,
    prompt: str,
    images: list[bytes],
    max_tokens: int,
    extra: dict[str, Any],
    temperature: bool = True,
) -> dict[str, Any]:
    content: list[dict[str, Any]] = [{"type": "text", "text": prompt}]
    for image in images:
        url = "data:image/jpeg;base64," + base64.b64encode(image).decode("ascii")
        content.append({"type": "image_url", "image_url": {"url": url}})
    body: dict[str, Any] = {
        "model": model,
        "messages": [{"role": "user", "content": content}],
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
    prompt: str,
    images: list[bytes],
    *,
    max_tokens: int,
    extra: dict[str, Any] | None = None,
) -> Reply:
    key = require_key(provider)
    with client(provider, key) as http:
        data = _post(
            http,
            "/chat/completions",
            lambda t: payload(provider, model, prompt, images, max_tokens, extra or {}, t),
            provider.name,
            key,
        )
    return _reply(data, model)


def thinking_config(model: str, extra: dict[str, Any]) -> dict[str, Any] | None:
    effort = extra.get("reasoning_effort")
    if not isinstance(effort, str):
        return None
    if model.startswith("gemini-2.5"):
        return {"thinkingBudget": THINKING_BUDGETS.get(effort, 1024)}
    return {"thinkingLevel": effort}


def native_video_payload(
    model: str,
    prompt: str,
    video: bytes,
    fps: float,
    max_tokens: int,
    extra: dict[str, Any],
    temperature: bool = True,
) -> dict[str, Any]:
    config: dict[str, Any] = {
        "maxOutputTokens": max_tokens,
        "mediaResolution": NATIVE_MEDIA_RESOLUTION,
    }
    if temperature:
        config["temperature"] = 0
    thinking = thinking_config(model, extra)
    if thinking:
        config["thinkingConfig"] = thinking
    video_part = {
        "inlineData": {"mimeType": "video/mp4", "data": base64.b64encode(video).decode("ascii")},
        "videoMetadata": {"fps": fps},
    }
    return {
        "contents": [{"role": "user", "parts": [video_part, {"text": prompt}]}],
        "generationConfig": config,
    }


def complete_native_video(
    model: str,
    prompt: str,
    video: bytes,
    fps: float,
    *,
    max_tokens: int,
    extra: dict[str, Any] | None = None,
) -> Reply:
    provider = PROVIDERS["gemini"]
    key = require_key(provider)
    with httpx.Client(
        base_url=GEMINI_NATIVE_URL,
        headers={"x-goog-api-key": key},
        timeout=httpx.Timeout(180, connect=20),
    ) as http:
        data = _post(
            http,
            f"/models/{model}:generateContent",
            lambda t: native_video_payload(model, prompt, video, fps, max_tokens, extra or {}, t),
            "gemini native",
            key,
        )
    return _native_reply(data, model)


def _native_reply(data: dict[str, Any], model: str) -> Reply:
    candidates = data.get("candidates") or [{}]
    parts = (candidates[0].get("content") or {}).get("parts") or []
    text = "".join(p.get("text", "") for p in parts if isinstance(p, dict) and not p.get("thought"))
    meta = data.get("usageMetadata") or {}
    by_modality = {
        str(d.get("modality", "")).lower(): int(d.get("tokenCount") or 0)
        for d in meta.get("promptTokensDetails") or []
    }
    candidates_tokens = int(meta.get("candidatesTokenCount") or 0)
    thoughts = int(meta.get("thoughtsTokenCount") or 0)
    usage = {
        "prompt_tokens": int(meta.get("promptTokenCount") or 0),
        "output_tokens": candidates_tokens + thoughts,
        "completion_tokens": candidates_tokens,
        "reasoning_tokens": thoughts,
        "total_tokens": int(meta.get("totalTokenCount") or 0),
        "video_tokens": by_modality.get("video", 0),
        "audio_tokens": by_modality.get("audio", 0),
        "text_tokens": by_modality.get("text", 0),
    }
    return Reply(text, usage, str(data.get("modelVersion") or model))


def _reply(data: dict[str, Any], model: str) -> Reply:
    choices = data.get("choices") or [{}]
    message = choices[0].get("message") or {}
    content = message.get("content")
    if isinstance(content, list):
        content = "".join(part.get("text", "") for part in content if isinstance(part, dict))
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
    return Reply(str(content or ""), usage, str(data.get("model") or model))
