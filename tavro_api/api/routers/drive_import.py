"""
drive_import.py — FastAPI router for importing JSON files from a public Google Drive folder.

POST /api/v1/drive/import
  - Accepts a Google Drive folder URL (folder must be shared "Anyone with the link → Viewer")
  - No API key required — uses public folder HTML + direct download URLs
  - Tries embeddedfolderview (static HTML) first, falls back to regular folder page
  - Extracts .json file IDs, downloads each one
  - Auto-detects card type: agent cards (have identification.agent_id) vs AI use case cards
  - Routes each card through the same pipeline as the manual upload endpoints
  - Returns: { total_files, agents_imported, use_cases_imported, errors, message }
"""

from __future__ import annotations

import asyncio
import os
import re
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db
from api.routers.agent_upload import _save_card_to_disk as _save_agent_card, _strip_risk_fields
from api.routers.use_case_upload import _extract_fields, _normalize_priority

router = APIRouter()

CORE = os.getenv("CORE_DB_NAME", "core")

_drive_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="drive-import")

_BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Cache-Control": "no-cache",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_folder_id(url: str) -> Optional[str]:
    """Parse folder ID from common Google Drive URL formats."""
    m = re.search(r"/folders/([a-zA-Z0-9_-]+)", url)
    if m:
        return m.group(1)
    m = re.search(r"[?&]id=([a-zA-Z0-9_-]+)", url)
    if m:
        return m.group(1)
    return None


def _extract_json_files_from_html(html: str) -> list[dict]:
    """
    Extract file IDs (and names where available) from a Google Drive HTML page.

    Tries multiple patterns to handle both the embeddedfolderview format and the
    regular folder page (which embeds metadata in AF_initDataCallback script blobs).
    """
    files: list[dict] = []
    seen_ids: set[str] = set()

    def _add(fid: str, fname: Optional[str] = None) -> None:
        if fid in seen_ids:
            if fname:
                for f in files:
                    if f["id"] == fid and not f["name"]:
                        f["name"] = fname
                        break
            return
        seen_ids.add(fid)
        files.append({"id": fid, "name": fname})

    # Pattern 1 — data-id attributes (embeddedfolderview / newer Drive UI)
    for m in re.finditer(r'data-id="([a-zA-Z0-9_-]{25,50})"', html):
        _add(m.group(1))

    # Pattern 2 — /file/d/{id} href links
    for m in re.finditer(r'/file/d/([a-zA-Z0-9_-]{25,50})', html):
        _add(m.group(1))

    # Pattern 3 — ?id= or &id= query params
    for m in re.finditer(r'[?&]id=([a-zA-Z0-9_-]{25,50})(?:[^a-zA-Z0-9_-]|$)', html):
        _add(m.group(1))

    # Pattern 4 — AF_initDataCallback: "FILE_ID",null,[["FILENAME.json"
    # This is the typical structure Google uses in its embedded data blobs
    for m in re.finditer(
        r'"([a-zA-Z0-9_-]{25,50})",\s*null,\s*\[\s*\["([^"\\]*?\.json)"',
        html,
    ):
        _add(m.group(1), m.group(2))

    # Pattern 5 — file ID then .json name (up to 1000 non-quote chars between)
    for m in re.finditer(r'"([a-zA-Z0-9_-]{25,50})"[^"]{0,1000}"([^"\\]*?\.json)"', html):
        _add(m.group(1), m.group(2))

    # Pattern 6 — .json name then file ID (reverse, same window)
    for m in re.finditer(r'"([^"\\]*?\.json)"[^"]{0,1000}"([a-zA-Z0-9_-]{25,50})"', html):
        _add(m.group(2), m.group(1))

    return files


