import asyncio
from datetime import datetime
from temporalio import activity
from services.risk_agents.risk_classification import classify_risk
from services.db.db_functions import (
    insert_or_update_into_postgres,
    insert_core_risk_assessment,
    refresh_curated_agent_360,
    update_agent_data_sensitivity_flags,
    create_local_agent_card,
)


@activity.defn
async def classify_risk_activity(agent_name: str, agent_description: str, agent_instructions: str) -> dict:
    return await asyncio.to_thread(
        classify_risk,
        agent_name,
        agent_description,
        agent_instructions
    )

@activity.defn
async def insert_risk_assessment_activity(response_data: dict) -> str:
    return await asyncio.to_thread(
        insert_or_update_into_postgres,
        response_data
    )

@activity.defn
async def insert_core_activity(agent_internal_id: str, agent_id: str, assessment_id: str, risk_classification: str) -> None:
    created_ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    return await asyncio.to_thread(
        insert_core_risk_assessment,
        agent_internal_id,
        agent_id,
        assessment_id,
        risk_classification,
        created_ts,
    )

@activity.defn
async def update_data_sources(agent_internal_id: str, agent_id: str, personally_identifiable_information: str, protected_health_information: str, payment_card_industry: str) -> None:
    return await asyncio.to_thread(
        update_agent_data_sensitivity_flags,
        agent_internal_id,
        agent_id,
        personally_identifiable_information,
        protected_health_information,
        payment_card_industry,
    )

@activity.defn
async def refresh_curated_agent_360_activity(agent_internal_id: str, agent_id: str) -> dict:
    return await asyncio.to_thread(
        refresh_curated_agent_360,
        agent_internal_id,
        agent_id,
    )


@activity.defn
async def create_local_agent_card_activity(agent_internal_id: str) -> dict:
    return await asyncio.to_thread(
        create_local_agent_card,
        agent_internal_id,
    )
