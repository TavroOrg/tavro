#!/usr/bin/env python3
"""
Ingests industry template table/column definitions into DataHub.

Currently loads: Insurance / Guidewire PolicyCenter
CSV columns: Industry, Vendor, Application Name, Coverage Area,
             Schema Name, Table Name, Column Name, Sensitive, Category

Usage:
    pip install acryl-datahub
    python datahub/ingest_industry_templates.py

Or override the GMS URL:
    DATAHUB_GMS_URL=http://localhost:18080 python datahub/ingest_industry_templates.py
"""

import csv
import os
import sys
from collections import defaultdict
from pathlib import Path

try:
    from datahub.emitter.rest_emitter import DatahubRestEmitter
    from datahub.emitter.mcp_builder import MetadataChangeProposalWrapper
    from datahub.emitter.mce_builder import make_dataset_urn, make_tag_urn, make_domain_urn
    from datahub.metadata.schema_classes import (
        ContainerClass,
        ContainerPropertiesClass,
        DatasetPropertiesClass,
        DomainPropertiesClass,
        GlobalTagsClass,
        TagAssociationClass,
        DomainsClass,
        StatusClass,
        SchemaMetadataClass,
        SchemaFieldClass,
        SchemaFieldDataTypeClass,
        StringTypeClass,
        NumberTypeClass,
        BooleanTypeClass,
        OtherSchemaClass,
    )
except ImportError:
    print("ERROR: acryl-datahub not installed.")
    print("Run: pip install acryl-datahub")
    sys.exit(1)

GMS_URL = os.environ.get("DATAHUB_GMS_URL", "http://localhost:18080")
CSV_PATH = Path(__file__).parent / "Industry templates for Blueprint - Guidewire Policy Center.csv"
PLATFORM = "guidewire_policy_center"
ENV = "PROD"


def slug(value: str) -> str:
    return (
        value.lower()
        .replace("&", "and")
        .replace("/", "_")
        .replace("\\", "_")
        .replace(" ", "_")
        .replace(".", "_")
        .strip("_")
    )


def make_container_urn(*parts: str) -> str:
    container_id = ".".join(slug(part) for part in parts if part)
    return f"urn:li:container:{container_id}"


def emit(emitter, entity_urn, aspect):
    mcp = MetadataChangeProposalWrapper(entityUrn=entity_urn, aspect=aspect)
    emitter.emit_mcp(mcp)


def emit_container(emitter, container_urn: str, name: str, parent_urn: str | None = None):
    emit(emitter, container_urn, ContainerPropertiesClass(name=name))
    if parent_urn:
        emit(emitter, container_urn, ContainerClass(container=parent_urn))


def emit_hierarchy(emitter, industry: str, vendor: str, app_name: str, coverage_area: str, schema_name: str) -> str | None:
    """
    Creates:
      Industry domain
        Vendor container
          Application container
            Coverage area container
              Schema container

    Returns the lowest container URN, so the dataset/table can be attached to it.
    """
    parent_urn = None
    hierarchy = [
        ("vendor", vendor),
        ("application", app_name),
        ("coverage", coverage_area),
        ("schema", schema_name),
    ]

    path_parts = [industry]
    for level, name in hierarchy:
        if not name:
            continue
        path_parts.extend([level, name])
        container_urn = make_container_urn(*path_parts)
        emit_container(emitter, container_urn, name, parent_urn)
        parent_urn = container_urn

    return parent_urn


def emit_domain(emitter, industry: str) -> str | None:
    if not industry:
        return None

    domain_urn = make_domain_urn(slug(industry))
    emit(emitter, domain_urn, DomainPropertiesClass(
        name=industry,
        description=f"{industry} industry metadata domain.",
    ))
    return domain_urn


