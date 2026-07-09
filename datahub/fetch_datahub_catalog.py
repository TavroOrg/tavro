#!/usr/bin/env python3
"""
Pulls the full dataset catalog from the DataHub GraphQL API and overwrites
datahub/datahub.json with the result.

Authenticates the same way Postman does against a session-cookie-only
DataHub deployment: POST username/password to /logIn, then reuse the
returned session cookie (e.g. PLAY_SESSION) for /api/graphql requests.

Usage:
    pip install -r datahub/ingest_requirements.txt

    DATAHUB_USERNAME=you DATAHUB_PASSWORD=... \
    python datahub/fetch_datahub_catalog.py

Optional overrides:
    DATAHUB_URL=https://datahub-dev.tavro.ai   (default)
    DATAHUB_QUERY=*                            (default; "*" = entire catalog)
    DATAHUB_TYPE=DATASET                       (default; DataHub search entity type)
"""

import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, List

import requests

REPO_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = Path(__file__).parent / "datahub.json"

DEFAULT_BASE_URL = "https://datahub-dev.tavro.ai"
DEFAULT_QUERY = "*"
DEFAULT_TYPE = "DATASET"
PAGE_SIZE = 100

SEARCH_GQL = """
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


def load_dotenv_if_present() -> None:
    env_path = REPO_ROOT / ".env"
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


load_dotenv_if_present()

BASE_URL = os.environ.get("DATAHUB_URL", DEFAULT_BASE_URL).rstrip("/")
USERNAME = os.environ.get("DATAHUB_USERNAME")
PASSWORD = os.environ.get("DATAHUB_PASSWORD")
QUERY_TEXT = os.environ.get("DATAHUB_QUERY", DEFAULT_QUERY)
ENTITY_TYPE = os.environ.get("DATAHUB_TYPE", DEFAULT_TYPE)


def login(session: requests.Session) -> None:
    if not USERNAME or not PASSWORD:
        print("ERROR: DATAHUB_USERNAME and DATAHUB_PASSWORD must be set.")
        sys.exit(1)

    resp = session.post(
        f"{BASE_URL}/logIn",
        json={"username": USERNAME, "password": PASSWORD},
        timeout=30,
    )
    if resp.status_code != 200 or not session.cookies:
        print(f"ERROR: Login to {BASE_URL} failed (status {resp.status_code}).")
        print(f"  Response: {resp.text[:500]}")
        sys.exit(1)


def search_page(session: requests.Session, start: int, count: int) -> Dict[str, Any]:
    resp = session.post(
        f"{BASE_URL}/api/graphql",
        json={
            "query": SEARCH_GQL,
            "variables": {
                "input": {
                    "type": ENTITY_TYPE,
                    "query": QUERY_TEXT,
                    "start": start,
                    "count": count,
                }
            },
        },
        timeout=60,
    )
    resp.raise_for_status()
    payload = resp.json()
    if payload.get("errors"):
        print(f"ERROR: GraphQL errors at start={start}: {payload['errors']}")
        sys.exit(1)
    return payload["data"]["search"]


def fetch_all_entities(session: requests.Session) -> tuple:
    first_page = search_page(session, start=0, count=PAGE_SIZE)
    total = first_page["total"]
    entities = [r["entity"] for r in first_page["searchResults"]]

    start = PAGE_SIZE
    while start < total:
        page = search_page(session, start=start, count=PAGE_SIZE)
        entities.extend(r["entity"] for r in page["searchResults"])
        start += PAGE_SIZE

    return total, entities


def transform(entity: Dict[str, Any]) -> Dict[str, Any]:
    properties = entity.get("properties") or {}
    custom_properties = {
        cp["key"]: cp["value"]
        for cp in (properties.get("customProperties") or [])
        if cp.get("key") is not None
    }

    field_tags: Dict[str, List[str]] = {}
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


def main() -> None:
    session = requests.Session()
    login(session)
    print(f"Logged into {BASE_URL} as {USERNAME}")

    total, entities = fetch_all_entities(session)
    print(f"Fetched {len(entities)} of {total} {ENTITY_TYPE} entities matching query={QUERY_TEXT!r}")

    results = [transform(e) for e in entities]

    output = {
        "source": "datahub",
        "query": QUERY_TEXT,
        "total_in_datahub": total,
        "returned": len(results),
        "results": results,
    }

    OUTPUT_PATH.write_text(
        json.dumps(output, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    print(f"Wrote {len(results)} datasets to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