async def _download_public_file(client: httpx.AsyncClient, file_id: str) -> bytes:
    """
    Download a file from Google Drive using the public export URL.
    Handles the virus-scan confirmation page for files Google hasn't scanned.
    """
    url = f"https://drive.google.com/uc?export=download&id={file_id}"
    resp = await client.get(url, headers=_BROWSER_HEADERS, follow_redirects=True)

    content_type = resp.headers.get("content-type", "")

    # Google shows an HTML confirmation page for larger / unscanned files
    if "text/html" in content_type and resp.status_code == 200:
        token_match = re.search(r'confirm=([0-9a-zA-Z_\-]+)', resp.text)
        uuid_match = re.search(r'uuid=([0-9a-zA-Z_\-]+)', resp.text)
        if token_match:
            confirm = token_match.group(1)
            uuid_val = uuid_match.group(1) if uuid_match else ""
            confirm_url = (
                f"https://drive.usercontent.google.com/download"
                f"?id={file_id}&export=download&confirm={confirm}&uuid={uuid_val}"
            )
            resp = await client.get(confirm_url, headers=_BROWSER_HEADERS, follow_redirects=True)
        else:
            raise ValueError("Received HTML page — file may not be publicly downloadable")

    if resp.status_code != 200:
        raise ValueError(f"HTTP {resp.status_code}")

    return resp.content


def _is_agent_card(card: dict) -> bool:
    ident = card.get("identification")
    return isinstance(ident, dict) and bool(ident.get("agent_id"))


def _process_agent_sync(card: dict, tenant_id: Optional[str]) -> bool:
    try:
        import copy as _copy
        from services.upload_processor import process_card_for_upload
        original = _copy.deepcopy(card)
        success = process_card_for_upload(card, tenant_id)
        if success:
            _save_agent_card(_strip_risk_fields(original))
        return success
    except Exception as exc:
        print(f"[WARN] drive_import: agent processing failed: {exc}")
        return False


# ---------------------------------------------------------------------------
# Request model
# ---------------------------------------------------------------------------

