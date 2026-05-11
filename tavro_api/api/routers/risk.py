import os
import uuid
from typing import Literal, Optional
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator
from temporalio.client import Client

from services.workflow.workflow import RiskManagerWorkflow

TASK_QUEUE = "risk-classification-queue"
TEMPORAL_ADDRESS = os.getenv("TEMPORAL_ADDRESS", "risk-temporal:7233")

router = APIRouter()


class RiskClassificationRequest(BaseModel):
    agent_internal_id: str = Field(..., min_length=1)
    agent_id: str = Field(..., min_length=1)
    agent_name: str = Field(..., min_length=1)
    agent_description: str = Field(..., min_length=1)
    agent_instructions: Optional[str] = Field(None, min_length=0)
    agent_role: Optional[str] = Field(None, min_length=0)
    provider: Optional[str] = Field(None, min_length=0)
    agent_platform: Optional[str] = Field(None, min_length=0)
    tenant_id: Optional[str] = Field(None, min_length=0)

    attack_vector_av: Literal["N", "A", "L", "P"] = "N"
    attack_complexity_ac: Literal["L", "H"] = "L"
    attack_requirements_at: Literal["P", "N"] = "P"
    privileges_required_pr: Literal["L", "N", "H"] = "L"
    user_interaction_ui: Literal["P", "N", "A"] = "P"
    vulnerable_system_confidentiality_vc: Literal["L", "H", "N"] = "L"
    vulnerable_system_integrity_vi: Literal["L", "H", "N"] = "L"
    vulnerable_system_availability_va: Literal["L", "H", "N"] = "L"
    subsequent_system_confidentiality_sc: Literal["L", "H", "N"] = "L"
    subsequent_system_integrity_si: Literal["L", "H", "N"] = "L"
    subsequent_system_availability_sa: Literal["L", "H", "N"] = "L"

    @field_validator("agent_internal_id", "agent_id", "agent_name", "agent_description")
    def check_no_whitespace(cls, v):
        if not v.strip():
            raise ValueError("Field cannot be empty or just whitespace")
        return v


class RiskClassificationResponse(BaseModel):
    agent_internal_id: str
    agent_id: str
    risk_classification: str
    personally_identifiable_information: str
    protected_health_information: str
    payment_card_industry: str
    article_5: dict
    article_6: dict
    risk_rating_rationale: str


@router.post("/classify-risk", response_model=RiskClassificationResponse)
async def classify_risk(request: RiskClassificationRequest):
    client = await Client.connect(TEMPORAL_ADDRESS)

    handle = await client.start_workflow(
        RiskManagerWorkflow.run,
        args=[
            request.agent_internal_id,
            request.agent_id,
            request.agent_name,
            request.agent_description,
            request.agent_instructions,
            request.agent_role,
            request.provider,
            request.agent_platform,
            request.attack_vector_av,
            request.attack_complexity_ac,
            request.attack_requirements_at,
            request.privileges_required_pr,
            request.user_interaction_ui,
            request.vulnerable_system_confidentiality_vc,
            request.vulnerable_system_integrity_vi,
            request.vulnerable_system_availability_va,
            request.subsequent_system_confidentiality_sc,
            request.subsequent_system_integrity_si,
            request.subsequent_system_availability_sa,
            request.tenant_id,
        ],
        id=f"risk-manager-{uuid.uuid4()}",
        task_queue=TASK_QUEUE,
    )

    workflow_result = await handle.result()
    risk_result = workflow_result["risk_result"]

    return RiskClassificationResponse(
        agent_internal_id=request.agent_internal_id,
        agent_id=request.agent_id,
        risk_classification=risk_result["Risk Classification"],
        personally_identifiable_information=risk_result["Personally Identifiable Information"],
        protected_health_information=risk_result["Protected Health Information"],
        payment_card_industry=risk_result["Payment Card Industry"],
        article_5=risk_result["Article 5(Prohibited AI Practices)"],
        article_6=risk_result["Article 6(High-Risk AI Systems)"],
        risk_rating_rationale=risk_result["Risk Rating Rationale"],
    )
