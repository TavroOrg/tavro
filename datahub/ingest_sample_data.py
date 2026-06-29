#!/usr/bin/env python3
"""
Ingests Regional Bank Pega Process Catalog into DataHub.

Usage:
    pip install acryl-datahub
    python datahub/ingest_sample_data.py

Or override the GMS URL:
    DATAHUB_GMS_URL=http://localhost:18080 python datahub/ingest_sample_data.py
"""

import csv
import os
import sys
from pathlib import Path

try:
    from datahub.emitter.rest_emitter import DatahubRestEmitter
    from datahub.emitter.mcp_builder import MetadataChangeProposalWrapper
    from datahub.emitter.mce_builder import make_dataset_urn, make_tag_urn, make_domain_urn
    from datahub.metadata.schema_classes import (
        DatasetPropertiesClass,
        GlobalTagsClass,
        TagAssociationClass,
        DomainsClass,
        DomainAssociationClass,
        StatusClass,
    )
except ImportError:
    print("ERROR: acryl-datahub not installed.")
    print("Run: pip install acryl-datahub")
    sys.exit(1)

GMS_URL = os.environ.get("DATAHUB_GMS_URL", "http://localhost:18080")
CSV_PATH = Path(__file__).parent / "process_catalog.csv"
PLATFORM = "pega"
ENV = "PROD"


def emit(emitter, entity_urn, aspect):
    mcp = MetadataChangeProposalWrapper(entityUrn=entity_urn, aspect=aspect)
    emitter.emit_mcp(mcp)


def ingest():
    emitter = DatahubRestEmitter(gms_server=GMS_URL)

    try:
        emitter.test_connection()
        print(f"Connected to DataHub GMS at {GMS_URL}")
    except Exception as e:
        print(f"ERROR: Cannot connect to DataHub at {GMS_URL}")
        print(f"  Make sure DataHub is running: docker compose ps datahub-gms")
        print(f"  Detail: {e}")
        sys.exit(1)

    with open(CSV_PATH, newline="", encoding="utf-8-sig") as f:
        lines = f.read().splitlines()

    # Row 0 is the title, row 1 onwards is headers + data
    reader = csv.DictReader(lines[1:])

    def clean(k):
        return k.replace("\n", " ").strip()

    success = 0
    failed = 0

    for raw_row in reader:
        row = {clean(k): (v or "").strip() for k, v in raw_row.items()}

        process_id = row.get("Process ID", "").strip()
        if not process_id:
            continue

        process_name  = row.get("Process Name", process_id)
        domain        = row.get("Domain", "")
        pega_tool     = row.get("Pega Tool", "")
        status        = row.get("Status", "")
        owner_group   = row.get("Owner Group", "")
        channel       = row.get("Channel", "")
        sla           = row.get("SLA (Days)", "")
        avg_cycle     = row.get("Avg Cycle Time (Days)", "")
        monthly_vol   = row.get("Monthly Volume", "")
        auto_rate     = row.get("Auto Rate (%)", "")
        risk_level    = row.get("Risk Level", "")
        ai_enabled    = row.get("AI Enabled", "")
        steps         = row.get("# Steps", "")
        integrations  = row.get("# Integrations", "")
        reg_flag      = row.get("Regulatory Flag", "")
        last_review   = row.get("Last Review Date", "")
        next_review   = row.get("Next Review Date", "")
        notes         = row.get("Notes", "")

        dataset_urn = make_dataset_urn(
            platform=PLATFORM,
            name=f"process-catalog.{process_id}",
            env=ENV,
        )

        description = (
            f"**{process_name}** ({process_id})\n\n"
            f"- **Domain:** {domain}\n"
            f"- **Tool:** {pega_tool}\n"
            f"- **Status:** {status}\n"
            f"- **Owner:** {owner_group}\n"
            f"- **Channel:** {channel}\n"
            f"- **Risk Level:** {risk_level}\n"
            f"- **AI Enabled:** {ai_enabled}\n"
            f"- **Regulatory Flag:** {reg_flag}\n"
        )
        if notes:
            description += f"\n**Notes:** {notes}"

        custom_props = {k: v for k, v in {
            "process_id":          process_id,
            "domain":              domain,
            "pega_tool":           pega_tool,
            "status":              status,
            "owner_group":         owner_group,
            "channel":             channel,
            "sla_days":            sla,
            "avg_cycle_time_days": avg_cycle,
            "monthly_volume":      monthly_vol,
            "auto_rate_pct":       auto_rate,
            "risk_level":          risk_level,
            "ai_enabled":          ai_enabled,
            "num_steps":           steps,
            "num_integrations":    integrations,
            "regulatory_flag":     reg_flag,
            "last_review_date":    last_review,
            "next_review_date":    next_review,
            "notes":               notes,
        }.items() if v}

        tag_urns = []
        if risk_level:
            tag_urns.append(make_tag_urn(f"risk:{risk_level.lower().replace(' ', '_')}"))
        if ai_enabled.lower() == "yes":
            tag_urns.append(make_tag_urn("ai_enabled"))
        if status:
            tag_urns.append(make_tag_urn(f"status:{status.lower().replace(' ', '_')}"))
        if reg_flag.lower() == "yes":
            tag_urns.append(make_tag_urn("regulatory"))

        try:
            emit(emitter, dataset_urn, DatasetPropertiesClass(
                name=f"{process_id} — {process_name}",
                description=description,
                customProperties=custom_props,
            ))

            if tag_urns:
                emit(emitter, dataset_urn, GlobalTagsClass(
                    tags=[TagAssociationClass(tag=t) for t in tag_urns]
                ))

            if domain:
                domain_urn = make_domain_urn(
                    domain.lower().replace(" ", "_").replace("&", "and")
                )
                emit(emitter, dataset_urn, DomainsClass(
                    domains=[domain_urn]
                ))

            emit(emitter, dataset_urn, StatusClass(removed=False))

            print(f"  ✓ {process_id}: {process_name}")
            success += 1

        except Exception as e:
            print(f"  ✗ {process_id}: {e}")
            failed += 1

    print(f"\nDone. {success} ingested, {failed} failed.")
    print(f"View at: http://localhost:9002")


if __name__ == "__main__":
    ingest()