class DriveImportRequest(BaseModel):
    folder_url: str


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.post("/import", summary="Import JSON files from a public Google Drive folder")
async def import_from_drive(
    body: DriveImportRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    folder_id = _extract_folder_id(body.folder_url)
    if not folder_id:
        raise HTTPException(
            status_code=400,
            detail="Could not parse a folder ID from the provided URL. Use a link like https://drive.google.com/drive/folders/…",
        )

    tenant_id = request.headers.get("x-tenant-id", "").strip() or None

    # ── 1. Fetch folder HTML to get file IDs ──────────────────────────────────
    #
    # Strategy A: embeddedfolderview — designed for iframe embedding, returns
    #             static HTML (no JS rendering needed), easier to scrape.
    # Strategy B: regular folder page — fallback, has AF_initDataCallback blobs.
    #
    folder_page_url = f"https://drive.google.com/drive/folders/{folder_id}"
    embed_url = f"https://drive.google.com/embeddedfolderview?id={folder_id}"

    all_file_entries: list[dict] = []
    folder_status: int = 0

    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        # Always check the regular folder URL for access / existence
        folder_resp = await client.get(folder_page_url, headers=_BROWSER_HEADERS)
        folder_status = folder_resp.status_code

        if folder_status == 404:
            raise HTTPException(status_code=404, detail="Folder not found. Check the URL.")
        if folder_status in (401, 403):
            raise HTTPException(
                status_code=400,
                detail="Access denied. Make sure the folder is shared as 'Anyone with the link → Viewer'.",
            )
        if folder_status != 200:
            raise HTTPException(
                status_code=502,
                detail=f"Could not reach the Drive folder (HTTP {folder_status}).",
            )

        # Strategy A: embeddedfolderview
        try:
            embed_resp = await client.get(embed_url, headers=_BROWSER_HEADERS)
            if embed_resp.status_code == 200:
                all_file_entries = _extract_json_files_from_html(embed_resp.text)
                print(f"[INFO] drive_import: embeddedfolderview → {len(all_file_entries)} entries")
        except Exception as exc:
            print(f"[WARN] drive_import: embeddedfolderview fetch failed: {exc}")

        # Strategy B: regular folder page (fallback)
        if not all_file_entries:
            all_file_entries = _extract_json_files_from_html(folder_resp.text)
            print(f"[INFO] drive_import: folder page → {len(all_file_entries)} entries")

            if not all_file_entries:
                print(
                    f"[WARN] drive_import: no file IDs found. "
                    f"HTML len={len(folder_resp.text)}, "
                    f"has AF_initDataCallback={'AF_initDataCallback' in folder_resp.text}, "
                    f"has /file/d/={'/file/d/' in folder_resp.text}, "
                    f"has data-id={'data-id=' in folder_resp.text}"
                )

    # Entries with a known .json name, OR entries whose type we don't know yet
    json_entries = [
        f for f in all_file_entries
        if f["name"] is None or f["name"].lower().endswith(".json")
    ]

    if not json_entries:
        raise HTTPException(
            status_code=404,
            detail=(
                "No .json files found in this folder. "
                "Make sure the folder contains JSON files and is shared as "
                "'Anyone with the link → Viewer'."
            ),
        )

    # ── 2. Download and classify each file ────────────────────────────────────
    agent_cards: List[dict] = []
    use_case_cards: List[dict] = []
    download_errors: List[str] = []

    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        for entry in json_entries:
            fname = entry.get("name") or entry["id"]
            try:
                raw = await _download_public_file(client, entry["id"])
            except Exception as exc:
                download_errors.append(f"Could not download '{fname}': {exc}")
                continue

            try:
                import json as _json
                payload = _json.loads(raw)
            except Exception:
                download_errors.append(f"Invalid JSON in '{fname}'")
                continue

            if isinstance(payload, dict):
                cards = [payload]
            elif isinstance(payload, list):
                cards = [c for c in payload if isinstance(c, dict)]
            else:
                download_errors.append(f"Unsupported JSON structure in '{fname}'")
                continue

            for card in cards:
                if _is_agent_card(card):
                    agent_cards.append(card)
                else:
                    use_case_cards.append(card)

    # ── 3. Process agent cards (sync psycopg2 in thread pool) ─────────────────
    loop = asyncio.get_event_loop()
    agents_imported = 0
    agent_errors: List[str] = []

    for card in agent_cards:
        try:
            ok = await loop.run_in_executor(_drive_executor, _process_agent_sync, card, tenant_id)
            if ok:
                agents_imported += 1
            else:
                agent_id = (card.get("identification") or {}).get("agent_id", "?")
                agent_errors.append(f"Agent '{agent_id}' failed — check server logs.")
        except Exception as exc:
            agent_errors.append(str(exc))

    # ── 4. Process use case cards (async SQLAlchemy) ───────────────────────────
    use_cases_imported = 0
    uc_errors: List[str] = []

    for card in use_case_cards:
        try:
            fields = _extract_fields(card)
        except ValueError as exc:
            uc_errors.append(str(exc))
            continue

        priority = _normalize_priority(fields["priority"])
        use_case_id = fields["identifier"] or str(uuid.uuid4())

        try:
            await db.execute(
                text(f"""
                    INSERT INTO {CORE}.agent_ai_use_cases
                        (tenant_id, identifier, name, description, owner,
                         problem_statement, expected_benefits, priority, status,
                         solution_approach, agent_risk_exposure_are, no_of_associated_agents,
                         inherent_risk_classification, residual_risk_classification,
                         inherent_risk_classification_score, residual_risk_classification_score,
                         agent_risk_tier_art, created_ts, updated_ts, agent_internal_id)
                    VALUES
                        (:tid, :uid, :name, :desc, :owner,
                         :problem, :benefits, :priority, :status,
                         :solution, :are, :num_agents,
                         :inherent_class, :residual_class,
                         :inherent_score, :residual_score,
                         :art, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL)
                """),
                {
                    "tid": tenant_id, "uid": use_case_id,
                    "name": fields["name"], "desc": fields["description"],
                    "owner": fields["owner"], "problem": fields["problem_statement"],
                    "benefits": fields["expected_benefits"], "priority": priority,
                    "status": fields["status"], "solution": fields["solution_approach"],
                    "are": fields["agent_risk_exposure_are"],
                    "num_agents": fields["no_of_associated_agents"],
                    "inherent_class": fields["inherent_risk_classification"],
                    "residual_class": fields["residual_risk_classification"],
                    "inherent_score": fields["inherent_risk_classification_score"],
                    "residual_score": fields["residual_risk_classification_score"],
                    "art": fields["agent_risk_tier_art"],
                },
            )

            for proc in (card.get("business_process") or card.get("business_processes") or []):
                if not isinstance(proc, dict):
                    continue
                proc_id = (proc.get("identifier") or "").strip()
                proc_name = (proc.get("name") or "").strip()
                if not proc_id and not proc_name:
                    continue
                proc_id = proc_id or proc_name

                bp_exists = await db.execute(
                    text(f"SELECT 1 FROM {CORE}.business_processes WHERE business_process_id = :pid LIMIT 1"),
                    {"pid": proc_id},
                )
                if not bp_exists.first():
                    await db.execute(
                        text(f"""
                            INSERT INTO {CORE}.business_processes
                                (tenant_id, business_process_id, process_name, process_description,
                                 business_criticality, created_ts, updated_ts)
                            VALUES (:tid, :pid, :pname, :pdesc, :bcrit, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                        """),
                        {
                            "tid": tenant_id, "pid": proc_id,
                            "pname": proc_name or proc_id,
                            "pdesc": proc.get("description") or None,
                            "bcrit": proc.get("business_criticality") or None,
                        },
                    )

                rel_exists = await db.execute(
                    text(f"""
                        SELECT 1 FROM {CORE}.ai_use_case_business_processes
                        WHERE ai_use_case_id = :uid AND business_process_id = :pid LIMIT 1
                    """),
                    {"uid": use_case_id, "pid": proc_id},
                )
                if not rel_exists.first():
                    await db.execute(
                        text(f"""
                            INSERT INTO {CORE}.ai_use_case_business_processes
                                (tenant_id, ai_use_case_id, business_process_id, process_name,
                                 created_ts, updated_ts)
                            VALUES (:tid, :uid, :pid, :pname, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                        """),
                        {"tid": tenant_id, "uid": use_case_id, "pid": proc_id, "pname": proc_name or proc_id},
                    )

            await db.commit()
            use_cases_imported += 1

        except Exception as exc:
            await db.rollback()
            uc_errors.append(f"Use case '{fields.get('name', '?')}': {exc}")

    # ── 5. Build response ──────────────────────────────────────────────────────
    all_errors = download_errors + agent_errors + uc_errors
    if all_errors:
        print(f"[WARN] drive_import: {len(all_errors)} error(s): {all_errors[:3]}")

    total_imported = agents_imported + use_cases_imported
    if total_imported == 0 and (agent_cards or use_case_cards):
        raise HTTPException(
            status_code=500,
            detail=f"All {len(agent_cards) + len(use_case_cards)} card(s) failed to process. Check server logs.",
        )

    parts = []
    if agents_imported:
        parts.append(f"{agents_imported} agent{'s' if agents_imported != 1 else ''}")
    if use_cases_imported:
        parts.append(f"{use_cases_imported} use case{'s' if use_cases_imported != 1 else ''}")

    return {
        "total_files": len(json_entries),
        "agents_imported": agents_imported,
        "use_cases_imported": use_cases_imported,
        "errors": all_errors,
        "message": (
            f"Imported {' and '.join(parts)} from {len(json_entries)} file(s)."
            if parts else "No records were imported."
        ),
    }
