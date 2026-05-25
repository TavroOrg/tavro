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
import json
from concurrent.futures import ThreadPoolExecutor
from typing import List

from fastapi import APIRouter, Request, UploadFile, File, HTTPException

router = APIRouter()

# Thread pool for running the synchronous psycopg2 processing without
# blocking the async event loop.
_upload_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="agent-upload")


def _get_tenant(request: Request):
    val = request.headers.get("x-tenant-id", "")
    return val.strip() or None


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


def _process_card_sync(card_dict: dict, tenant_id: str | None) -> bool:
    """Synchronous wrapper called in the thread executor."""
    try:
        from services.upload_processor import process_card_for_upload
        return process_card_for_upload(card_dict, tenant_id)
    except ImportError as e:
        raise RuntimeError(
            f"upload_processor module not available (check services/ volume mount): {e}"
        )


@router.post("/upload", summary="Upload Agent JSON Cards")
async def upload_agents(
    request: Request,
    files: List[UploadFile] = File(...),
):
    """
    Upload one or more agent JSON files. Each file must have a `.json` extension.

    Each file may contain a single agent card (JSON object) or a batch of cards
    (JSON array of objects). All cards are processed through the same 20-step
    upsert pipeline used for sample data, without triggering risk assessment.

    Returns the count of successfully uploaded agents and a prompt to complete
    risk assessments.
    """
    tenant_id = _get_tenant(request)

    if not files:
        raise HTTPException(status_code=400, detail="No files provided.")

    # --- Validate file extensions ---
    non_json = [f.filename for f in files if not (f.filename or "").lower().endswith(".json")]
    if non_json:
        raise HTTPException(
            status_code=400,
            detail=f"Only .json files are accepted. Rejected: {', '.join(non_json)}",
        )

    # --- Read and parse all files ---
    all_cards: list[dict] = []
    for upload_file in files:
        raw = await upload_file.read()
        try:
            cards = _parse_cards_from_bytes(upload_file.filename or "upload.json", raw)
            all_cards.extend(cards)
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e))

    if not all_cards:
        raise HTTPException(status_code=422, detail="No valid agent cards found in the uploaded files.")

    # --- Process cards concurrently in thread pool (sync psycopg2 calls) ---
    loop = asyncio.get_event_loop()

    async def _process_one(card: dict) -> bool:
        return await loop.run_in_executor(
            _upload_executor,
            _process_card_sync,
            card,
            tenant_id,
        )

    results = await asyncio.gather(*[_process_one(c) for c in all_cards], return_exceptions=True)

    uploaded_count = sum(
        1 for r in results if r is True
    )

    errors = [str(r) for r in results if isinstance(r, Exception)]
    if errors:
        print(f"[WARN] {len(errors)} card(s) raised exceptions during upload: {errors[:3]}")

    if uploaded_count == 0 and all_cards:
        raise HTTPException(
            status_code=500,
            detail="All agent cards failed to process. Check server logs for details.",
        )

    return {
        "uploaded_count": uploaded_count,
        "total_submitted": len(all_cards),
        "message": (
            f"{uploaded_count} agent{'s' if uploaded_count != 1 else ''} "
            f"{'have' if uploaded_count != 1 else 'has'} been uploaded, complete risk assessments."
        ),
    }
