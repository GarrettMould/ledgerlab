"""Read OpenAI credentials from the process environment (Vercel / .env)."""

from __future__ import annotations

import os

_KEY_ALIASES = (
    "OPENAI_API_KEY",
    "OPEN_AI_API_KEY",
    "OPENAI_KEY",
)


def _clean(raw: str | None) -> str:
    text = str(raw or "").strip()
    if len(text) >= 2 and text[0] == text[-1] and text[0] in {'"', "'"}:
        text = text[1:-1].strip()
    return text


def openai_api_key() -> str:
    for name in _KEY_ALIASES:
        val = _clean(os.environ.get(name))
        if val:
            return val
    want = {n.replace("-", "_") for n in _KEY_ALIASES}
    for key, raw in os.environ.items():
        if key.strip().upper().replace("-", "_") in want:
            val = _clean(raw)
            if val:
                return val
    return ""


def openai_configured() -> bool:
    return bool(openai_api_key())
