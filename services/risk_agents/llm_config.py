import os

from crewai import LLM

DEFAULT_CREWAI_MODEL = "anthropic/claude-sonnet-4-6"
DEFAULT_CREWAI_MAX_TOKENS = 4096


def get_crewai_llm() -> LLM:
    api_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is required for CrewAI Claude agents.")

    model = os.getenv("CREWAI_LLM_MODEL", DEFAULT_CREWAI_MODEL).strip() or DEFAULT_CREWAI_MODEL
    max_tokens = int(os.getenv("CREWAI_MAX_TOKENS", DEFAULT_CREWAI_MAX_TOKENS))
    return LLM(model=model, api_key=api_key, max_tokens=max_tokens)
