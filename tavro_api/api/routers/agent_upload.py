"""
agent_upload.py — FastAPI router for uploading agent JSON cards.

POST /api/v1/agents/upload
  - Accepts one or more .json files via multipart/form-data
  - Validates that each file has a .json extension
  - Parses JSON content (supports single object or array of objects per file)
  - Processes each card through the full 20-step upsert pipeline WITHOUT
    triggering risk assessment (Step 21 is intentionally skipped)
  - Returns: { "uploaded_count": N, "message": "..." }
"""

from __future__ import annotations

import asyncio
import copy
import json
import os
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import List

from fastapi import APIRouter, Request, UploadFile, File, HTTPException, Query
from typing import Optional

router = APIRouter()

# Thread pool for running the synchronous psycopg2 processing without
# blocking the async event loop.
_upload_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="agent-upload")


def _get_tenant(request: Request):
    val = request.headers.get("x-tenant-id", "")
    return val.strip() or None


def _require_tenant(request: Request) -> str:
    tenant_id = _get_tenant(request)
    if not tenant_id:
        raise HTTPException(status_code=400, detail="Missing tenant context.")
    return tenant_id


def _parse_cards_from_bytes(filename: str, content: bytes) -> list[dict]:
    """Parse JSON bytes into a list of card dicts. Supports single object or array."""
    try:
        payload = json.loads(content)
    except json.JSONDecodeError as e:
        raise ValueError(f"Invalid JSON in '{filename}': {e}")

    if isinstance(payload, dict):
        return [payload]
    if isinstance(payload, list):
        cards = []
        for i, item in enumerate(payload):
            if isinstance(item, dict):
                cards.append(item)
            else:
                print(f"[WARN] Skipping non-object item at index {i} in '{filename}'")
        return cards

    raise ValueError(f"Unsupported JSON structure in '{filename}': expected object or array")


_RISK_FIELDS = {"risk_assessment", "latest_risk_score", "latest_risk_class", "risk_summary"}


def _strip_risk_fields(card: dict) -> dict:
    """Return a deep copy of the card with risk assessment values nulled out.

    risk_assessment keeps its nested structure with all inner keys set to null.
    Scalar risk fields (latest_risk_score, etc.) are set to null directly.
    """
    clean = copy.deepcopy(card)
    for key in _RISK_FIELDS:
        if key not in clean:
            continue
        val = clean[key]
        if isinstance(val, dict):
            clean[key] = {k: None for k in val}
        else:
            clean[key] = None
    return clean


def _save_card_to_disk(card: dict) -> None:
    """Save the agent card JSON to LOCAL_AGENT_CARD_DIR as {agent_id}_agent_card.json."""
    agent_id = (card.get("identification") or {}).get("agent_id", "").strip()
    if not agent_id:
        print("[WARN] _save_card_to_disk: card has no agent_id, skipping file save")
        return

    card_dir = Path(os.getenv("LOCAL_AGENT_CARD_DIR", "./agent_cards"))
    card_dir.mkdir(parents=True, exist_ok=True)

    file_path = card_dir / f"{agent_id}_agent_card.json"
    with file_path.open("w", encoding="utf-8") as f:
        json.dump(card, f, indent=2, default=str)

    print(f"[INFO] Saved agent card to disk: {file_path}")


def _process_card_sync(card_dict: dict, tenant_id: str | None, company_id: str | None = None, company_name: str | None = None) -> dict:
    """Synchronous wrapper called in the thread executor.

    Returns a result dict: {success, validation_error, error}
      - success=True  → card was accepted and written to DB
      - validation_error=True → card failed TavroAgentCard schema check
      - error → human-readable message when success=False
    """
    try:
        from services.upload_processor import process_card_for_upload
        original = copy.deepcopy(card_dict)
        process_card_for_upload(card_dict, tenant_id, company_id=company_id, company_name=company_name)
        _save_card_to_disk(_strip_risk_fields(original))
        return {"success": True, "validation_error": False, "error": None}
    except ValueError as e:
        return {"success": False, "validation_error": True, "error": str(e)}
    except ImportError as e:
        raise RuntimeError(
            f"upload_processor module not available (check services/ volume mount): {e}"
        )
    except Exception as e:
        return {"success": False, "validation_error": False, "error": str(e)}


