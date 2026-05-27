"""
use_case_upload.py — FastAPI router for uploading AI Use Case JSON cards.

POST /api/v1/use-cases/upload
  Accepts one or more .json files via multipart/form-data.
  Supports two JSON formats:

  Format A — AI Use Case Card (external/banking format):
    title, description, business_problem_statement, expected_benefits,
    priority, solution_approach, use_case_owner, number → identifier

  Format B — DB record export format:
    name, description, problem_statement, expected_benefits, priority,
    status, owner, solution_approach, identifier, agent_risk_exposure_are,
    no_of_associated_agents, inherent/residual risk fields, agent_risk_tier_art

  tenant_id is always read from the x-tenant-id request header.
  Returns: { "uploaded_count": N, "total_submitted": N, "message": "..." }
"""

from __future__ import annotations

import json
import os
import re
import uuid
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db

router = APIRouter()

CORE = os.getenv("CORE_GLUE_DB_NAME", "core")

_PRIORITY_MAP: Dict[str, str] = {
    "1": "1 - Critical", "critical": "1 - Critical",
    "2": "2 - High",     "high": "2 - High",
    "3": "3 - Moderate", "moderate": "3 - Moderate", "medium": "3 - Moderate",
    "4": "4 - Low",      "low": "4 - Low",
    "5": "5 - Planning", "planning": "5 - Planning",
    "1 - critical": "1 - Critical",
    "2 - high":     "2 - High",
    "3 - moderate": "3 - Moderate",
    "4 - low":      "4 - Low",
    "5 - planning": "5 - Planning",
}


def _normalize_priority(raw: str) -> str:
    lower = raw.strip().lower()
    if lower in _PRIORITY_MAP:
        return _PRIORITY_MAP[lower]
    m = re.match(r"^\s*0*([1-5])\b", lower)
    if m:
        return _PRIORITY_MAP[m.group(1)]
    return raw.strip()


def _get_tenant(request: Request) -> Optional[str]:
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


def _extract_fields(card: dict) -> dict:
    """
    Extract fields from either JSON format into a unified dict keyed by DB column name.

    Format A (external card): has 'title' and 'business_problem_statement'.
    Format B (DB export): has 'name' and 'problem_statement'.
    """
    is_format_a = "title" in card or "business_problem_statement" in card

    if is_format_a:
        name = card.get("title", "")
        description = card.get("description", "")
        problem_statement = card.get("business_problem_statement", "")
        expected_benefits = card.get("expected_benefits", "")
        priority = str(card.get("priority", ""))
        owner = card.get("use_case_owner") or None
        solution_approach = card.get("solution_approach") or None
        # number maps to identifier; fall back to generating a UUID
        identifier = card.get("number") or None
        status = "New"
        # risk fields not present in external format
        agent_risk_exposure_are = None
        no_of_associated_agents = None
        inherent_risk_classification = None
        residual_risk_classification = None
        inherent_risk_classification_score = None
        residual_risk_classification_score = None
        agent_risk_tier_art = None
    else:
        name = card.get("name", "")
        description = card.get("description", "")
        problem_statement = card.get("problem_statement", "")
        expected_benefits = card.get("expected_benefits", "")
        priority = str(card.get("priority", ""))
        owner = card.get("owner") or None
        solution_approach = card.get("solution_approach") or None
        identifier = card.get("identifier") or None
        status = card.get("status") or "New"
        agent_risk_exposure_are = card.get("agent_risk_exposure_are")
        no_of_associated_agents = card.get("no_of_associated_agents")
        inherent_risk_classification = card.get("inherent_risk_classification")
        residual_risk_classification = card.get("residual_risk_classification")
        inherent_risk_classification_score = card.get("inherent_risk_classification_score")
        residual_risk_classification_score = card.get("residual_risk_classification_score")
        agent_risk_tier_art = card.get("agent_risk_tier_art")

    mandatory = {"name": name, "description": description, "problem_statement": problem_statement,
                 "expected_benefits": expected_benefits, "priority": priority}
    missing = [k for k, v in mandatory.items() if not v]
    if missing:
        raise ValueError(f"Missing mandatory fields: {', '.join(missing)}")

    return {
        "identifier": identifier,
        "name": name,
        "description": description,
        "problem_statement": problem_statement,
        "expected_benefits": expected_benefits,
        "priority": priority,
        "owner": owner or "System Administrator",
        "status": status,
        "solution_approach": solution_approach or "",
        "agent_risk_exposure_are": agent_risk_exposure_are,
        "no_of_associated_agents": no_of_associated_agents,
        "inherent_risk_classification": inherent_risk_classification,
        "residual_risk_classification": residual_risk_classification,
        "inherent_risk_classification_score": inherent_risk_classification_score,
        "residual_risk_classification_score": residual_risk_classification_score,
        "agent_risk_tier_art": agent_risk_tier_art,
    }


