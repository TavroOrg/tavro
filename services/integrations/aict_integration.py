import os
import logging
import requests

logger = logging.getLogger(__name__)

AICT_INSTANCE_URL        = os.getenv("AICT_INSTANCE_URL", "").rstrip("/")
AICT_USERNAME            = os.getenv("AICT_USERNAME", "")
AICT_PASSWORD            = os.getenv("AICT_PASSWORD", "")
AICT_PROVIDER_NAME       = os.getenv("AICT_PROVIDER_NAME", "Tavro")
# sys_id for the "Agentic AI" cmdb_model_category — set in your ServiceNow instance
AICT_MODEL_CATEGORY_SYS_ID = os.getenv(
    "AICT_MODEL_CATEGORY_SYS_ID",
    "5383f164ffec2a10c0fbffffffffff82",  # default from tavrobuild instance
)

_HEADERS = {
    "Accept": "application/json",
    "Content-Type": "application/json",
}


def _aict_enabled() -> bool:
    """Read AICT_ENABLED from the .env file so enable/disable takes effect without restart."""
    import re
    from pathlib import Path
    env_file = Path(os.getenv("ENV_FILE_PATH", "/app/.env"))
    try:
        if env_file.exists():
            for line in env_file.read_text(encoding="utf-8").splitlines():
                stripped = line.strip()
                if not stripped or stripped.startswith("#"):
                    continue
                m = re.match(r'^AICT_ENABLED\s*=\s*(.*)', stripped)
                if m:
                    val = m.group(1).strip().strip('"').strip("'")
                    return val.lower() not in ("false", "0", "no")
    except Exception:
        pass
    # Fall back to os.environ (e.g. container started with AICT_ENABLED set)
    return os.getenv("AICT_ENABLED", "true").strip().lower() not in ("false", "0", "no")


def is_configured() -> bool:
    if not _aict_enabled():
        return False
    return bool(AICT_INSTANCE_URL and AICT_USERNAME and AICT_PASSWORD)


def _get(table: str, query: str, fields: str, limit: int = 1) -> list:
    url = f"{AICT_INSTANCE_URL}/api/now/table/{table}"
    params = {
        "sysparm_query": query,
        "sysparm_fields": fields,
        "sysparm_limit": limit,
        "sysparm_display_value": "false",
    }
    resp = requests.get(
        url,
        auth=(AICT_USERNAME, AICT_PASSWORD),
        headers=_HEADERS,
        params=params,
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json().get("result", [])


def _post(table: str, payload: dict) -> dict:
    url = f"{AICT_INSTANCE_URL}/api/now/table/{table}"
    resp = requests.post(
        url,
        auth=(AICT_USERNAME, AICT_PASSWORD),
        headers=_HEADERS,
        json=payload,
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json().get("result", {})


def _find_or_create_provider(provider_name: str) -> str:
    rows = _get(
        "core_company",
        query=f"name={provider_name}",
        fields="sys_id,name",
    )
    if rows:
        sys_id = rows[0]["sys_id"]
        logger.info("AICT provider found: %s (%s)", provider_name, sys_id)
        return sys_id

    result = _post("core_company", {"name": provider_name})
    sys_id = result["sys_id"]
    logger.info("AICT provider created: %s (%s)", provider_name, sys_id)
    return sys_id


def _find_or_create_model(name: str, description: str, provider_sys_id: str) -> str:
    rows = _get(
        "cmdb_ai_system_component_product_model",
        query=(
            f"name={name}"
            f"^manufacturer={provider_sys_id}"
            f"^cmdb_model_category={AICT_MODEL_CATEGORY_SYS_ID}"
        ),
        fields="sys_id,name",
    )
    if rows:
        sys_id = rows[0]["sys_id"]
        logger.info("AICT model found: %s (%s)", name, sys_id)
        return sys_id

    result = _post(
        "cmdb_ai_system_component_product_model",
        {
            "name": name,
            "manufacturer": provider_sys_id,
            "cmdb_model_category": AICT_MODEL_CATEGORY_SYS_ID,
            "description": description,
        },
    )
    sys_id = result["sys_id"]
    logger.info("AICT model created: %s (%s)", name, sys_id)
    return sys_id


def _find_or_create_asset(name: str, description: str, model_sys_id: str, provider_sys_id: str) -> str:
    rows = _get(
        "alm_ai_system_digital_asset",
        query=f"model={model_sys_id}",
        fields="sys_id,name,install_status",
    )
    if rows:
        sys_id = rows[0]["sys_id"]
        logger.info("AICT asset found: %s (%s)", name, sys_id)
        return sys_id

    result = _post(
        "alm_ai_system_digital_asset",
        {
            "name": name,
            "model": model_sys_id,
            "model_category": AICT_MODEL_CATEGORY_SYS_ID,
            "manufacturer": provider_sys_id,
            "description": description,
            "install_status": "1",  # Deployed
        },
    )
    sys_id = result["sys_id"]
    logger.info("AICT asset created: %s (%s)", name, sys_id)
    return sys_id


def create_ai_system(agent_name: str, agent_description: str, provider_name: str = None) -> dict:
    """
    Find-or-create an AI System in ServiceNow AICT for the given Tavro agent.

    Tavro → AICT field mapping (Phase 1):
      agent_name        → AI System name (product model + digital asset)
      agent_description → description on both the model and the digital asset
      provider_name     → manufacturer (core_company)

    Returns a dict with the resulting sys_ids.
    Raises if AICT is not configured or any API call fails.
    """
    if not is_configured():
        raise RuntimeError(
            "AICT integration is not configured. "
            "Set AICT_INSTANCE_URL, AICT_USERNAME, and AICT_PASSWORD."
        )

    provider = provider_name or AICT_PROVIDER_NAME
    provider_sys_id = _find_or_create_provider(provider)
    model_sys_id    = _find_or_create_model(agent_name, agent_description, provider_sys_id)
    asset_sys_id    = _find_or_create_asset(agent_name, agent_description, model_sys_id, provider_sys_id)

    return {
        "provider_sys_id": provider_sys_id,
        "model_sys_id":    model_sys_id,
        "asset_sys_id":    asset_sys_id,
    }
