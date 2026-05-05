from datetime import timedelta

from temporalio import workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from services.activity.activities import (
        classify_risk_activity,
        create_local_agent_card_activity,
        insert_core_activity,
        insert_risk_assessment_activity,
        refresh_curated_agent_360_activity,
        update_data_sources,
    )


@workflow.defn
class RiskManagerWorkflow:
    @workflow.run
    async def run(self, agent_internal_id: str, agent_id: str, agent_name: str, agent_description: str, agent_instructions: str) -> dict:
        retry_policy = RetryPolicy(
            initial_interval=timedelta(seconds=2),
            maximum_interval=timedelta(seconds=30),
            maximum_attempts=3,
        )
        
        # Step 1: EU AI Act risk classification
        risk_result = await workflow.execute_activity(
            classify_risk_activity,
            args=[agent_name, agent_description, agent_instructions],
            start_to_close_timeout=timedelta(minutes=10),
            retry_policy=retry_policy,
        )

        response_data = {
            "agent_internal_id": agent_internal_id,
            "agent_id": agent_id,
            "agent_name": agent_name,
            "risk_classification": risk_result["Risk Classification"],
            "personally_identifiable_information": risk_result["Personally Identifiable Information"],
            "protected_health_information": risk_result["Protected Health Information"],
            "payment_card_industry": risk_result["Payment Card Industry"],
            "article_5": risk_result["Article 5(Prohibited AI Practices)"],
            "article_6": risk_result["Article 6(High-Risk AI Systems)"],
            "risk_rating_rationale": risk_result["Risk Rating Rationale"]
        }

        assessment_id = await workflow.execute_activity(
            insert_risk_assessment_activity,
            args=[response_data],
            start_to_close_timeout=timedelta(minutes=10),
            retry_policy=retry_policy,
        )

        await workflow.execute_activity(
            insert_core_activity,
            args=[agent_internal_id, agent_id, assessment_id, risk_result.get("Risk Classification")],
            start_to_close_timeout=timedelta(minutes=10),
            retry_policy=retry_policy,
        )

        await workflow.execute_activity(
            update_data_sources,
            args=[agent_internal_id, agent_id, risk_result.get("Personally Identifiable Information"), risk_result.get("Protected Health Information"), risk_result.get("Payment Card Industry")],
            start_to_close_timeout=timedelta(minutes=10),
            retry_policy=retry_policy,
        )

        agent_360_refresh_result = await workflow.execute_activity(
            refresh_curated_agent_360_activity,
            args=[agent_internal_id, agent_id],
            start_to_close_timeout=timedelta(minutes=10),
            retry_policy=retry_policy,
        )

        local_agent_card_result = await workflow.execute_activity(
            create_local_agent_card_activity,
            args=[agent_internal_id],
            start_to_close_timeout=timedelta(minutes=10),
            retry_policy=retry_policy,
        )

        return {
            "risk_result": risk_result,
            "assessment_id": assessment_id,
            "agent_360_refresh": agent_360_refresh_result,
            "local_agent_card": local_agent_card_result,
        }