@router.post("/upload", summary="Upload AI Use Case JSON Cards")
async def upload_use_cases(
    request: Request,
    files: List[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
):
    """
    Upload one or more AI Use Case JSON files. Each file must have a `.json` extension.
    Supports both the external AI Use Case Card format and the internal DB record format.
    The tenant_id is taken from the x-tenant-id request header.
    """
    tenant_id = _get_tenant(request)

    if not files:
        raise HTTPException(status_code=400, detail="No files provided.")

    non_json = [f.filename for f in files if not (f.filename or "").lower().endswith(".json")]
    if non_json:
        raise HTTPException(
            status_code=400,
            detail=f"Only .json files are accepted. Rejected: {', '.join(non_json)}",
        )

    all_cards: list[dict] = []
    for upload_file in files:
        raw = await upload_file.read()
        try:
            cards = _parse_cards_from_bytes(upload_file.filename or "upload.json", raw)
            all_cards.extend(cards)
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e))

    if not all_cards:
        raise HTTPException(status_code=422, detail="No valid use case cards found in the uploaded files.")

    uploaded_count = 0
    errors: list[str] = []

    for card in all_cards:
        try:
            fields = _extract_fields(card)
        except ValueError as e:
            errors.append(str(e))
            continue

        try:
            priority = _normalize_priority(fields["priority"])
        except Exception as e:
            errors.append(f"Priority normalization failed for '{fields.get('name', '?')}': {e}")
            continue

        use_case_id = fields["identifier"] or str(uuid.uuid4())

        try:
            await db.execute(
                text(f"""
                    INSERT INTO {CORE}.ai_use_cases
                        (tenant_id, ai_use_case_id, name, description, owner,
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
                    "tid": tenant_id,
                    "uid": use_case_id,
                    "name": fields["name"],
                    "desc": fields["description"],
                    "owner": fields["owner"],
                    "problem": fields["problem_statement"],
                    "benefits": fields["expected_benefits"],
                    "priority": priority,
                    "status": fields["status"],
                    "solution": fields["solution_approach"],
                    "are": fields["agent_risk_exposure_are"],
                    "num_agents": fields["no_of_associated_agents"],
                    "inherent_class": fields["inherent_risk_classification"],
                    "residual_class": fields["residual_risk_classification"],
                    "inherent_score": fields["inherent_risk_classification_score"],
                    "residual_score": fields["residual_risk_classification_score"],
                    "art": fields["agent_risk_tier_art"],
                },
            )

            # Insert business processes if present in the card
            raw_processes = card.get("business_process") or card.get("business_processes") or []
            for proc in raw_processes:
                if not isinstance(proc, dict):
                    continue
                proc_id = (proc.get("identifier") or "").strip()
                proc_name = (proc.get("name") or "").strip()
                if not proc_id and not proc_name:
                    continue
                if not proc_id:
                    proc_id = proc_name  # fall back to name as ID if no identifier

                # Ensure the process exists in business_processes (FK parent) before linking
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
                            VALUES
                                (:tid, :pid, :pname, :pdesc, :bcrit,
                                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                        """),
                        {
                            "tid": tenant_id,
                            "pid": proc_id,
                            "pname": proc_name or proc_id,
                            "pdesc": proc.get("description") or None,
                            "bcrit": proc.get("business_criticality") or None,
                        },
                    )

                # Link process to use case if not already linked
                rel_exists = await db.execute(
                    text(f"""
                        SELECT 1 FROM {CORE}.ai_use_case_business_processes
                        WHERE ai_use_case_id = :uid AND business_process_id = :pid
                        LIMIT 1
                    """),
                    {"uid": use_case_id, "pid": proc_id},
                )
                if not rel_exists.first():
                    await db.execute(
                        text(f"""
                            INSERT INTO {CORE}.ai_use_case_business_processes
                                (tenant_id, ai_use_case_id, business_process_id, process_name,
                                 created_ts, updated_ts)
                            VALUES
                                (:tid, :uid, :pid, :pname,
                                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                        """),
                        {"tid": tenant_id, "uid": use_case_id, "pid": proc_id, "pname": proc_name or proc_id},
                    )

            await db.commit()
            uploaded_count += 1
        except Exception as e:
            await db.rollback()
            errors.append(f"DB error for '{fields.get('name', '?')}': {e}")

    if errors:
        print(f"[WARN] {len(errors)} card(s) had issues during upload: {errors[:3]}")

    if uploaded_count == 0 and all_cards:
        raise HTTPException(
            status_code=500,
            detail="All use case cards failed to process. Check server logs for details.",
        )

    return {
        "uploaded_count": uploaded_count,
        "total_submitted": len(all_cards),
        "message": (
            f"{uploaded_count} AI Use Case{'s' if uploaded_count != 1 else ''} "
            f"{'have' if uploaded_count != 1 else 'has'} been uploaded successfully."
        ),
    }
