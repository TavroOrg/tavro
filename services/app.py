import os
import uuid
import uvicorn
import asyncio
from typing import Literal
from fastapi import Request
from temporalio.worker import Worker
from temporalio.client import Client
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator
from typing import Optional
from contextlib import asynccontextmanager

from utils.set_environment import set_environment
from services.workflow.workflow import RiskManagerWorkflow
from services.activity.activities import (
    classify_risk_activity,
    create_local_agent_card_activity,
    insert_core_activity,
    insert_risk_assessment_activity,
    refresh_curated_agent_360_activity,
    update_data_sources,
)

TASK_QUEUE = "risk-classification-queue"
TEMPORAL_ADDRESS = os.getenv("TEMPORAL_ADDRESS", "temporal:7233")
set_environment('fastapi')

# Async worker that listens to the task queue
async def run_worker():
    print("Connecting worker to Temporal...")
    client = await Client.connect(TEMPORAL_ADDRESS)

    worker = Worker(
        client,
        task_queue=TASK_QUEUE,
        workflows=[RiskManagerWorkflow],
        activities=[
            classify_risk_activity,
            insert_risk_assessment_activity,
            insert_core_activity,
            update_data_sources,
            refresh_curated_agent_360_activity,
            create_local_agent_card_activity,
        ],
    )

    print("Worker started, listening on task queue:", TASK_QUEUE)
    await worker.run()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Start worker as background task when FastAPI starts
    print("Starting Temporal worker...")
    worker_task = asyncio.create_task(run_worker())
    yield
    # Shutdown: cancel worker gracefully
    print("Shutting down Temporal worker...")
    worker_task.cancel()
    try:
        await worker_task
    except asyncio.CancelledError:
        print("Worker shut down cleanly.")


# FastAPI app instance
app = FastAPI(lifespan=lifespan)


# Pydantic model for request body validation
class RiskClassificationRequest(BaseModel):
    agent_internal_id: str = Field(..., min_length=1)
    agent_id: str = Field(..., min_length=1)
    agent_name: str = Field(..., min_length=1)
    agent_description: str = Field(..., min_length=1)
    agent_instructions: Optional[str] = Field(None, min_length=0)

    @field_validator("agent_internal_id", "agent_id", "agent_name", "agent_description")
    def check_no_whitespace(cls, v):
        # Strip leading/trailing spaces and check if the value is empty
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


@app.get("/health")
def health_check(request: Request):
    return JSONResponse(content={"status": "ok"}, status_code=200)


@app.post("/classify-risk", response_model=RiskClassificationResponse)
async def classify_risk(request: RiskClassificationRequest):
    try:
        client = await Client.connect(TEMPORAL_ADDRESS)

        workflow_id = f"risk-manager-{uuid.uuid4()}"

        handle = await client.start_workflow(
            RiskManagerWorkflow.run,
            args=[request.agent_internal_id, request.agent_id, request.agent_name, request.agent_description, request.agent_instructions],
            id=workflow_id,
            task_queue=TASK_QUEUE,
        )

        print(f"Started workflow. ID={handle.id}, RunID={handle.result_run_id}")

        workflow_result = await handle.result()
        print(f"agent_360 refresh result: {workflow_result.get('agent_360_refresh')}")
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
            risk_rating_rationale=risk_result["Risk Rating Rationale"]
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


async def main():
    config = uvicorn.Config("services.app:app", host="0.0.0.0", port=int(os.getenv('fast_api_port', '80')), reload=False)
    server = uvicorn.Server(config)
    await server.serve()


if __name__ == "__main__":
    asyncio.run(main())
