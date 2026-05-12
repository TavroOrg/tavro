from __future__ import annotations

import json
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db

router = APIRouter()
_TABLE_COLUMNS_CACHE: dict[tuple[str, str], set[str]] = {}
_TABLE_EXISTS_CACHE: dict[tuple[str, str], bool] = {}


def _clean(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


def _json_list(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, list) else []
        except json.JSONDecodeError:
            return []
    return []


def _normalize_application_row(row: dict[str, Any]) -> dict[str, Any]:
    row["related_agents"] = _json_list(row.get("related_agents"))
    row["related_agent_count"] = int(row.get("related_agent_count") or 0)
    return row


def _normalize_process_row(row: dict[str, Any]) -> dict[str, Any]:
    row["related_agents"] = _json_list(row.get("related_agents"))
    row["related_processes"] = _json_list(row.get("related_processes"))
    row["related_agent_count"] = int(row.get("related_agent_count") or 0)
    return row


async def _table_columns(db: AsyncSession, schema_name: str, table_name: str) -> set[str]:
    cache_key = (schema_name, table_name)
    if cache_key in _TABLE_COLUMNS_CACHE:
        return _TABLE_COLUMNS_CACHE[cache_key]

    rows = await db.execute(
        text(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = :schema_name
              AND table_name = :table_name
            """
        ),
        {"schema_name": schema_name, "table_name": table_name},
    )
    cols = {str(r._mapping["column_name"]) for r in rows}
    _TABLE_COLUMNS_CACHE[cache_key] = cols
    return cols


async def _table_exists(db: AsyncSession, schema_name: str, table_name: str) -> bool:
    cache_key = (schema_name, table_name)
    if cache_key in _TABLE_EXISTS_CACHE:
        return _TABLE_EXISTS_CACHE[cache_key]

    row = await db.execute(
        text(
            """
            SELECT EXISTS (
                SELECT 1
                FROM information_schema.tables
                WHERE table_schema = :schema_name
                  AND table_name = :table_name
            ) AS exists_flag
            """
        ),
        {"schema_name": schema_name, "table_name": table_name},
    )
    exists = bool(row.mappings().first().get("exists_flag"))
    _TABLE_EXISTS_CACHE[cache_key] = exists
    return exists


def _col_expr(alias: str, cols: set[str], col_name: str) -> str:
    if col_name in cols:
        return f"{alias}.{col_name} AS {col_name}"
    return f"NULL AS {col_name}"


async def _resolve_agent(db: AsyncSession, agent_id: str) -> dict[str, Any]:
    agent_cols = await _table_columns(db, "core", "agents")
    if "agent_id" not in agent_cols:
        raise HTTPException(status_code=500, detail="core.agents.agent_id column not found")

    order_parts: list[str] = []
    if "is_current" in agent_cols:
        order_parts.append("CASE WHEN COALESCE(is_current, FALSE) THEN 0 ELSE 1 END")
    if "updated_ts" in agent_cols:
        order_parts.append("updated_ts DESC NULLS LAST")
    if not order_parts:
        order_parts.append("1")

    select_agent_internal_id = (
        "agent_internal_id" if "agent_internal_id" in agent_cols else "NULL AS agent_internal_id"
    )
    select_agent_name = "agent_name" if "agent_name" in agent_cols else "NULL AS agent_name"
    select_tenant_id = "tenant_id" if "tenant_id" in agent_cols else "NULL AS tenant_id"

    row = await db.execute(
        text(
            f"""
            SELECT
                agent_id,
                {select_agent_internal_id},
                {select_agent_name},
                {select_tenant_id}
            FROM core.agents
            WHERE agent_id = :agent_id
            ORDER BY {", ".join(order_parts)}
            LIMIT 1
            """
        ),
        {"agent_id": agent_id},
    )
    agent = row.mappings().first()
    if not agent:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found")
    if not agent.get("agent_internal_id"):
        raise HTTPException(
            status_code=400,
            detail=f"Agent '{agent_id}' exists but has no agent_internal_id",
        )
    return dict(agent)


async def _refresh_application_rollup(db: AsyncSession, business_application_id: str) -> None:
    await db.execute(
        text(
            """
            UPDATE core.business_applications ba
            SET
                num_of_associated_agents = stats.link_count,
                agent_id = stats.sample_agent_id,
                agent_internal_id = stats.sample_agent_internal_id,
                updated_ts = CURRENT_TIMESTAMP
            FROM (
                SELECT
                    COUNT(*)::int AS link_count,
                    MAX(agent_id) AS sample_agent_id,
                    MAX(agent_internal_id) AS sample_agent_internal_id
                FROM core.agent_business_applications
                WHERE business_application_id = :business_application_id
            ) AS stats
            WHERE ba.business_application_id = :business_application_id
            """
        ),
        {"business_application_id": business_application_id},
    )


async def _refresh_process_rollup(db: AsyncSession, business_process_id: str) -> None:
    await db.execute(
        text(
            """
            UPDATE core.business_processes bp
            SET
                num_of_associated_agents = stats.link_count,
                agent_id = stats.sample_agent_id,
                agent_internal_id = stats.sample_agent_internal_id,
                updated_ts = CURRENT_TIMESTAMP
            FROM (
                SELECT
                    COUNT(*)::int AS link_count,
                    MAX(agent_id) AS sample_agent_id,
                    MAX(agent_internal_id) AS sample_agent_internal_id
                FROM core.agent_business_processes
                WHERE business_process_id = :business_process_id
            ) AS stats
            WHERE bp.business_process_id = :business_process_id
            """
        ),
        {"business_process_id": business_process_id},
    )


async def _fetch_applications(
    db: AsyncSession,
    *,
    application_id: Optional[str] = None,
    search: Optional[str] = None,
) -> list[dict[str, Any]]:
    app_cols = await _table_columns(db, "core", "business_applications")
    if "business_application_id" not in app_cols:
        raise HTTPException(
            status_code=500,
            detail="core.business_applications.business_application_id column not found",
        )

    select_cols = [
        _col_expr("ba", app_cols, "tenant_id"),
        _col_expr("ba", app_cols, "business_application_id"),
        _col_expr("ba", app_cols, "agent_id"),
        _col_expr("ba", app_cols, "agent_internal_id"),
        _col_expr("ba", app_cols, "application_name"),
        _col_expr("ba", app_cols, "emergency_tier"),
        _col_expr("ba", app_cols, "business_owner"),
        _col_expr("ba", app_cols, "application_portfolio_manager"),
        _col_expr("ba", app_cols, "vendor_name"),
        _col_expr("ba", app_cols, "business_criticality"),
        _col_expr("ba", app_cols, "it_application_owner"),
        _col_expr("ba", app_cols, "application_description"),
        _col_expr("ba", app_cols, "agent_risk_exposure"),
        _col_expr("ba", app_cols, "num_of_associated_agents"),
        _col_expr("ba", app_cols, "inherent_risk_classification"),
        _col_expr("ba", app_cols, "residual_risk_classification"),
        _col_expr("ba", app_cols, "agent_risk_tier"),
        _col_expr("ba", app_cols, "blended_risk_score"),
        _col_expr("ba", app_cols, "inherent_risk_classification_score"),
        _col_expr("ba", app_cols, "residual_risk_classification_score"),
        _col_expr("ba", app_cols, "embedded_ai"),
        _col_expr("ba", app_cols, "opt_out_option"),
        _col_expr("ba", app_cols, "privacy_policy_url"),
        _col_expr("ba", app_cols, "data_excluded_from_ai_training"),
        _col_expr("ba", app_cols, "vendor_description"),
        _col_expr("ba", app_cols, "current_installed_version"),
        _col_expr("ba", app_cols, "is_current_version_supported"),
        _col_expr("ba", app_cols, "latest_released_version"),
        _col_expr("ba", app_cols, "latest_release_date"),
        _col_expr("ba", app_cols, "latest_release_documentation_link"),
        _col_expr("ba", app_cols, "created_ts"),
        _col_expr("ba", app_cols, "updated_ts"),
        "rel.related_agents",
        "COALESCE(rel.related_agent_count, 0) AS related_agent_count",
    ]

    has_aba = await _table_exists(db, "core", "agent_business_applications")
    if has_aba:
        aba_cols = await _table_columns(db, "core", "agent_business_applications")
        aba_agent_id_expr = "aba.agent_id" if "agent_id" in aba_cols else "NULL::text"
        aba_agent_internal_id_expr = (
            "aba.agent_internal_id" if "agent_internal_id" in aba_cols else "NULL::text"
        )
        aba_filter = (
            "aba.business_application_id = ba.business_application_id"
            if "business_application_id" in aba_cols
            else "FALSE"
        )
        rel_join_sql = f"""
            LEFT JOIN LATERAL (
                SELECT
                    json_agg(
                        json_build_object(
                            'agent_id', refs.agent_id,
                            'agent_internal_id', refs.agent_internal_id,
                            'agent_name', refs.agent_name
                        )
                        ORDER BY LOWER(COALESCE(refs.agent_name, refs.agent_id, refs.agent_internal_id))
                    ) AS related_agents,
                    COUNT(*)::int AS related_agent_count
                FROM (
                    SELECT DISTINCT
                        {aba_agent_id_expr} AS agent_id,
                        {aba_agent_internal_id_expr} AS agent_internal_id,
                        NULL::text AS agent_name
                    FROM core.agent_business_applications aba
                    WHERE {aba_filter}
                ) refs
            ) rel ON TRUE
        """
    else:
        rel_join_sql = """
            LEFT JOIN LATERAL (
                SELECT NULL::json AS related_agents, 0::int AS related_agent_count
            ) rel ON TRUE
        """

    search_clean = _clean(search)
    order_sql = (
        "LOWER(COALESCE(ba.application_name, ba.business_application_id))"
        if "application_name" in app_cols
        else "LOWER(ba.business_application_id)"
    )

    where_parts: list[str] = []
    query_params: dict[str, Any] = {}
    if application_id is not None:
        where_parts.append("ba.business_application_id = :application_id")
        query_params["application_id"] = application_id

    if search_clean:
        search_clauses = ["ba.business_application_id ILIKE :search_like"]
        if "application_name" in app_cols:
            search_clauses.append("COALESCE(ba.application_name, '') ILIKE :search_like")
        if "application_description" in app_cols:
            search_clauses.append("COALESCE(ba.application_description, '') ILIKE :search_like")
        where_parts.append("(" + " OR ".join(search_clauses) + ")")
        query_params["search_like"] = f"%{search_clean}%"

    where_sql = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""

    rows = await db.execute(
        text(
            f"""
            SELECT
                {", ".join(select_cols)}
            FROM core.business_applications ba
            {rel_join_sql}
            {where_sql}
            ORDER BY {order_sql}
            """
        ),
        query_params,
    )
    return [_normalize_application_row(dict(r._mapping)) for r in rows]


async def _fetch_processes(
    db: AsyncSession,
    *,
    process_id: Optional[str] = None,
    search: Optional[str] = None,
) -> list[dict[str, Any]]:
    process_cols = await _table_columns(db, "core", "business_processes")
    if "business_process_id" not in process_cols:
        raise HTTPException(
            status_code=500,
            detail="core.business_processes.business_process_id column not found",
        )

    select_cols = [
        _col_expr("bp", process_cols, "tenant_id"),
        _col_expr("bp", process_cols, "business_process_id"),
        _col_expr("bp", process_cols, "agent_id"),
        _col_expr("bp", process_cols, "agent_internal_id"),
        _col_expr("bp", process_cols, "process_number"),
        _col_expr("bp", process_cols, "process_name"),
        _col_expr("bp", process_cols, "process_description"),
        _col_expr("bp", process_cols, "parent_process_id"),
        "parent.process_name AS parent_process_name" if "process_name" in process_cols else "NULL AS parent_process_name",
        _col_expr("bp", process_cols, "owner"),
        _col_expr("bp", process_cols, "stakeholders"),
        _col_expr("bp", process_cols, "operators"),
        _col_expr("bp", process_cols, "business_criticality"),
        _col_expr("bp", process_cols, "reputational_impact"),
        _col_expr("bp", process_cols, "num_of_associated_agents"),
        _col_expr("bp", process_cols, "agent_risk_tier"),
        _col_expr("bp", process_cols, "residual_risk_classification"),
        _col_expr("bp", process_cols, "inherent_risk_classification"),
        _col_expr("bp", process_cols, "financial_impact"),
        _col_expr("bp", process_cols, "regulatory_impact"),
        _col_expr("bp", process_cols, "agent_risk_exposure"),
        _col_expr("bp", process_cols, "blended_risk_score"),
        _col_expr("bp", process_cols, "residual_risk_classification_score"),
        _col_expr("bp", process_cols, "inherent_risk_classification_score"),
        _col_expr("bp", process_cols, "sla"),
        _col_expr("bp", process_cols, "process_health_state"),
        _col_expr("bp", process_cols, "created_ts"),
        _col_expr("bp", process_cols, "updated_ts"),
        "rel.related_agents",
        "COALESCE(rel.related_agent_count, 0) AS related_agent_count",
        "proc_rel.related_processes",
    ]

    has_abp = await _table_exists(db, "core", "agent_business_processes")
    if has_abp:
        abp_cols = await _table_columns(db, "core", "agent_business_processes")
        abp_agent_id_expr = "abp.agent_id" if "agent_id" in abp_cols else "NULL::text"
        abp_agent_internal_id_expr = (
            "abp.agent_internal_id" if "agent_internal_id" in abp_cols else "NULL::text"
        )
        abp_filter = (
            "abp.business_process_id = bp.business_process_id"
            if "business_process_id" in abp_cols
            else "FALSE"
        )
        rel_join_sql = f"""
            LEFT JOIN LATERAL (
                SELECT
                    json_agg(
                        json_build_object(
                            'agent_id', refs.agent_id,
                            'agent_internal_id', refs.agent_internal_id,
                            'agent_name', refs.agent_name
                        )
                        ORDER BY LOWER(COALESCE(refs.agent_name, refs.agent_id, refs.agent_internal_id))
                    ) AS related_agents,
                    COUNT(*)::int AS related_agent_count
                FROM (
                    SELECT DISTINCT
                        {abp_agent_id_expr} AS agent_id,
                        {abp_agent_internal_id_expr} AS agent_internal_id,
                        NULL::text AS agent_name
                    FROM core.agent_business_processes abp
                    WHERE {abp_filter}
                ) refs
            ) rel ON TRUE
        """
    else:
        rel_join_sql = """
            LEFT JOIN LATERAL (
                SELECT NULL::json AS related_agents, 0::int AS related_agent_count
            ) rel ON TRUE
        """

    has_bpr = await _table_exists(db, "core", "business_process_relationships")
    if has_bpr:
        bpr_cols = await _table_columns(db, "core", "business_process_relationships")
        has_source = "business_process_id" in bpr_cols
        has_related = "related_business_process_id" in bpr_cols
        has_rel_type = "relationship_type" in bpr_cols
        proc_rel_sql = f"""
            LEFT JOIN LATERAL (
                SELECT
                    json_agg(
                        json_build_object(
                            'business_process_id', linked.other_process_id,
                            'process_name', bp2.process_name,
                            'relationship_type', linked.relationship_type
                        )
                        ORDER BY LOWER(COALESCE(bp2.process_name, linked.other_process_id))
                    ) AS related_processes
                FROM (
                    SELECT DISTINCT
                        CASE
                            WHEN bpr.business_process_id = bp.business_process_id THEN bpr.related_business_process_id
                            ELSE bpr.business_process_id
                        END AS other_process_id,
                        {"bpr.relationship_type" if has_rel_type else "'RELATED'"} AS relationship_type
                    FROM core.business_process_relationships bpr
                    WHERE {"(bpr.business_process_id = bp.business_process_id OR bpr.related_business_process_id = bp.business_process_id)" if has_source and has_related else "FALSE"}
                ) linked
                LEFT JOIN core.business_processes bp2
                    ON bp2.business_process_id = linked.other_process_id
                WHERE linked.other_process_id IS NOT NULL
                  AND linked.other_process_id <> bp.business_process_id
            ) proc_rel ON TRUE
        """
    else:
        proc_rel_sql = """
            LEFT JOIN LATERAL (
                SELECT NULL::json AS related_processes
            ) proc_rel ON TRUE
        """

    search_clean = _clean(search)
    order_sql = (
        "LOWER(COALESCE(bp.process_name, bp.business_process_id))"
        if "process_name" in process_cols
        else "LOWER(bp.business_process_id)"
    )

    where_parts: list[str] = []
    query_params: dict[str, Any] = {}
    if process_id is not None:
        where_parts.append("bp.business_process_id = :process_id")
        query_params["process_id"] = process_id

    if search_clean:
        search_clauses = ["bp.business_process_id ILIKE :search_like"]
        if "process_name" in process_cols:
            search_clauses.append("COALESCE(bp.process_name, '') ILIKE :search_like")
        if "process_description" in process_cols:
            search_clauses.append("COALESCE(bp.process_description, '') ILIKE :search_like")
        where_parts.append("(" + " OR ".join(search_clauses) + ")")
        query_params["search_like"] = f"%{search_clean}%"

    where_sql = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""

    rows = await db.execute(
        text(
            f"""
            SELECT
                {", ".join(select_cols)}
            FROM core.business_processes bp
            LEFT JOIN core.business_processes parent
                ON parent.business_process_id = bp.parent_process_id
            {rel_join_sql}
            {proc_rel_sql}
            {where_sql}
            ORDER BY {order_sql}
            """
        ),
        query_params,
    )
    return [_normalize_process_row(dict(r._mapping)) for r in rows]


@router.get("/applications")
async def list_business_applications(
    q: Optional[str] = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await _fetch_applications(db, search=q)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to list business applications: {exc}")


@router.get("/applications/{business_application_id}")
async def get_business_application(
    business_application_id: str,
    db: AsyncSession = Depends(get_db),
):
    rows = await _fetch_applications(db, application_id=business_application_id)
    if not rows:
        raise HTTPException(
            status_code=404,
            detail=f"Business application '{business_application_id}' not found",
        )
    return rows[0]


@router.get("/processes")
async def list_business_processes(
    q: Optional[str] = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    try:
        return await _fetch_processes(db, search=q)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to list business processes: {exc}")


@router.get("/processes/{business_process_id}")
async def get_business_process(
    business_process_id: str,
    db: AsyncSession = Depends(get_db),
):
    rows = await _fetch_processes(db, process_id=business_process_id)
    if not rows:
        raise HTTPException(
            status_code=404,
            detail=f"Business process '{business_process_id}' not found",
        )
    return rows[0]


@router.get("/agents/{agent_id}")
async def get_agent_relations(
    agent_id: str,
    db: AsyncSession = Depends(get_db),
):
    agent = await _resolve_agent(db, agent_id)

    app_rows = await db.execute(
        text(
            """
            SELECT
                aba.business_application_id,
                COALESCE(ba.application_name, aba.application_name) AS application_name,
                ba.application_description,
                COALESCE(ba.business_criticality, aba.criticality) AS business_criticality,
                ba.emergency_tier,
                ba.business_owner,
                ba.application_portfolio_manager,
                ba.vendor_name,
                ba.it_application_owner,
                ba.inherent_risk_classification,
                ba.residual_risk_classification,
                ba.agent_risk_tier,
                ba.blended_risk_score
            FROM core.agent_business_applications aba
            LEFT JOIN core.business_applications ba
                ON ba.business_application_id = aba.business_application_id
            WHERE aba.agent_internal_id = :agent_internal_id
            ORDER BY LOWER(COALESCE(ba.application_name, aba.application_name, aba.business_application_id))
            """
        ),
        {"agent_internal_id": agent["agent_internal_id"]},
    )
    applications = [dict(r._mapping) for r in app_rows]

    process_rows = await db.execute(
        text(
            """
            SELECT
                abp.business_process_id,
                COALESCE(bp.process_name, abp.process_name) AS process_name,
                bp.process_description,
                COALESCE(bp.business_criticality, abp.criticality) AS business_criticality,
                bp.parent_process_id,
                parent.process_name AS parent_process_name,
                bp.owner,
                bp.stakeholders,
                bp.operators,
                bp.reputational_impact,
                bp.financial_impact,
                bp.regulatory_impact,
                bp.agent_risk_tier,
                bp.residual_risk_classification,
                bp.inherent_risk_classification,
                proc_rel.related_processes
            FROM core.agent_business_processes abp
            LEFT JOIN core.business_processes bp
                ON bp.business_process_id = abp.business_process_id
            LEFT JOIN core.business_processes parent
                ON parent.business_process_id = bp.parent_process_id
            LEFT JOIN LATERAL (
                SELECT
                    json_agg(
                        json_build_object(
                            'business_process_id', linked.other_process_id,
                            'process_name', bp2.process_name,
                            'relationship_type', linked.relationship_type
                        )
                        ORDER BY LOWER(COALESCE(bp2.process_name, linked.other_process_id))
                    ) AS related_processes
                FROM (
                    SELECT DISTINCT
                        CASE
                            WHEN bpr.business_process_id = abp.business_process_id THEN bpr.related_business_process_id
                            ELSE bpr.business_process_id
                        END AS other_process_id,
                        bpr.relationship_type
                    FROM core.business_process_relationships bpr
                    WHERE bpr.business_process_id = abp.business_process_id
                       OR bpr.related_business_process_id = abp.business_process_id
                ) linked
                LEFT JOIN core.business_processes bp2
                    ON bp2.business_process_id = linked.other_process_id
                WHERE linked.other_process_id IS NOT NULL
                  AND linked.other_process_id <> abp.business_process_id
            ) proc_rel ON TRUE
            WHERE abp.agent_internal_id = :agent_internal_id
            ORDER BY LOWER(COALESCE(bp.process_name, abp.process_name, abp.business_process_id))
            """
        ),
        {"agent_internal_id": agent["agent_internal_id"]},
    )
    business_processes = []
    for row in process_rows:
        payload = dict(row._mapping)
        payload["related_processes"] = _json_list(payload.get("related_processes"))
        business_processes.append(payload)

    return {
        "agent": {
            "agent_id": agent.get("agent_id"),
            "agent_internal_id": agent.get("agent_internal_id"),
            "agent_name": agent.get("agent_name"),
            "tenant_id": agent.get("tenant_id"),
        },
        "applications": applications,
        "business_processes": business_processes,
    }


@router.put("/agents/{agent_id}/applications/{business_application_id}")
async def add_agent_application_relation(
    agent_id: str,
    business_application_id: str,
    db: AsyncSession = Depends(get_db),
):
    agent = await _resolve_agent(db, agent_id)

    app_row = await db.execute(
        text(
            """
            SELECT
                business_application_id,
                application_name,
                business_criticality,
                emergency_tier,
                application_description
            FROM core.business_applications
            WHERE business_application_id = :business_application_id
            LIMIT 1
            """
        ),
        {"business_application_id": business_application_id},
    )
    app = app_row.mappings().first()

    if not app:
        await db.execute(
            text(
                """
                INSERT INTO core.business_applications (
                    tenant_id, business_application_id, agent_id, agent_internal_id,
                    application_name, created_ts, updated_ts
                )
                VALUES (
                    :tenant_id, :business_application_id, :agent_id, :agent_internal_id,
                    :application_name, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                )
                ON CONFLICT (business_application_id)
                DO NOTHING
                """
            ),
            {
                "tenant_id": agent.get("tenant_id"),
                "business_application_id": business_application_id,
                "agent_id": agent.get("agent_id"),
                "agent_internal_id": agent.get("agent_internal_id"),
                "application_name": business_application_id,
            },
        )
        app = {
            "application_name": business_application_id,
            "business_criticality": None,
        }

    await db.execute(
        text(
            """
            INSERT INTO core.agent_business_applications (
                tenant_id, business_application_id, agent_id, application_name, criticality,
                created_ts, updated_ts, agent_internal_id
            )
            VALUES (
                :tenant_id, :business_application_id, :agent_id, :application_name, :criticality,
                CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, :agent_internal_id
            )
            ON CONFLICT (agent_internal_id, business_application_id)
            DO UPDATE SET
                agent_id = EXCLUDED.agent_id,
                application_name = EXCLUDED.application_name,
                criticality = EXCLUDED.criticality,
                updated_ts = EXCLUDED.updated_ts
            """
        ),
        {
            "tenant_id": agent.get("tenant_id"),
            "business_application_id": business_application_id,
            "agent_id": agent.get("agent_id"),
            "application_name": app.get("application_name") or business_application_id,
            "criticality": app.get("business_criticality"),
            "agent_internal_id": agent.get("agent_internal_id"),
        },
    )

    await _refresh_application_rollup(db, business_application_id)
    await db.commit()

    return {
        "status": "linked",
        "agent_id": agent_id,
        "business_application_id": business_application_id,
    }


@router.delete("/agents/{agent_id}/applications/{business_application_id}")
async def remove_agent_application_relation(
    agent_id: str,
    business_application_id: str,
    db: AsyncSession = Depends(get_db),
):
    agent = await _resolve_agent(db, agent_id)

    result = await db.execute(
        text(
            """
            DELETE FROM core.agent_business_applications
            WHERE business_application_id = :business_application_id
              AND (
                    agent_internal_id = :agent_internal_id
                    OR agent_id = :agent_id
                  )
            """
        ),
        {
            "business_application_id": business_application_id,
            "agent_internal_id": agent.get("agent_internal_id"),
            "agent_id": agent.get("agent_id"),
        },
    )

    await _refresh_application_rollup(db, business_application_id)
    await db.commit()

    return {
        "status": "unlinked",
        "agent_id": agent_id,
        "business_application_id": business_application_id,
        "rows_deleted": result.rowcount or 0,
    }


@router.put("/agents/{agent_id}/processes/{business_process_id}")
async def add_agent_process_relation(
    agent_id: str,
    business_process_id: str,
    db: AsyncSession = Depends(get_db),
):
    agent = await _resolve_agent(db, agent_id)

    process_row = await db.execute(
        text(
            """
            SELECT
                business_process_id,
                process_name,
                business_criticality
            FROM core.business_processes
            WHERE business_process_id = :business_process_id
            LIMIT 1
            """
        ),
        {"business_process_id": business_process_id},
    )
    process = process_row.mappings().first()

    if not process:
        await db.execute(
            text(
                """
                INSERT INTO core.business_processes (
                    tenant_id, business_process_id, agent_id, agent_internal_id,
                    process_number, process_name, created_ts, updated_ts
                )
                VALUES (
                    :tenant_id, :business_process_id, :agent_id, :agent_internal_id,
                    :process_number, :process_name, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                )
                ON CONFLICT (business_process_id)
                DO NOTHING
                """
            ),
            {
                "tenant_id": agent.get("tenant_id"),
                "business_process_id": business_process_id,
                "agent_id": agent.get("agent_id"),
                "agent_internal_id": agent.get("agent_internal_id"),
                "process_number": business_process_id,
                "process_name": business_process_id,
            },
        )
        process = {
            "process_name": business_process_id,
            "business_criticality": None,
        }

    await db.execute(
        text(
            """
            INSERT INTO core.agent_business_processes (
                tenant_id, business_process_id, agent_id, process_name, criticality,
                created_ts, updated_ts, agent_internal_id
            )
            VALUES (
                :tenant_id, :business_process_id, :agent_id, :process_name, :criticality,
                CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, :agent_internal_id
            )
            ON CONFLICT (agent_internal_id, business_process_id)
            DO UPDATE SET
                agent_id = EXCLUDED.agent_id,
                process_name = EXCLUDED.process_name,
                criticality = EXCLUDED.criticality,
                updated_ts = EXCLUDED.updated_ts
            """
        ),
        {
            "tenant_id": agent.get("tenant_id"),
            "business_process_id": business_process_id,
            "agent_id": agent.get("agent_id"),
            "process_name": process.get("process_name") or business_process_id,
            "criticality": process.get("business_criticality"),
            "agent_internal_id": agent.get("agent_internal_id"),
        },
    )

    await _refresh_process_rollup(db, business_process_id)
    await db.commit()

    return {
        "status": "linked",
        "agent_id": agent_id,
        "business_process_id": business_process_id,
    }


@router.delete("/agents/{agent_id}/processes/{business_process_id}")
async def remove_agent_process_relation(
    agent_id: str,
    business_process_id: str,
    db: AsyncSession = Depends(get_db),
):
    agent = await _resolve_agent(db, agent_id)

    result = await db.execute(
        text(
            """
            DELETE FROM core.agent_business_processes
            WHERE business_process_id = :business_process_id
              AND (
                    agent_internal_id = :agent_internal_id
                    OR agent_id = :agent_id
                  )
            """
        ),
        {
            "business_process_id": business_process_id,
            "agent_internal_id": agent.get("agent_internal_id"),
            "agent_id": agent.get("agent_id"),
        },
    )

    await _refresh_process_rollup(db, business_process_id)
    await db.commit()

    return {
        "status": "unlinked",
        "agent_id": agent_id,
        "business_process_id": business_process_id,
        "rows_deleted": result.rowcount or 0,
    }
