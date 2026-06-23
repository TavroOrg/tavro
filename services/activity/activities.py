import asyncio
from datetime import datetime
from temporalio import activity
from services.risk_agents.risk_classification import classify_risk
from services.risk_agents.aars_risk_evaluation import aars_risk_evaluation
from services.risk_agents.cvss_scoring import score_cvss
from services.risk_agents.risk_assessment_summary import risk_summary_agent
from services.db.db_functions import (
    insert_or_update_into_postgres,
    update_cvss_for_assessment,
    insert_core_risk_assessment,
    insert_summary_to_tables,
    update_agent_data_sensitivity_flags,
    refresh_curated_agent_360,
    create_local_agent_card,
)
from services.integrations.aict_integration import create_ai_system, is_configured as aict_is_configured


@activity.defn
async def classify_risk_activity(agent_name: str, agent_description: str, agent_instructions: str) -> dict:
    return await asyncio.to_thread(
        classify_risk,
        agent_name,
        agent_description,
        agent_instructions
    )

@activity.defn
async def aars_risk_evaluation_activity(agent_name: str, agent_description: str, agent_instructions: str, agent_role: str, provider: str, agent_platform: str) -> dict:
    return await asyncio.to_thread(
        aars_risk_evaluation,
        agent_name,
        agent_description,
        agent_instructions,
        agent_role,
        provider,
        agent_platform,
    )

@activity.defn
async def insert_risk_assessment_activity(response_data: dict) -> str:
    tenant_id = None
    if isinstance(response_data, dict):
        tenant_id = response_data.get("tenant_id")
    return await asyncio.to_thread(
        insert_or_update_into_postgres,
        response_data,
        tenant_id=tenant_id
    )

@activity.defn
async def score_cvss_activity(agent_name: str, agent_description: str, agent_instructions: str, personally_identifiable_information: str = "No", protected_health_information: str = "No", payment_card_industry: str = "No") -> dict:
    return await asyncio.to_thread(
        score_cvss,
        agent_name,
        agent_description,
        agent_instructions,
        personally_identifiable_information,
        protected_health_information,
        payment_card_industry,
    )

@activity.defn
async def update_cvss_activity(agent_internal_id: str, assessment_id: str, aars_score: float, cvss_result: dict, tenant_id: str = None,) -> None:
    updated_ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    return await asyncio.to_thread(
        update_cvss_for_assessment,
        agent_internal_id,
        # agent_id,
        assessment_id,
        aars_score,
        cvss_result,
        updated_ts,
        tenant_id=tenant_id,
    )

@activity.defn
async def insert_core_activity(agent_internal_id: str, agent_id: str, assessment_id: str, aars_score: float, cvss_result: dict, risk_classification: str, tenant_id: str = None) -> None:
    created_ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    return await asyncio.to_thread(
        insert_core_risk_assessment,
        agent_internal_id,
        agent_id,
        assessment_id,
        aars_score,
        cvss_result,
        risk_classification,
        created_ts,
        tenant_id=tenant_id,
    )

@activity.defn
async def summary_activity(agent_internal_id: str, assessment_id: str) -> str:
    return await asyncio.to_thread(
        risk_summary_agent,
        internal_id=agent_internal_id,
        assessment_id=assessment_id,
    )

@activity.defn
async def insert_summary_activity(agent_internal_id: str, assessment_id: str, summary: str, tenant_id: str = None) -> None:
    return await asyncio.to_thread(
        insert_summary_to_tables,
        agent_internal_id=agent_internal_id,
        assessment_id=assessment_id,
        summary=summary,
        tenant_id=tenant_id,
    )

@activity.defn
async def update_data_sources(agent_internal_id: str, agent_id: str, personally_identifiable_information: str, protected_health_information: str, payment_card_industry: str, tenant_id: str = None) -> None:
    return await asyncio.to_thread(
        update_agent_data_sensitivity_flags,
        agent_internal_id,
        agent_id,
        personally_identifiable_information,
        protected_health_information,
        payment_card_industry,
        tenant_id=tenant_id,
    )

@activity.defn
async def refresh_curated_agent_360_activity(agent_internal_id: str, agent_id: str, tenant_id: str = None) -> dict:
    return await asyncio.to_thread(
        refresh_curated_agent_360,
        agent_internal_id,
        agent_id,
        tenant_id,
    )

@activity.defn
async def create_local_agent_card_activity(agent_internal_id: str):
    return await asyncio.to_thread(
        create_local_agent_card,
        agent_internal_id,
    )


@activity.defn
async def create_aict_ai_system_activity(
    agent_name: str,
    agent_description: str,
    provider: str = None,
) -> dict:
    """
    Creates (or finds) an AI System in ServiceNow AICT.
    Skipped silently when AICT env vars are not set.
    """
    if not aict_is_configured():
        return {"skipped": True, "reason": "AICT not configured"}

    return await asyncio.to_thread(
        create_ai_system,
        agent_name,
        agent_description,
        provider,
    )
