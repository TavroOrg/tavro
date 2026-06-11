from datetime import timedelta

from temporalio import workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from services.activity.activities import (
        classify_risk_activity,
        aars_risk_evaluation_activity,
        insert_risk_assessment_activity,
        score_cvss_activity,
        update_cvss_activity,
        insert_core_activity,
        summary_activity,
        insert_summary_activity,
        update_data_sources,
        refresh_curated_agent_360_activity,
        create_local_agent_card_activity,
    )


@workflow.defn
class RiskManagerWorkflow:
    @workflow.run
    async def run(self, agent_internal_id: str, agent_id: str, agent_name: str, agent_description: str, agent_instructions: str, agent_role: str, provider: str, agent_platform: str, attack_vector_av: str, attack_complexity_ac: str, attack_requirements_at: str, privileges_required_pr: str, user_interaction_ui: str, vulnerable_system_confidentiality_vc: str, vulnerable_system_integrity_vi: str, vulnerable_system_availability_va: str, subsequent_system_confidentiality_sc: str, subsequent_system_integrity_si: str, subsequent_system_availability_sa: str, tenant_id: str = None) -> dict:
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
        print("[workflow] classify_risk_activity completed")

        aars_result = await workflow.execute_activity(
            aars_risk_evaluation_activity,
            args=[agent_name, agent_description, agent_instructions, agent_role, provider, agent_platform],
            start_to_close_timeout=timedelta(minutes=10),
            retry_policy=retry_policy,
        )
        print("[workflow] aars_risk_evaluation_activity completed")

        response_data = {
            "agent_internal_id": agent_internal_id,
            "agent_id": agent_id,
            "agent_name": agent_name,
            "tenant_id": tenant_id,
            "risk_classification": risk_result["Risk Classification"],
            "personally_identifiable_information": risk_result["Personally Identifiable Information"],
            "protected_health_information": risk_result["Protected Health Information"],
            "payment_card_industry": risk_result["Payment Card Industry"],
            "article_5": risk_result["Article 5(Prohibited AI Practices)"],
            "article_6": risk_result["Article 6(High-Risk AI Systems)"],
            "risk_rating_rationale": risk_result["Risk Rating Rationale"],
            "attack_vector_av": attack_vector_av,
            "attack_complexity_ac": attack_complexity_ac,
            "attack_requirements_at": attack_requirements_at,
            "privileges_required_pr": privileges_required_pr,
            "user_interaction_ui": user_interaction_ui,
            "vulnerable_system_confidentiality_vc": vulnerable_system_confidentiality_vc,
            "vulnerable_system_integrity_vi": vulnerable_system_integrity_vi,
            "vulnerable_system_availability_va": vulnerable_system_availability_va,
            "subsequent_system_confidentiality_sc": subsequent_system_confidentiality_sc,
            "subsequent_system_integrity_si": subsequent_system_integrity_si,
            "subsequent_system_availability_sa": subsequent_system_availability_sa,
            "aars_factors": aars_result["aars_factors"],
            "aars_rationales": aars_result["aars_rationales"],
            "aars_total_score": aars_result["aars_total_score"]
        }

        assessment_id = await workflow.execute_activity(
            insert_risk_assessment_activity,
            args=[response_data],
            start_to_close_timeout=timedelta(minutes=10),
            retry_policy=retry_policy,
        )
        print(f"[workflow] insert_risk_assessment_activity completed assessment_id={assessment_id}")

        cvss_result = await workflow.execute_activity(
            score_cvss_activity,
            args=[agent_name, agent_description, agent_instructions, risk_result.get("Personally Identifiable Information"), risk_result.get("Protected Health Information"), risk_result.get("Payment Card Industry")],
            start_to_close_timeout=timedelta(minutes=20),
            retry_policy=retry_policy,
        )
        print("[workflow] score_cvss_activity completed")

        await workflow.execute_activity(
            update_cvss_activity,
            args=[agent_internal_id, assessment_id, float(aars_result.get("aars_total_score")), cvss_result, tenant_id],            
            start_to_close_timeout=timedelta(minutes=10),
            retry_policy=retry_policy,
        )
        print("[workflow] update_cvss_activity completed")

        await workflow.execute_activity(
            insert_core_activity,
            args=[agent_internal_id, agent_id, assessment_id, float(aars_result.get("aars_total_score")), cvss_result, risk_result.get("Risk Classification"), tenant_id],
            start_to_close_timeout=timedelta(minutes=10),
            retry_policy=retry_policy,
        )
        print("[workflow] insert_core_activity completed")

        summary = await workflow.execute_activity(
            summary_activity,
            args=[agent_internal_id, assessment_id],
            start_to_close_timeout=timedelta(minutes=10),
            retry_policy=retry_policy,
        )
        print(f"[workflow] summary_activity completed summary_length={len(summary) if summary is not None else 0}")

        await workflow.execute_activity(
            insert_summary_activity,
            args=[agent_internal_id, assessment_id, summary, tenant_id],
            start_to_close_timeout=timedelta(minutes=10),
            retry_policy=retry_policy,
        )
        print("[workflow] insert_summary_activity completed")

        await workflow.execute_activity(
            update_data_sources,
            args=[agent_internal_id, agent_id, risk_result.get("Personally Identifiable Information"), risk_result.get("Protected Health Information"), risk_result.get("Payment Card Industry"), tenant_id],
            start_to_close_timeout=timedelta(minutes=10),
            retry_policy=retry_policy,
        )
        print("[workflow] update_data_sources completed")

        agent_360_refresh_result = await workflow.execute_activity(
            refresh_curated_agent_360_activity,
            args=[agent_internal_id, agent_id, tenant_id],
            start_to_close_timeout=timedelta(minutes=10),
            retry_policy=retry_policy,
        )
        print("[workflow] refresh_curated_agent_360_activity completed")

        await workflow.execute_activity(
            create_local_agent_card_activity,
            args=[agent_internal_id, agent_id, tenant_id],
            start_to_close_timeout=timedelta(minutes=10),
            retry_policy=retry_policy,
        )

        return {
            "risk_result": risk_result,
            "assessment_id": assessment_id,
            "agent_360_refresh": agent_360_refresh_result,
        }
