"""
DataHub catalog integration endpoint.

POST /api/v1/admin/integrations/datahub-catalog/run
  Three-step pipeline, same as clicking "Run" on any other connector:
    1. Extract  — log into DataHub's GraphQL API (session-cookie auth) and
                   page through the full dataset catalog.
    2. Store    — overwrite datahub/datahub.json with the result.
    3. Embed    — re-run datahub/ingest_datahub_vectors.py's ingest() against
                   that same file to (re)embed every dataset into
                   twin.datahub_context (global scope), so it's searchable
                   via pgvector immediately, without waiting for the
                   datahub-vector-ingest startup job.

Shares the same .env-backed credentials (DATAHUB_URL / DATAHUB_USERNAME /
DATAHUB_PASSWORD) as the DataHub connector card in Connectors → Data Catalog
Platforms.
"""
from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException

from api.dependencies.auth import require_portal_admin

router = APIRouter()

CATALOG_FILE = Path(os.getenv("DATAHUB_CATALOG_FILE", "/app/datahub/datahub.json"))
PAGE_SIZE = 100
DEFAULT_QUERY = "*"
DEFAULT_TYPE = "DATASET"

_SEARCH_GQL = """
query CatalogSearch($input: SearchInput!) {
  search(input: $input) {
    total
    searchResults {
      entity {
        urn
        type
        ... on Dataset {
          name
          properties {
            description
            customProperties {
              key
              value
            }
          }
          schemaMetadata {
            fields {
              fieldPath
              nativeDataType
            }
          }
          editableSchemaMetadata {
            editableSchemaFieldInfo {
              fieldPath
              globalTags {
                tags {
                  tag {
                    name
                  }
                }
              }
            }
          }
          tags {
            tags {
              tag {
                name
              }
            }
          }
        }
      }
    }
  }
}
"""


def _datahub_credentials() -> tuple[str, str, str]:
    url      = os.getenv("DATAHUB_URL",      "").strip().rstrip("/")
    username = os.getenv("DATAHUB_USERNAME", "").strip()
    password = os.getenv("DATAHUB_PASSWORD", "").strip()
    if not url or not username or not password:
        raise HTTPException(
            status_code=400,
            detail="DataHub credentials not configured. Set them in the Connectors → DataHub section first.",
        )
    return url, username, password


def _login(client: httpx.Client, url: str, username: str, password: str) -> None:
    resp = client.post(f"{url}/logIn", json={"username": username, "password": password}, timeout=30)
    if resp.status_code != 200 or not client.cookies:
        raise HTTPException(status_code=502, detail=f"DataHub login failed (HTTP {resp.status_code}): {resp.text[:300]}")


def _search_page(client: httpx.Client, url: str, start: int, count: int) -> dict:
    resp = client.post(
        f"{url}/api/graphql",
        json={
            "query": _SEARCH_GQL,
            "variables": {"input": {"type": DEFAULT_TYPE, "query": DEFAULT_QUERY, "start": start, "count": count}},
        },
        timeout=60,
    )
    resp.raise_for_status()
    payload = resp.json()
    if payload.get("errors"):
        raise HTTPException(status_code=502, detail=f"DataHub GraphQL errors: {payload['errors']}")
    return payload["data"]["search"]


def _transform(entity: dict) -> dict:
    properties = entity.get("properties") or {}
    custom_properties = {
        cp["key"]: cp["value"]
        for cp in (properties.get("customProperties") or [])
        if cp.get("key") is not None
    }

    field_tags: dict[str, list[str]] = {}
    editable_schema = entity.get("editableSchemaMetadata") or {}
    for field_info in editable_schema.get("editableSchemaFieldInfo") or []:
        tag_names = [
            t["tag"]["name"]
            for t in (field_info.get("globalTags") or {}).get("tags") or []
            if t.get("tag", {}).get("name")
        ]
        if tag_names:
            field_tags[field_info["fieldPath"]] = tag_names

    schema_metadata = entity.get("schemaMetadata") or {}
    columns = []
    for field in schema_metadata.get("fields") or []:
        tags = field_tags.get(field["fieldPath"], [])
        columns.append({
            "name": field["fieldPath"],
            "native_data_type": field.get("nativeDataType"),
            "description": None,
            "tags": tags,
            "sensitive": any("sensitive" in t.lower() for t in tags),
        })

    dataset_tags = [
        t["tag"]["name"]
        for t in (entity.get("tags") or {}).get("tags") or []
        if t.get("tag", {}).get("name")
    ]

    return {
        "urn": entity["urn"],
        "type": entity["type"],
        "name": entity.get("name"),
        "description": properties.get("description"),
        "industry": custom_properties.get("industry"),
        "vendor": custom_properties.get("vendor"),
        "application": custom_properties.get("app_name") or custom_properties.get("application"),
        "coverage_area": custom_properties.get("coverage_area"),
        "schema": custom_properties.get("schema_name") or custom_properties.get("schema"),
        "category": custom_properties.get("category"),
        "custom_properties": custom_properties,
        "columns": columns,
        "tags": dataset_tags,
    }


def _sync_catalog(url: str, username: str, password: str) -> dict[str, Any]:
    with httpx.Client() as client:
        _login(client, url, username, password)

        first_page = _search_page(client, url, start=0, count=PAGE_SIZE)
        total = first_page["total"]
        entities = [r["entity"] for r in first_page["searchResults"]]

        start = PAGE_SIZE
        while start < total:
            page = _search_page(client, url, start=start, count=PAGE_SIZE)
            entities.extend(r["entity"] for r in page["searchResults"])
            start += PAGE_SIZE

    results = [_transform(e) for e in entities]

    output = {
        "source": "datahub",
        "query": DEFAULT_QUERY,
        "total_in_datahub": total,
        "returned": len(results),
        "results": results,
    }

    CATALOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    CATALOG_FILE.write_text(json.dumps(output, indent=2, ensure_ascii=False), encoding="utf-8")

    import datahub.ingest_datahub_vectors as vector_ingest
    vector_ingest.ingest(CATALOG_FILE, scope="global_template", force=True)

    return {
        "status": "success",
        "count": len(results),
        "embedded": len(results),
        "datasets": [{"name": r["name"] or r["urn"], "urn": r["urn"]} for r in results],
    }


@router.post("/integrations/datahub-catalog/run")
async def run_datahub_catalog(auth: dict = Depends(require_portal_admin)):
    url, username, password = _datahub_credentials()
    try:
        return await asyncio.to_thread(_sync_catalog, url, username, password)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to sync DataHub catalog: {exc}")
