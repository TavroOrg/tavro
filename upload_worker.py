"""
upload_worker.py — Standalone upload processing module for the worker container.

Imports upsert functions from worker.py and provides process_card_without_risk()
which runs all 20 upsert steps but deliberately skips Step 21 (risk dispatch).
This upload flow does NOT modify tenant mappings; tenant assignment
is managed externally (Zitadel claims or portal admin) and is not
automatically injected into the DB by this script.

Usage (worker container CLI):
    python upload_worker.py path/to/agent1.json path/to/agent2.json

    or with tenant:
    UPLOAD_TENANT_ID=tenant-123 python upload_worker.py *.json
"""

import os
import sys
import json
from datetime import datetime
from pathlib import Path

from worker import (
    init_pool,
    _hash,
    _sq,
    get_current_agent_source_hash,
    upsert_agent,
    upsert_agent_configuration,
    upsert_agent_identification,
    upsert_agent_tools,
    upsert_agent_controls,
    upsert_agent_knowledge_source,
    upsert_agent_llm_models,
    upsert_agent_ai_use_cases,
    upsert_business_processes,
    upsert_business_applications,
    upsert_agent_business_processes,
    upsert_agent_business_applications,
    upsert_agent_guardrail,
    upsert_agent_mcp_server,
    upsert_agent_memory,
    upsert_agent_physical_ai,
    upsert_agent_prompt_template,
    upsert_agent_regulation_or_framework,
    upsert_agent_ai_models,
    upsert_agent_data_sources,
    execute_dml,
    TavroAgentCard,
)

import tempfile


def process_card_without_risk(card_dict: dict, tenant_id: str = None) -> bool:
    """
    Process an uploaded agent card through all 20 upsert steps without triggering
    risk assessment (Step 21 is intentionally omitted).

    Args:
        card_dict: Parsed agent JSON card.
        tenant_id: Tenant to associate with the uploaded agent.

    Returns:
        True if processing succeeded (including no-op for unchanged cards), False on error.
    """
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    try:
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as tmp:
            json.dump(card_dict, tmp)
            tmp_path = tmp.name
        TavroAgentCard.from_json_file(tmp_path)
        os.remove(tmp_path)
        print("[INFO] AgentCard validation successful")
    except Exception as e:
        print(f"[ERROR] TavroAgentCard validation failed: {e}")
        return False

    agent_id = card_dict.get("identification", {}).get("agent_id")
    if not agent_id:
        print("[ERROR] Missing identification.agent_id")
        return False

    print(f"[INFO] Processing agent_id={agent_id} (upload, no risk dispatch) …")

    incoming_source_hash = _hash(card_dict)
    try:
        existing_source_hash = get_current_agent_source_hash(agent_id)
        if existing_source_hash == incoming_source_hash:
            print(f"[INFO] No changes detected for agent_id={agent_id}. Skipping.")
            return True
        print("[INFO] Change detected — proceeding with upserts.")
    except Exception as e:
        print(f"[WARN] source_hash check failed, continuing: {e}")

    try:
        print("[INFO] Step  1/20 - agents")
        agent_internal_id = upsert_agent(card_dict, now_str, incoming_source_hash)
    except Exception as e:
        print(f"[ERROR] upsert_agent failed: {e}")
        return False

    # Tenant assignment is intentionally not performed here. Tenant IDs
    # should come from Zitadel claims or be set via the portal admin UI.

    steps = [
        ("[INFO] Step  2/20 - agent_configurations",            upsert_agent_configuration),
        ("[INFO] Step  3/20 - agent_identifications",           upsert_agent_identification),
        ("[INFO] Step  4/20 - agent_tools",                     upsert_agent_tools),
        ("[INFO] Step  5/20 - agent_controls",                  upsert_agent_controls),
        ("[INFO] Step  6/20 - agent_knowledge_sources",         upsert_agent_knowledge_source),
        ("[INFO] Step  7/20 - agent_llm_models",                upsert_agent_llm_models),
        ("[INFO] Step  8/20 - agent_ai_use_cases",              upsert_agent_ai_use_cases),
        ("[INFO] Step  9/20 - business_processes",              upsert_business_processes),
        ("[INFO] Step 10/20 - business_applications",           upsert_business_applications),
        ("[INFO] Step 11/20 - agent_business_processes",        upsert_agent_business_processes),
        ("[INFO] Step 12/20 - agent_business_applications",     upsert_agent_business_applications),
        ("[INFO] Step 13/20 - agent_guardrails",                upsert_agent_guardrail),
        ("[INFO] Step 14/20 - agent_mcp_servers",               upsert_agent_mcp_server),
        ("[INFO] Step 15/20 - agent_memories",                  upsert_agent_memory),
        ("[INFO] Step 16/20 - agent_physical_ai",               upsert_agent_physical_ai),
        ("[INFO] Step 17/20 - agent_prompt_templates",          upsert_agent_prompt_template),
        ("[INFO] Step 18/20 - agent_regulations_or_frameworks", upsert_agent_regulation_or_framework),
        ("[INFO] Step 19/20 - agent_ai_models",                 upsert_agent_ai_models),
        ("[INFO] Step 20/20 - agent_data_sources",              upsert_agent_data_sources),
    ]

    for label, fn in steps:
        print(label)
        try:
            fn(card_dict, agent_internal_id, now_str)
        except Exception as e:
            print(f"[ERROR] {fn.__name__} failed: {e}")

    # Step 21 (risk dispatch) is intentionally omitted for uploaded agents.
    print(f"[INFO] Done. Risk assessment NOT triggered (upload flow).")
    return True


def _iter_upload_cards(paths):
    for path in paths:
        p = Path(path)
        if not p.exists():
            print(f"[WARN] File not found: {path}")
            continue
        try:
            with p.open("r", encoding="utf-8") as f:
                payload = json.load(f)
        except Exception as e:
            print(f"[ERROR] Failed to parse {p.name}: {e}")
            continue

        if isinstance(payload, list):
            for idx, card in enumerate(payload, start=1):
                if isinstance(card, dict):
                    yield p, idx, card
        elif isinstance(payload, dict):
            yield p, 1, payload
        else:
            print(f"[WARN] Unsupported JSON type in {p.name}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python upload_worker.py <file1.json> [file2.json ...]")
        sys.exit(1)

    # Tenant assignment is not handled by this upload script.
    init_pool()

    processed = 0
    for file_path, idx, card in _iter_upload_cards(sys.argv[1:]):
        print(f"\n[INFO] Processing {file_path.name} (record #{idx})")
        if process_card_without_risk(card):
            processed += 1

    print(f"\n[INFO] Upload complete. Cards processed: {processed}")
