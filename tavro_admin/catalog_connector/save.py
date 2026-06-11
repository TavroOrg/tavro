import json
from datetime import datetime
from pathlib import Path

_EXTRACTED_DIR = Path(__file__).parent / "extracted_json"


def save_agent_cards(connector_name: str, agent_cards: list):
    output_dir = _EXTRACTED_DIR / connector_name
    output_dir.mkdir(parents=True, exist_ok=True)

    for card in agent_cards:
        data = card.get("data", card) if isinstance(card, dict) else card
        raw_name = str(data.get("agent_id") or data.get("name") or "agent")
        safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in raw_name)
        ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S_%f")
        filepath = output_dir / f"{safe_name}_{ts}.json"
        filepath.write_text(
            json.dumps(data, indent=2, ensure_ascii=False, default=str),
            encoding="utf-8",
        )
        print(f"Saved: {filepath.name}")


def save_mcp_card(connector_name: str, card: dict):
    output_dir = _EXTRACTED_DIR / connector_name
    output_dir.mkdir(parents=True, exist_ok=True)

    ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S_%f")
    filepath = output_dir / f"mcp_card_{ts}.json"
    filepath.write_text(
        json.dumps(card, indent=2, ensure_ascii=False, default=str),
        encoding="utf-8",
    )
    print(f"Saved: {filepath.name}")
