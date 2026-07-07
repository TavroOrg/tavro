"""Shared LLM HTTP helpers used by blueprint and business_relations routers."""
import os
import re
from typing import Any

import httpx
from fastapi import HTTPException

ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_MODEL   = "claude-sonnet-4-6"
OPENAI_API_URL    = "https://api.openai.com/v1/chat/completions"
OPENAI_MODEL      = "gpt-4o"

RESEARCH_MAX_OUTPUT_TOKENS: int = int(os.getenv("RESEARCH_MAX_OUTPUT_TOKENS", "3000"))


def _extract_json(raw: str) -> str:
    """Robustly extract a JSON object from text that may contain markdown fences or prose."""
    fenced = re.search(r'```(?:json)?[\s\n]*(\{[\s\S]*?\})[\s\n]*```', raw)
    if fenced:
        return fenced.group(1).strip()

    fenced_open = re.search(r'```(?:json)?[\s\n]*(\{[\s\S]*)', raw)
    if fenced_open:
        candidate = fenced_open.group(1).strip()
        start = candidate.find('{')
        if start != -1:
            depth = 0
            for i, ch in enumerate(candidate[start:], start):
                if ch == '{': depth += 1
                elif ch == '}':
                    depth -= 1
                    if depth == 0:
                        return candidate[start:i + 1]

    start = raw.find('{')
    if start != -1:
        depth = 0
        for i, ch in enumerate(raw[start:], start):
            if ch == '{': depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0:
                    return raw[start:i + 1]

    return raw.strip()


def _sanitize_json_control_chars(text: str) -> str:
    """
    Make LLM-generated text safe for json.loads() by escaping bare control
    characters (newlines, tabs, etc.) that appear *inside* JSON string
    literals. Models frequently emit literal newlines/tabs within long
    "summary" values, which is invalid per the JSON spec unless escaped —
    this is the most common cause of json.JSONDecodeError on research output.

    Control characters outside of strings (formatting whitespace between
    tokens) are left untouched, and existing backslash escapes are preserved,
    since a blind regex strip/replace over the whole text can't distinguish
    "control char inside a string" from "formatting whitespace."
    """
    out: list[str] = []
    in_string = False
    escaped = False
    for ch in text:
        if in_string:
            if escaped:
                out.append(ch)
                escaped = False
                continue
            if ch == "\\":
                out.append(ch)
                escaped = True
                continue
            if ch == '"':
                in_string = False
                out.append(ch)
                continue
            code = ord(ch)
            if code < 0x20:
                if ch == "\n":
                    out.append("\\n")
                elif ch == "\r":
                    out.append("\\r")
                elif ch == "\t":
                    out.append("\\t")
                elif code == 0x08:
                    out.append("\\b")
                elif code == 0x0c:
                    out.append("\\f")
                else:
                    out.append(f"\\u{code:04x}")
                continue
            out.append(ch)
        else:
            if ch == '"':
                in_string = True
            out.append(ch)
    return "".join(out)


async def _call_anthropic(
    api_key:    str,
    messages:   list[dict],
    system:     str,
    tools:      list[dict] | None = None,
    max_tokens: int = RESEARCH_MAX_OUTPUT_TOKENS,
) -> dict:
    payload: dict[str, Any] = {
        "model":      ANTHROPIC_MODEL,
        "max_tokens": max_tokens,
        "system":     system,
        "messages":   messages,
    }
    if tools:
        payload["tools"] = tools

    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            ANTHROPIC_API_URL,
            headers={
                "x-api-key":         api_key,
                "anthropic-version": "2023-06-01",
                "content-type":      "application/json",
            },
            json=payload,
        )

    if resp.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"Anthropic API error {resp.status_code}: {resp.text[:400]}",
        )
    return resp.json()


async def _call_openai(
    api_key:    str,
    messages:   list[dict],
    system:     str,
    max_tokens: int = RESEARCH_MAX_OUTPUT_TOKENS,
) -> dict:
    payload: dict[str, Any] = {
        "model":    OPENAI_MODEL,
        "messages": [{"role": "system", "content": system}] + messages,
        "max_tokens": max_tokens,
        "temperature": 0.2,
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            OPENAI_API_URL,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type":  "application/json",
            },
            json=payload,
        )

    if resp.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"OpenAI API error {resp.status_code}: {resp.text[:400]}",
        )

    data = resp.json()
    content      = data.get("choices", [{}])[0].get("message", {}).get("content", "") or ""
    finish_reason = data.get("choices", [{}])[0].get("finish_reason", "stop")
    return {
        "stop_reason": "max_tokens" if finish_reason == "length" else "end_turn",
        "content": [{"type": "text", "text": content}],
        "usage": data.get("usage", {}),
    }


def _collect_text(data: dict) -> str:
    return "\n".join(
        b["text"] for b in data.get("content", []) if b.get("type") == "text"
    ).strip()