@router.post("/upload", summary="Upload Agent JSON Cards")
async def upload_agents(
    request: Request,
    files: List[UploadFile] = File(...),
    company_id: Optional[str] = Query(default=None, description="Filter uploaded agents to this company UUID"),
    company_name: Optional[str] = Query(default=None, description="Company name to store with uploaded agents"),
):
    """
    Upload one or more agent JSON files. Each file must have a `.json` extension.

    Each file may contain a single agent card (JSON object) or a batch of cards
    (JSON array of objects). All cards are processed through the same 20-step
    upsert pipeline used for sample data, without triggering risk assessment.

    Returns the count of successfully uploaded agents and a prompt to complete
    risk assessments.
    """
    tenant_id = _require_tenant(request)

    if not files:
        raise HTTPException(status_code=400, detail="No files provided.")

    # --- Validate file extensions ---
    non_json = [f.filename for f in files if not (f.filename or "").lower().endswith(".json")]
    if non_json:
        raise HTTPException(
            status_code=400,
            detail=f"Only .json files are accepted. Rejected: {', '.join(non_json)}",
        )

    # --- Read and parse all files, keeping filename attribution per card ---
    all_cards: list[tuple[dict, str]] = []   # (card_dict, source_filename)
    for upload_file in files:
        filename = upload_file.filename or "upload.json"
        raw = await upload_file.read()
        try:
            cards = _parse_cards_from_bytes(filename, raw)
            for card in cards:
                all_cards.append((card, filename))
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e))

    if not all_cards:
        raise HTTPException(status_code=422, detail="No valid agent cards found in the uploaded files.")

    # --- Process cards concurrently in thread pool (sync psycopg2 calls) ---
    loop = asyncio.get_event_loop()

    cid = company_id.strip() if company_id and company_id.strip() else None
    cname = company_name.strip() if company_name and company_name.strip() else None

    async def _process_one(card: dict, filename: str) -> dict:
        res = await loop.run_in_executor(
            _upload_executor,
            _process_card_sync,
            card,
            tenant_id,
            cid,
            cname,
        )
        return {**res, "filename": filename}

    results = await asyncio.gather(
        *[_process_one(c, fn) for c, fn in all_cards],
        return_exceptions=True,
    )

    # --- Aggregate results by filename ---
    file_map: dict[str, dict] = defaultdict(lambda: {"valid_count": 0, "invalid_count": 0, "errors": []})
    uploaded_count = 0
    hard_errors: list[str] = []

    for r in results:
        if isinstance(r, Exception):
            hard_errors.append(str(r))
            continue
        fn = r["filename"]
        if r["success"]:
            file_map[fn]["valid_count"] += 1
            uploaded_count += 1
        else:
            file_map[fn]["invalid_count"] += 1
            if r.get("error"):
                file_map[fn]["errors"].append(r["error"])

    if hard_errors:
        print(f"[WARN] {len(hard_errors)} card(s) raised hard exceptions: {hard_errors[:3]}")

    # Preserve input order so the UI lists files in the same order the user selected
    seen: set[str] = set()
    file_results: list[dict] = []
    for _, fn in all_cards:
        if fn not in seen:
            seen.add(fn)
            entry = file_map.get(fn, {"valid_count": 0, "invalid_count": 0, "errors": []})
            file_results.append({"filename": fn, **entry})

    if uploaded_count == 0 and all_cards:
        raise HTTPException(
            status_code=500,
            detail="All agent cards failed to process. Check server logs for details.",
        )

    total = len(all_cards)
    return {
        "uploaded_count": uploaded_count,
        "total_submitted": total,
        "file_results": file_results,
        "message": (
            f"{uploaded_count} out of {total} agent card{'s' if total != 1 else ''} "
            f"uploaded successfully."
            if uploaded_count < total
            else (
                f"{uploaded_count} agent card{'s' if uploaded_count != 1 else ''} "
                f"uploaded successfully. Complete risk assessments to activate."
            )
        ),
    }