def make_field_type(column_name: str) -> SchemaFieldDataTypeClass:
    name_lower = column_name.lower()
    if any(kw in name_lower for kw in ("date", "time", "expir", "effect", "creat", "updat", "written")):
        return SchemaFieldDataTypeClass(type=StringTypeClass())
    if any(kw in name_lower for kw in ("amount", "limit", "premium", "cost", "rate", "percent", "pct",
                                        "volume", "count", "number", "num", "factor", "mod", "credit",
                                        "debit", "payroll", "price", "value", "tiv", "sir")):
        return SchemaFieldDataTypeClass(type=NumberTypeClass())
    if any(kw in name_lower for kw in ("locked", "retired", "approved", "included", "billed",
                                        "overridden", "applied", "justified", "followform",
                                        "coveredpropertyexists", "blanketexists", "sprinklered",
                                        "cdlrequired", "antitheft", "confidential")):
        return SchemaFieldDataTypeClass(type=BooleanTypeClass())
    return SchemaFieldDataTypeClass(type=StringTypeClass())


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
        reader = csv.DictReader(f)
        rows = [
            {k.strip(): (v or "").strip() for k, v in row.items()}
            for row in reader
        ]

    # Group columns by the business hierarchy + physical table.
    tables: dict[tuple[str, str, str, str, str, str], dict] = {}
    table_columns: dict[tuple[str, str, str, str, str, str], list] = defaultdict(list)

    for row in rows:
        industry = row.get("Industry", "")
        vendor = row.get("Vendor", "")
        app_name = row.get("Application Name", "")
        coverage_area = row.get("Coverage Area", "")
        schema_name = row.get("Schema Name", "")
        table_name = row.get("Table Name", "")
        key = (industry, vendor, app_name, coverage_area, schema_name, table_name)

        if key not in tables:
            tables[key] = {
                "industry":      industry,
                "vendor":        vendor,
                "app_name":      app_name,
                "coverage_area": coverage_area,
                "category":      row.get("Category", ""),
            }

        col_name = row.get("Column Name", "")
        sensitive = row.get("Sensitive", "FALSE").upper() == "TRUE"
        if col_name:
            table_columns[key].append({"name": col_name, "sensitive": sensitive})

    success = 0
    failed = 0

    for (_, _, _, _, schema_name, table_name), meta in tables.items():
        if not table_name:
            continue

        dataset_name = f"{schema_name}.{table_name}" if schema_name else table_name
        dataset_urn = make_dataset_urn(platform=PLATFORM, name=dataset_name, env=ENV)

        industry = meta["industry"]
        vendor = meta["vendor"]
        app_name = meta["app_name"]
        coverage_area = meta["coverage_area"]
        category = meta["category"]

        description = (
            f"**{table_name}** — {app_name}\n\n"
            f"- **Industry:** {industry}\n"
            f"- **Vendor:** {vendor}\n"
            f"- **Coverage Area:** {coverage_area}\n"
            f"- **Schema:** {schema_name}\n"
            f"- **Category:** {category}\n"
        )

        custom_props = {k: v for k, v in {
            "industry":      industry,
            "vendor":        vendor,
            "app_name":      app_name,
            "coverage_area": coverage_area,
            "schema_name":   schema_name,
            "category":      category,
            "template_type": "industry_template",
        }.items() if v}

        # Build schema fields
        columns = table_columns[(schema_name, table_name)]
        fields = []
        for col in columns:
            col_name = col["name"]
            sensitive = col["sensitive"]
            field_tags = None
            if sensitive:
                field_tags = GlobalTagsClass(
                    tags=[TagAssociationClass(tag=make_tag_urn("sensitive"))]
                )
            fields.append(SchemaFieldClass(
                fieldPath=col_name,
                type=make_field_type(col_name),
                nativeDataType="VARCHAR",
                description=None,
                globalTags=field_tags,
            ))

        # Dataset-level tags
        tag_urns = [
            make_tag_urn("industry_template"),
            make_tag_urn(f"industry:{industry.lower()}"),
            make_tag_urn(f"vendor:{vendor.lower().replace(' ', '_')}"),
        ]
        if coverage_area:
            tag_urns.append(make_tag_urn(
                f"coverage:{coverage_area.lower().replace(' ', '_').replace('/', '_')}"
            ))
        if any(c["sensitive"] for c in columns):
            tag_urns.append(make_tag_urn("contains_sensitive_data"))

        try:
            domain_urn = emit_domain(emitter, industry)
            schema_container_urn = emit_hierarchy(
                emitter=emitter,
                industry=industry,
                vendor=vendor,
                app_name=app_name,
                coverage_area=coverage_area,
                schema_name=schema_name,
            )

            emit(emitter, dataset_urn, DatasetPropertiesClass(
                name=dataset_name,
                description=description,
                customProperties=custom_props,
            ))

            if schema_container_urn:
                emit(emitter, dataset_urn, ContainerClass(container=schema_container_urn))

            if fields:
                emit(emitter, dataset_urn, SchemaMetadataClass(
                    schemaName=dataset_name,
                    platform=f"urn:li:dataPlatform:{PLATFORM}",
                    version=0,
                    hash="",
                    platformSchema=OtherSchemaClass(rawSchema=""),
                    fields=fields,
                ))

            emit(emitter, dataset_urn, GlobalTagsClass(
                tags=[TagAssociationClass(tag=t) for t in tag_urns]
            ))

            if domain_urn:
                emit(emitter, dataset_urn, DomainsClass(domains=[domain_urn]))

            emit(emitter, dataset_urn, StatusClass(removed=False))

            print(f"  ✓ {dataset_name} ({len(fields)} columns, coverage: {coverage_area})")
            success += 1

        except Exception as e:
            print(f"  ✗ {dataset_name}: {e}")
            failed += 1

    print(f"\nDone. {success} tables ingested, {failed} failed.")
    print(f"View at: http://localhost:9002")


if __name__ == "__main__":
    ingest()
