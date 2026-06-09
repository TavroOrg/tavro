import os
import json
import time
from pathlib import Path
import uvicorn
import httpx
from typing import Dict, Any, Optional, List
from fastmcp import FastMCP
from starlette.routing import Route, Mount
from fastmcp.server.auth import MultiAuth
from starlette.responses import JSONResponse
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware
from fastmcp.server.auth.providers.google import GoogleProvider
# from fastmcp.server.auth.providers.aws import AWSCognitoProvider, AWSCognitoTokenVerifier
from mcp_server.zitadel_provider import TavroZitadelTokenVerifier, ZitadelProvider
from fastmcp.server.auth.auth import AccessToken    
from fastmcp.server.dependencies import get_access_token
from fastmcp.server.auth.providers.jwt import JWTVerifier  
from starlette.applications import Starlette
from contextlib import asynccontextmanager

from tavro_library.agent_library import AgentMetadataExporter
from tavro_library.users import get_approved_user

from utils.set_environment import set_environment



set_environment("mcp")
set_environment("oAuth")
set_environment("secrets")
set_environment("fastapi")

TAVRO_API_URL = os.getenv("TAVRO_API_URL", "http://tavro-api:8000")


def _load_zitadel_client_id_from_runtime_config() -> str:
    runtime_config_path = os.getenv(
        "TAVRO_RUNTIME_CONFIG_FILE",
        "/app/runtime/tavro-runtime-config.json",
    )
    should_wait = bool(os.getenv("TAVRO_RUNTIME_CONFIG_FILE"))
    attempts = 60 if should_wait else 1
    path = Path(runtime_config_path)

    for attempt in range(attempts):
        try:
            if path.exists():
                with path.open("r", encoding="utf-8") as f:
                    config = json.load(f)
                client_id = str(config.get("zitadelClientId", "")).strip()
                if client_id:
                    return client_id
        except Exception as exc:
            print(f"Failed to read ZITADEL runtime config from {path}: {exc}")

        if attempt < attempts - 1:
            time.sleep(1)

    return ""


_runtime_zitadel_client_id = _load_zitadel_client_id_from_runtime_config()
if _runtime_zitadel_client_id:
    os.environ["ZITADEL_CLIENT_ID"] = _runtime_zitadel_client_id
    print("ZITADEL_CLIENT_ID loaded from runtime config")

# ---------------------------
# Constants / deployment URLs
# ---------------------------
# Priority: mcp_root_url from config.yaml → fallback to http://localhost:<port>
_root_url_override = os.getenv("mcp_root_url", "").strip()
ROOT_URL = _root_url_override if _root_url_override else f"http://{os.getenv('mcp_host', 'localhost')}:{os.getenv('mcp_port', '9000')}"

GOOGLE_PREFIX = "/google"
# COGNITO_PREFIX = "/cognito"
ZITADEL_PREFIX = "/zitadel"
# GITHUB_PREFIX = "/github"
# AZURE_PREFIX  = "/azure"

# GITHUB_BASE_URL = f"{ROOT_URL}{GITHUB_PREFIX}"
# AZURE_BASE_URL  = f"{ROOT_URL}{AZURE_PREFIX}"
GOOGLE_BASE_URL = f"{ROOT_URL}{GOOGLE_PREFIX}"
# COGNITO_BASE_URL = f"{ROOT_URL}{COGNITO_PREFIX}"
ZITADEL_BASE_URL = f"{ROOT_URL}{ZITADEL_PREFIX}"


MCP_PATH = "/mcp"


# ---------------------------
# CORS
# ---------------------------
middleware = [
    Middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["mcp-session-id"],
        max_age=600,
    )
]

# # -----------------------------------------------------------------------
# #  NEW: Custom Cognito token verifier — preserves email from JWT claims
# # -----------------------------------------------------------------------
# class TavroCognitoTokenVerifier(AWSCognitoTokenVerifier):    
#     async def verify_token(self, token: str) -> AccessToken | None:
#         import httpx

#         access_token = await super().verify_token(token)
#         if access_token is None:
#             return None
    
#         email = None
#         email_verified = None
#         try:
#             userinfo_url = f"{os.getenv('COGNITO_HOSTED_UI')}/oauth2/userInfo"
#             async with httpx.AsyncClient() as client:
#                 resp = await client.get(
#                     userinfo_url,
#                     headers={"Authorization": f"Bearer {token}"},
#                     timeout=5.0,
#                 )                
#                 if resp.status_code == 200:
#                     userinfo = resp.json()
#                     email = userinfo.get("email")
#                     email_verified = userinfo.get("email_verified")
#                 else:
#                     print(f"[DEBUG] UserInfo returned {resp.status_code}: {resp.text}")
#         except Exception as e:
#             print(f"[DEBUG] UserInfo fetch failed: {e}")

#         # Resolve tenant and enrich claims.
#         approved_user = await get_approved_user(email)       
        
#         if approved_user is None:
#             return None
        
#         enriched_claims = {
#             **(access_token.claims or {}),
#             "email": email,
#             "email_verified": email_verified,
#             "tenant_id": approved_user.tenant_id,
#         }
#         print(f"[DEBUG] ===== AUTH SUCCESS =====")
#         print(f"  sub     : {enriched_claims.get('sub')}")
#         print(f"  username: {enriched_claims.get('username')}")
#         print(f"  email   : {enriched_claims.get('email')}")
#         print(f"  tenant_id: {enriched_claims.get('tenant_id')}")
#         return AccessToken(
#             token=access_token.token,
#             client_id=access_token.client_id,
#             scopes=access_token.scopes,
#             expires_at=access_token.expires_at,
#             claims=enriched_claims,            
#         )


# # -----------------------------------------------------------------------
# # Custom Cognito provider — fixes audience + wires in our verifier
# # -----------------------------------------------------------------------
# class TavroCognitoProvider(AWSCognitoProvider):
#     def debug_oidc_config(self):
#         """Call this once to inspect what endpoints Cognito OIDC exposes."""
#         cfg = self.oidc_config
#         print("[OIDC CONFIG]")
#         print(f"  issuer        : {cfg.issuer}")
#         print(f"  userinfo_url  : {cfg.userinfo_endpoint}")
#         print(f"  jwks_uri      : {cfg.jwks_uri}")
#         print(f"  token_endpoint: {cfg.token_endpoint}")

#     def get_token_verifier(
#         self,
#         *,
#         algorithm=None,
#         audience=None,
#         required_scopes=None,
#         timeout_seconds=None,
#     ) -> TavroCognitoTokenVerifier:
#         return TavroCognitoTokenVerifier(
#             issuer=str(self.oidc_config.issuer),            
#             audience=audience or self.client_id,
#             algorithm=algorithm,
#             jwks_uri=str(self.oidc_config.jwks_uri),
#             required_scopes=required_scopes,
#         )

# ---------------------------
# Shared tools (define once)
# ---------------------------
core = FastMCP("Tavro MCP Core")

def log_tool_call(
    tool_name: str,
    original_prompt: str,
    arguments: Dict[str, Any],
    tenant_id: Optional[str],
) -> None:
    try:
        payload = {"original_prompt": original_prompt}
        if arguments:
            payload.update(arguments)

        AgentMetadataExporter.execute_dml(
            """
            INSERT INTO raw.run_time_logs (tenant_id, tool_name, arguments, created_ts)
            VALUES (%s, %s, %s, NOW())
            """,
            (
                str(tenant_id) if tenant_id is not None else None,
                tool_name,
                json.dumps(payload, default=str),
            ),
        )
    except Exception as e:
        print(f"[LOG ERROR] Failed to write log for {tool_name}: {e}")

@core.tool(name="get_agent_card")
async def get_agent_card(original_prompt: str,agent_name: Optional[str] = None, agent_id: Optional[str] = None) -> Dict[str, Any]:
    """
    Retrieve the full agent card metadata and risk summary for a specific AI agent by name.

    This tool returns the complete set of attributes for the given AI agent,
    including capabilities, modes, metadata, identification, risk assessment,
    provider information, transport/protocol details, and versioning.

    Use this tool whenever detailed information about a particular AI agent is requested.

    Args:
     original_prompt (str): REQUIRED. Copy the user's EXACT verbatim message here word-for-word.
                               Do NOT leave empty, summarize, or paraphrase.
                               Example: if the user typed "get agent card for LinkedIn", set this to "get agent card for LinkedIn".
        agent_name (str, optional): The exact name of the AI agent.
                          Example: "LinkedIn Hiring Assistant"
        or
        agent_id (str, optional): The unique identifier of the AI agent.
                            Example: "c536dfxyzb0462101163f306cad0c123"

    Returns:
        dict: Full agent card JSON on success.
              On failure, returns a dict with 'error' and 'details' keys:
                - VALIDATION_ERROR : agent_name is empty or invalid
                - NOT_FOUND        : no agent card exists for the specified name
                - INTERNAL_ERROR   : unexpected server error
    """
    print("Agent Card requested")
    try:
        token = get_access_token()
        tenant_id = token.claims.get("tenant_id") if token else None
        log_tool_call(
            "get_agent_card",
            original_prompt,
            {
                "agent_name": agent_name,
                "agent_id": agent_id,
            },
            tenant_id,
        )

        result = AgentMetadataExporter.get_agent_card(agent_name=agent_name, agent_id=agent_id, tenant_id=str(tenant_id))
        if result is None:
            return {"error": "NOT_FOUND", "details": f"No agent found with name '{agent_name}'"}

        return result

    except ValueError as ve:
        print("Validation error: %s", ve)
        return {"error": "VALIDATION_ERROR", "details": str(ve)}

    except Exception as e:
        print("Unexpected error")
        return {"error": "INTERNAL_ERROR", "details": str(e)}

@core.tool(name="get_agent_catalog")
async def get_agent_catalog(original_prompt: str, start_record: int = 1, record_range: str = "1-10") -> Dict[str, Any]:
    """
    Retrieve a limited set of agent records in a lightweight catalog view.

    This tool returns a paginated list of agent metadata, designed for efficient
    browsing and quick inspection. It provides a simplified representation of each
    agent by including only the most relevant and commonly used attributes.

    For each agent entry, the response includes:
    - top-level attributes

    This tool is ideal for listing agents, exploring available entries, or
    implementing pagination in user interfaces or downstream systems.

    Args:
        original_prompt (str): REQUIRED. Copy the user's EXACT verbatim message here word-for-word.
                               Do NOT leave empty, summarize, or paraphrase.
                               Example: if the user typed "show me all agents", set this to "show me all agents".
        start_record (int): Starting record number (1-based). Default is 1.
        record_range (str, optional): Inclusive range in "start-end" format.
                                    Example: "1-10", "20-30".

    Returns:
        Dict[str, Any]: A lightweight catalog response containing:
            - paginated agent records
            - pagination metadata (start_record, end_record, record_range, etc.)

    Errors:
        - VALIDATION_ERROR : Invalid input parameters
        - INTERNAL_ERROR   : Unexpected processing error
    """
    print("Agent Catalog requested")
    
    try:
        token = get_access_token()
        tenant_id = token.claims.get("tenant_id") if token else None
        log_tool_call(
            "get_agent_catalog",
            original_prompt,
            {
                "start_record": start_record,
                "record_range": record_range,
            },
            tenant_id,
        )

        headers = {"x-tenant-id": str(tenant_id)} if tenant_id else {}
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                f"{TAVRO_API_URL}/api/v1/agents/",
                params={"start_record": start_record, "record_range": record_range},
                headers=headers,
            )
            resp.raise_for_status()
            result = resp.json()

        return result

    except ValueError as ve:
        print("Validation error: %s", ve)
        return {"error": "VALIDATION_ERROR", "details": str(ve)}

    except Exception as e:
        print("Unexpected error")
        return {"error": "INTERNAL_ERROR", "details": str(e)}

@core.tool(name="create_agent")
async def create_agent(original_prompt: str, *, agent_name: str, description: str, instruction: str, tools: Optional[List[Dict[str, str]]] = None, knowledge_source: Optional[Dict[str, str]] = None, data_sources: Optional[List[Dict]] = None, issues: Optional[List[Dict]] = None) -> Dict[str, Any]:
    """
    Create and register a new AI agent with defined identity, behavior, and optional integrations.

    This function initializes an agent by capturing its core configuration, including its
    name, purpose, and operational instructions. The agent can optionally be extended with
    external tools, knowledge sources, data source definitions, and associated issues.
    The `instruction` parameter defines the agent’s behavior and decision-making logic,
    guiding how it processes inputs and generates responses.

    Optional integrations:
    - `tools`: A list of tools the agent can use. Each tool must be a dict with:
        {"name": str, "description": str}

    - `knowledge_source`: An external knowledge source the agent can reference:
        {"name": str, "description": str}

    - `data_sources`: Defines the Agent → Table → Column data-lineage hierarchy.
      Each entry represents one table and its columns:
        {
            "table_name":   str,            (required)
            "table_domain": str | null,     (optional)
            "access_level": str | null,     (optional)
            "columns": [
                {"column_name": str, "column_domain": str | null},
                ...
            ]
        }

    - `issues`: A list of issues associated with the agent. Each issue supports:
        {
            "title":            str,            (required) — short human-readable summary of the issue
            "description":      str | null,     (optional) — detailed explanation of what was observed and why it was flagged
            "issue_type":       str | null,     (optional) — category: "Hallucination", "Tool Failure", "Latency Breach", "Drift Violation", "Guardrail Trigger", "Data Quality", "Authorization Failure", "Output Policy Violation", "Risk Management", "Fraud Detection", "Customer Engagement"
            "severity":         str | null,     (optional) — impact level: "Critical", "High", "Medium", "Low", "Informational"
            "source":           str | null,     (optional) — detection mechanism: "Evaluation Framework", "Alert Monitor", "Drift Detector", "Manual Review"
            "detected_at":      str | null,     (optional) — ISO 8601 UTC timestamp when the issue was first detected
            "resolved_at":      str | null,     (optional) — ISO 8601 UTC timestamp when the issue was resolved or closed
            "status":           str | null,     (optional) — current state: "Open", "In Progress", "Resolved", "Dismissed", "Escalated"
            "resolution_notes": str | null,     (optional) — action taken to resolve or reason for dismissal
            "assignee":         str | null,     (optional) — team member or team responsible for investigating and resolving
            "owner":            str | null,     (optional) — team or individual accountable for the agent where the issue occurred
        }

    Args:
        original_prompt (str): REQUIRED. Copy the user’s EXACT verbatim message here word-for-word.
                               Do NOT leave empty, summarize, or paraphrase.
                               Example: if the user typed "create an agent called X that does Y", set this to "create an agent called X that does Y".
        agent_name (str): Unique name of the agent.
        description (str): Brief description of the agent’s purpose.
        instruction (str): Behavioral instructions that define how the agent operates.
                           IMPORTANT: Do NOT invent or reference other agent names (e.g. "Intelligence Agent",
                           "Revenue Agent") unless the user has explicitly named them or they are confirmed to
                           exist in the catalog context. If the agent coordinates with upstream agents, describe
                           their roles generically (e.g. "upstream analytical agents") rather than fabricating names.
        tools (Optional[List[Dict[str, str]]]): Optional list of tool definitions.
        knowledge_source (Optional[Dict[str, str]]): Optional knowledge source definition.
        data_sources (Optional[List[Dict]]): Optional data source table/column definitions.
        issues (Optional[List[Dict]]): Optional list of issues to associate with the agent.

    Returns:
        Dict[str, Any]: A response containing agent metadata or error details.
    """
    print("Create agent requested")

    try:
        token = get_access_token()
        tenant_id = token.claims.get("tenant_id") if token else None
        log_tool_call(
            "create_agent",
            original_prompt,
            {
                "agent_name": agent_name,
                "description": description,
                "instruction": instruction,
                "tools": tools,
                "knowledge_source": knowledge_source,
                "data_sources": data_sources,
                "issues": issues,
            },
            tenant_id,
        )

        result = AgentMetadataExporter.create_agent(
            agent_name=agent_name,
            description=description,
            instruction=instruction,
            tools=tools,
            knowledge_source=knowledge_source,
            tenant_id=tenant_id,
            data_sources=data_sources,
            issues=issues,
        )
        return result

    except ValueError as ve:
        print("Validation error: %s", ve)
        return {"error": "VALIDATION_ERROR", "details": str(ve)}

    except Exception as e:
        print("Unexpected error")
        return {"error": "INTERNAL_ERROR", "details": str(e)}

@core.tool(name="create_risk_assessment")
async def create_risk_assessment(original_prompt: str, *, agent_id: str) -> Dict[str, Any]:
    """
    Create a risk assessment for an existing agent by taking input as agent_id.
    Args:
        original_prompt (str): REQUIRED. Copy the user's EXACT verbatim message here word-for-word.
                               Do NOT leave empty, summarize, or paraphrase.
                               Example: if the user typed "create risk assessment for agent abc123", set this to "create risk assessment for agent abc123".
        agent_id (str): The unique identifier of the agent for which the risk assessment is to be created.
    This tool fetches the agent's metadata and triggers the risk assessment.
    """
    print(f"Create risk assessment requested for agent_id={agent_id}")
    
    try:
        token = get_access_token()
        tenant_id = token.claims.get("tenant_id") if token else None
        log_tool_call(
            "create_risk_assessment",
            original_prompt,
            {"agent_id": agent_id},
            tenant_id,
        )

        return AgentMetadataExporter.create_risk_assessment_from_agent_id(agent_id=agent_id, tenant_id=tenant_id)

    except ValueError as ve:
        print("Validation error: %s", ve)
        return {"error": "VALIDATION_ERROR", "details": str(ve)}

    except Exception as e:
        print("Unexpected error")
        return {"error": "INTERNAL_ERROR", "details": str(e)}

@core.tool(name="create_ai_use_case")
async def create_ai_use_case(original_prompt: str, *, title: str, description: str, business_problem_statement: str, expected_benefits: str, priority: str, regulatory_impact: Optional[List[str]] = None, solution_approach: Optional[str] = None, use_case_owner: Optional[str] = None, impacted_business_applications: Optional[List[str]] = None, impacted_business_processes: Optional[List[str]] = None) -> Dict[str, Any]:
    """
    Register a new AI Use Case to establish governance and business context.

    This function creates a new AI use case record, capturing key business and technical details needed for oversight, risk assessment, and lifecycle management. It helps align system capabilities with intended business outcomes and supports governance processes.

    Args:
    original_prompt (str): REQUIRED. Copy the user's EXACT verbatim message here word-for-word.
                           Do NOT leave empty, summarize, or paraphrase.
                           Example: if the user typed "create a use case for fraud detection", set this to "create a use case for fraud detection".
    title (str): Mandatory. The formal name of the AI use case.
    description (str): Mandatory. A high-level overview of the use case functionality.
    business_problem_statement (str): Mandatory. The specific problem or opportunity being addressed.
    expected_benefits (str): Mandatory. The anticipated value or outcomes (e.g., efficiency gains, cost reduction).
    priority (str): Mandatory. Business criticality (e.g., 'Critical', 'High', 'Medium', 'Low').
    regulatory_impact (List[str], optional): Applicable regulatory or compliance considerations.
    solution_approach (str, optional): The technical approach or methodology.
    use_case_owner (str, optional): Responsible individual or team.
    impacted_business_applications (List[str], optional): Systems or applications involved.
    impacted_business_processes (List[str], optional): Business workflows affected.

    Returns:

    Dict[str, Any]: The created use case record, including a unique identifier and metadata for tracking relationships with associated components or agents.
    """
    print("Create AI Use Case requested")
    
    try:
        token = get_access_token()
        tenant_id = token.claims.get("tenant_id") if token else None
        log_tool_call(
            "create_ai_use_case",
            original_prompt,
            {
                "title": title,
                "description": description,
                "business_problem_statement": business_problem_statement,
                "expected_benefits": expected_benefits,
                "priority": priority,
                "regulatory_impact": regulatory_impact,
                "solution_approach": solution_approach,
                "use_case_owner": use_case_owner,
                "impacted_business_applications": impacted_business_applications,
                "impacted_business_processes": impacted_business_processes,
            },
            tenant_id,
        )
        
        payload: Dict[str, Any] = {
            "title": title,
            "description": description,
            "business_problem_statement": business_problem_statement,
            "expected_benefits": expected_benefits,
            "priority": priority,
        }
        if regulatory_impact is not None:
            payload["regulatory_impact"] = regulatory_impact
        if solution_approach is not None:
            payload["solution_approach"] = solution_approach
        if use_case_owner is not None:
            payload["use_case_owner"] = use_case_owner
        if impacted_business_applications is not None:
            payload["impacted_business_applications"] = impacted_business_applications
        if impacted_business_processes is not None:
            payload["impacted_business_processes"] = impacted_business_processes

        headers = {"x-tenant-id": str(tenant_id), "Content-Type": "application/json"} if tenant_id else {"Content-Type": "application/json"}
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{TAVRO_API_URL}/api/v1/use-cases/",
                json=payload,
                headers=headers,
            )
            resp.raise_for_status()
            api_result = resp.json()

        result = {
            "message": api_result.get("message", "AI Use Case created successfully."),
            "identifier": api_result.get("use_case_id"),
            "use_case_id": api_result.get("use_case_id"),
            "name": title,
        }
        print(result)
        return result

    except ValueError as ve:
        print("Validation error: %s", ve)
        return {"error": "VALIDATION_ERROR", "details": str(ve)}

    except Exception as e:
        print("Unexpected error")
        return {"error": "INTERNAL_ERROR", "details": str(e)}

@core.tool(name="get_ai_use_case")
async def get_ai_use_case(original_prompt: str, *, use_case_id: Optional[str] = None, title: Optional[str] = None, start_record: int = 1, record_range: str = "1-10") -> Dict[str, Any]:
    """
    This function fetches AI use case records from a data source. You can filter results using identifiers or titles, and control pagination using record position and range parameters.

    NOTE: Always pass `original_prompt` as the user's exact input. Do not omit or summarize it.
    Args:
    original_prompt (str): REQUIRED. Copy the user's EXACT verbatim message here word-for-word.
                           Do NOT leave empty, summarize, or paraphrase.
                           Example: if the user typed "get use case TAV01", set this to "get use case TAV01".
    use_case_id (str, optional): Unique identifier for the use case.
    title (str, optional): Title of the use case (supports partial matching).
    start_record (int, optional): Starting record number (1-based). Defaults to 1.
    record_range (str, optional): Inclusive range in "start-end" format. Defaults to "1-10".

    

    Returns:

    Dict[str, Any]: A collection of matching AI use case records along with pagination metadata, including:
    start_record
    end_record
    max_records
    record_range
    total_records
    """
    print(f"Get AI Use Case requested | use_case_id={use_case_id} title={title} start={start_record} range={record_range} prompt={original_prompt}")
    
    try:
        token = get_access_token()
        tenant_id = token.claims.get("tenant_id") if token else None
        log_tool_call(
            "get_ai_use_case",
            original_prompt,
            {
                "use_case_id": use_case_id,
                "title": title,
                "start_record": start_record,
                "record_range": record_range,
            },
            tenant_id,
        )
           
        headers = {"x-tenant-id": str(tenant_id)} if tenant_id else {}
        async with httpx.AsyncClient(timeout=30.0) as client:
            if use_case_id:
                resp = await client.get(
                    f"{TAVRO_API_URL}/api/v1/use-cases/{use_case_id}",
                    headers=headers,
                )
            else:
                params: Dict[str, Any] = {
                    "start_record": start_record,
                    "record_range": record_range,
                }
                if title:
                    params["title"] = title
                resp = await client.get(
                    f"{TAVRO_API_URL}/api/v1/use-cases/",
                    params=params,
                    headers=headers,
                )
            resp.raise_for_status()
            result = resp.json()

        return result

    except ValueError as ve:
        print("Validation error: %s", ve)
        return {"error": "VALIDATION_ERROR", "details": str(ve)}

    except Exception as e:
        print("Unexpected error")
        return {"error": "INTERNAL_ERROR", "details": str(e)}

@core.tool(name="create_ai_use_case_agent_relationship")
async def create_ai_use_case_agent_relationship(original_prompt: str, *, agent_catalog_id: str, ai_use_case_id: str) -> Dict[str, Any]:
    """
    Create/Register a relationship between an AI Use Case and an Agent.

    The tool resolves both IDs to internal records and creates the relationship.

    Args:
        original_prompt (str): REQUIRED. Copy the user's EXACT verbatim message here word-for-word.
                               Do NOT leave empty, summarize, or paraphrase.
                               Example: if the user typed "link agent X to use case Y", set this to "link agent X to use case Y".
        agent_catalog_id (str): Agent Catalog ID.
        ai_use_case_id (str): AI Use Case ID.

    Returns:
        Dict[str, Any]: Relationship creation response.
    """
    print(f"Create AI Use Case-Agent relationship requested for agent_catalog_id={agent_catalog_id} ai_use_case_id={ai_use_case_id}")
    
    try:
        token = get_access_token()
        tenant_id = token.claims.get("tenant_id") if token else None
        log_tool_call(
            "create_ai_use_case_agent_relationship",
            original_prompt,
            {
                "agent_catalog_id": agent_catalog_id,
                "ai_use_case_id": ai_use_case_id,
            },
            tenant_id,
        )
        
        result = AgentMetadataExporter.create_ai_use_case_agent_relationship(
            agent_catalog_id=agent_catalog_id,
            ai_use_case_id=ai_use_case_id,
            tenant_id=str(tenant_id),
        )
        return result

    except ValueError as ve:
        print("Validation error: %s", ve)
        return {"error": "VALIDATION_ERROR", "details": str(ve)}

    except Exception as e:
        print("Unexpected error")
        return {"error": "INTERNAL_ERROR", "details": str(e)}

@core.tool(name="remove_ai_use_case_agent_relationship")
async def remove_ai_use_case_agent_relationship(original_prompt: str, *, agent_catalog_id: str, ai_use_case_id: str) -> Dict[str, Any]:
    """
    Remove an existing relationship between an AI Use Case and an Agent.

    Args:
        original_prompt (str): REQUIRED. Copy the user's EXACT verbatim message here word-for-word.
        agent_catalog_id (str): Agent Catalog ID.
        ai_use_case_id (str): AI Use Case ID.

    Returns:
        Dict[str, Any]: Relationship removal response.
    """
    print(f"Remove AI Use Case-Agent relationship requested for agent_catalog_id={agent_catalog_id} ai_use_case_id={ai_use_case_id}")

    try:
        token = get_access_token()
        tenant_id = token.claims.get("tenant_id") if token else None
        log_tool_call(
            "remove_ai_use_case_agent_relationship",
            original_prompt,
            {
                "agent_catalog_id": agent_catalog_id,
                "ai_use_case_id": ai_use_case_id,
            },
            tenant_id,
        )

        result = AgentMetadataExporter.remove_ai_use_case_agent_relationship(
            agent_catalog_id=agent_catalog_id,
            ai_use_case_id=ai_use_case_id,
            tenant_id=str(tenant_id),
        )
        return result

    except ValueError as ve:
        print("Validation error: %s", ve)
        return {"error": "VALIDATION_ERROR", "details": str(ve)}

    except Exception as e:
        print("Unexpected error")
        return {"error": "INTERNAL_ERROR", "details": str(e)}

@core.tool(name="update_agent")
async def update_agent(original_prompt: str, *, agent_id: Optional[str] = None, agent_name: Optional[str] = None, description: Optional[str] = None, instruction: Optional[str] = None, tools: Optional[List[Dict[str, str]]] = None, knowledge_source: Optional[Dict[str, str]] = None, data_sources: Optional[List[Dict]] = None, issues: Optional[List[Dict]] = None) -> Dict[str, Any]:
    """
    Update an existing AI agent’s configuration.

    Only provided fields are changed. Omitting a field leaves it unchanged.

    - `data_sources`: When provided, **replaces** all existing data-source
      relationships for this agent. Pass an empty list [] to clear them all.
      Format per entry:
        {
            "table_name":   str,            (required)
            "table_domain": str | null,     (optional)
            "access_level": str | null,     (optional)
            "columns": [
                {"column_name": str, "column_domain": str | null},
                ...
            ]
        }

    - `issues`: When provided, **replaces** all existing issues for this agent.
      Pass an empty list [] to clear all issues. Each entry supports:
        {
            "identifier":       str | null,     (optional) — preserve existing UUID to keep detail-page URLs stable
            "title":            str,            (required) — short human-readable summary of the issue
            "description":      str | null,     (optional) — detailed explanation of what was observed and why it was flagged
            "issue_type":       str | null,     (optional) — category: "Hallucination", "Tool Failure", "Latency Breach", "Drift Violation", "Guardrail Trigger", "Data Quality", "Authorization Failure", "Output Policy Violation", "Risk Management", "Fraud Detection", "Customer Engagement"
            "severity":         str | null,     (optional) — impact level: "Critical", "High", "Medium", "Low", "Informational"
            "source":           str | null,     (optional) — detection mechanism: "Evaluation Framework", "Alert Monitor", "Drift Detector", "Manual Review"
            "detected_at":      str | null,     (optional) — ISO 8601 UTC timestamp when the issue was first detected
            "resolved_at":      str | null,     (optional) — ISO 8601 UTC timestamp when the issue was resolved or closed
            "status":           str | null,     (optional) — current state: "Open", "In Progress", "Resolved", "Dismissed", "Escalated"
            "resolution_notes": str | null,     (optional) — action taken to resolve or reason for dismissal
            "assignee":         str | null,     (optional) — team member or team responsible for investigating and resolving
            "owner":            str | null,     (optional) — team or individual accountable for the agent where the issue occurred
        }
      Omit to leave existing issues unchanged.

    Args:
        original_prompt (str): REQUIRED. Exact user message verbatim.
        agent_id (Optional[str]): Unique identifier of the agent to update.
        agent_name (Optional[str]): New agent name.
        description (Optional[str]): Updated description.
        instruction (Optional[str]): Updated behavior instructions. Do NOT invent or reference
                           other agent names unless the user has explicitly named them or they are
                           confirmed to exist. Describe inter-agent dependencies generically if unknown.
        tools (Optional[List[Dict[str, str]]]): Updated tool list. When provided, replaces all existing tools.
        knowledge_source (Optional[Dict[str, str]]): Updated knowledge source.
        data_sources (Optional[List[Dict]]): Replacement data source table/column definitions.
                                             Omit to leave existing data sources unchanged.
        issues (Optional[List[Dict]]): Replacement issue list. When provided, replaces all existing issues.
                                       Omit to leave existing issues unchanged.

    Returns:
        Dict[str, Any]: Updated agent metadata or error response.
    """
    print("Update agent requested")

    try:
        token = get_access_token()
        tenant_id = token.claims.get("tenant_id") if token else None

        log_tool_call(
            "update_agent",
            original_prompt,
            {
                "agent_id": agent_id,
                "agent_name": agent_name,
                "description": description,
                "instruction": instruction,
                "tools": tools,
                "knowledge_source": knowledge_source,
                "data_sources": data_sources,
                "issues": issues,
            },
            tenant_id,
        )

        result = AgentMetadataExporter.update_agent(
            agent_id=agent_id,
            agent_name=agent_name,
            description=description,
            instruction=instruction,
            tools=tools,
            knowledge_source=knowledge_source,
            tenant_id=str(tenant_id),
            data_sources=data_sources,
            issues=issues,
        )

        return result

    except ValueError as ve:
        return {"error": "VALIDATION_ERROR", "details": str(ve)}
    except Exception as e:
        return {"error": "INTERNAL_ERROR", "details": str(e)}

@core.tool(name="update_ai_use_case")
async def update_ai_use_case(original_prompt: str, *, use_case_id: Optional[str] = None, title: str, description: str, business_problem_statement: str, expected_benefits: str, priority: str, regulatory_impact: Optional[List[str]] = None, solution_approach: Optional[str] = None, use_case_owner: Optional[str] = None, impacted_business_applications: Optional[List[str]] = None, impacted_business_processes: Optional[List[str]] = None) -> Dict[str, Any]:
    """
    Update an existing AI use case definition.

    Args:
        original_prompt (str): REQUIRED verbatim user message.
        use_case_id (Optional[str]): ID of the AI use case.
        title (str): Updated title.
        description (str): Updated description.
        business_problem_statement (str): Updated business problem statement.
        expected_benefits (str): Updated expected benefits.
        priority (str): Updated priority.
        regulatory_impact (Optional[List[str]]): Updated regulatory impact.
        solution_approach (Optional[str]): Updated solution approach.
        use_case_owner (Optional[str]): Updated use case owner.
        impacted_business_applications (Optional[List[str]]): Updated impacted business applications.
        impacted_business_processes (Optional[List[str]]): Updated impacted business processes.

    Returns:
        Dict[str, Any]
    """
    print("Update AI use case requested")

    try:
        token = get_access_token()
        tenant_id = token.claims.get("tenant_id") if token else None

        log_tool_call(
            "update_ai_use_case",
            original_prompt,
            {
                "use_case_id": use_case_id,
                "name": title,
                "description": description,
                "business_problem_statement": business_problem_statement,
                "expected_benefits": expected_benefits,
                "priority": priority,
                "regulatory_impact": regulatory_impact,
                "solution_approach": solution_approach,
                "use_case_owner": use_case_owner,
                "impacted_business_applications": impacted_business_applications,
                "impacted_business_processes": impacted_business_processes,
            },
            tenant_id,
        )

        result = AgentMetadataExporter.update_ai_use_case(
            use_case_id=use_case_id,
            name=title,
            description=description,
            business_problem_statement=business_problem_statement,
            expected_benefits=expected_benefits,
            priority=priority,
            regulatory_impact=regulatory_impact,
            solution_approach=solution_approach,
            use_case_owner=use_case_owner,
            impacted_business_applications=impacted_business_applications,
            impacted_business_processes=impacted_business_processes,
            tenant_id=str(tenant_id),
        )

        return result

    except ValueError as ve:
        return {"error": "VALIDATION_ERROR", "details": str(ve)}
    except Exception as e:
        return {"error": "INTERNAL_ERROR", "details": str(e)}

@core.tool(name="get_application_catalog")
async def get_application_catalog(original_prompt: str, start_record: int = 1, record_range: str = "1-10") -> Dict[str, Any]:
    """
    Retrieve paginated application catalog.

    Args:
        original_prompt (str): REQUIRED verbatim user message.
        start_record (int): Starting index.
        record_range (str): Range like "1-10".

    Returns:
        Dict[str, Any]
    """
    print("Application catalog requested")

    try:
        token = get_access_token()
        tenant_id = token.claims.get("tenant_id") if token else None

        log_tool_call(
            "get_application_catalog",
            original_prompt,
            {
                "start_record": start_record,
                "record_range": record_range,
            },
            tenant_id,
        )

        result = AgentMetadataExporter.get_application_catalog(
            start_record=start_record,
            record_range=record_range,
            tenant_id=str(tenant_id),
        )

        return result

    except ValueError as ve:
        return {"error": "VALIDATION_ERROR", "details": str(ve)}
    except Exception as e:
        return {"error": "INTERNAL_ERROR", "details": str(e)}

@core.tool(name="get_process_catalog")
async def get_process_catalog(original_prompt: str, start_record: int = 1, record_range: str = "1-10") -> Dict[str, Any]:
    """
    Retrieve paginated process catalog.

    Args:
        original_prompt (str): REQUIRED verbatim user message.
        start_record (int): Start index.
        record_range (str): Range like "1-10".

    Returns:
        Dict[str, Any]
    """
    print("Process catalog requested")

    try:
        token = get_access_token()
        tenant_id = token.claims.get("tenant_id") if token else None

        log_tool_call(
            "get_process_catalog",
            original_prompt,
            {
                "start_record": start_record,
                "record_range": record_range,
            },
            tenant_id,
        )

        result = AgentMetadataExporter.get_process_catalog(
            start_record=start_record,
            record_range=record_range,
            tenant_id=str(tenant_id),
        )

        return result

    except ValueError as ve:
        return {"error": "VALIDATION_ERROR", "details": str(ve)}
    except Exception as e:
        return {"error": "INTERNAL_ERROR", "details": str(e)}

@core.tool(name="create_company")
async def create_company(original_prompt: str, *, name: str, industry: str, region: str, legal_entity: str) -> Dict[str, Any]:
    """
    Create a new company entity.

    Args:
        original_prompt (str): REQUIRED verbatim user message.
        name (str): Company name.
        industry (str): Company industry.
        region (str): Company region.
        legal_entity (str): Legal entity information.

    Returns:
        Dict[str, Any]
    """
    try:
        token = get_access_token()
        tenant_id = token.claims.get("tenant_id") if token else None

        log_tool_call(
            "create_company",
            original_prompt,
            {
                "name": name,
                "industry": industry,
                "region": region,
                "legal_entity": legal_entity,
            },
            tenant_id,
        )

        result = AgentMetadataExporter.create_company(
            name=name,
            industry=industry,
            region=region,
            legal_entity=legal_entity,
            tenant_id=str(tenant_id),
        )

        return result

    except ValueError as ve:
        return {"error": "VALIDATION_ERROR", "details": str(ve)}
    except Exception as e:
        return {"error": "INTERNAL_ERROR", "details": str(e)}

@core.tool(name="get_company")
async def get_company(original_prompt: str, *, company_id: str) -> Dict[str, Any]:
    """
    Retrieve a company by ID.

    Args:
        original_prompt (str): REQUIRED verbatim user message.
        company_id (str): Company identifier.

    Returns:
        Dict[str, Any]
    """
    try:
        token = get_access_token()
        tenant_id = token.claims.get("tenant_id") if token else None

        log_tool_call(
            "get_company",
            original_prompt,
            {"company_id": company_id},
            tenant_id,
        )

        return AgentMetadataExporter.get_company(
            company_id=company_id,
            tenant_id=str(tenant_id),
        )

    except ValueError as ve:
        return {"error": "VALIDATION_ERROR", "details": str(ve)}
    except Exception as e:
        return {"error": "INTERNAL_ERROR", "details": str(e)}

@core.tool(name="update_company")
async def update_company(original_prompt: str, *, company_id: str, name: Optional[str] = None, industry: Optional[str] = None, region: Optional[str] = None, legal_entity: Optional[str] = None) -> Dict[str, Any]:
    """
    Update an existing company entity.

    Args:
        original_prompt (str): REQUIRED verbatim user message.
        company_id (str): Company identifier.
        name (Optional[str]): Updated name.
        industry (Optional[str]): Updated industry.
        region (Optional[str]): Updated region.
        legal_entity (Optional[str]): Updated legal entity information.

    Returns:
        Dict[str, Any]
    """
    try:
        token = get_access_token()
        tenant_id = token.claims.get("tenant_id") if token else None

        log_tool_call(
            "update_company",
            original_prompt,
            {
                "company_id": company_id,
                "name": name,
                "industry": industry,
                "region": region,
                "legal_entity": legal_entity,
            },
            tenant_id,
        )

        # ---------------------------------------
        # 1. Fetch existing company
        # ---------------------------------------
        existing = AgentMetadataExporter.get_company(
            company_id=company_id,
            tenant_id=str(tenant_id),
        )

        # ---------------------------------------
        # 2. Merge (ONLY overwrite provided fields)
        # ---------------------------------------
        payload = {
            "name": name if name is not None else existing.get("name"),
            "industry": industry if industry is not None else existing.get("industry"),
            "region": region if region is not None else existing.get("region"),
            "legal_entity": legal_entity if legal_entity is not None else existing.get("legal_entity"),
        }

        # ---------------------------------------
        # 3. Call update API
        # ---------------------------------------
        result = AgentMetadataExporter.update_company(
            company_id=company_id,
            name=payload["name"],
            industry=payload["industry"],
            region=payload["region"],
            legal_entity=payload["legal_entity"],
            tenant_id=str(tenant_id),
        )

        return result

    except ValueError as ve:
        return {"error": "VALIDATION_ERROR", "details": str(ve)}
    except Exception as e:
        return {"error": "INTERNAL_ERROR", "details": str(e)}
# ---------------------------
# Shared JWT verifier
# ---------------------------
jwt_verifier = JWTVerifier(
    public_key=os.getenv("JWT_SIGNING_KEY"),
    algorithm="HS256",
)

# ---------------------------
# GitHub Auth + MCP
# ---------------------------
# github_auth = GitHubProvider(
#     client_id=os.getenv("GITHUB_CLIENT_ID"),
#     client_secret=os.getenv("GITHUB_CLIENT_SECRET"),
#     base_url=GITHUB_BASE_URL,
#     jwt_signing_key=os.getenv("JWT_SIGNING_KEY"),
#     required_scopes=["read:user"],
# )

# github_auth = MultiAuth(
#     server=github_auth,
#     verifiers=[jwt_verifier],
# )

# github_mcp = FastMCP("Tavro MCP Server (GitHub)", auth=github_auth)
# github_mcp.mount(core)

# # Generate GitHub ASGI sub-app with MCP mounted at /mcp
# github_app = github_mcp.http_app(path=MCP_PATH)

# ---------------------------
# Google Auth + MCP
# ---------------------------
google_auth = GoogleProvider(
    client_id=os.getenv("GOOGLE_CLIENT_ID"),
    client_secret=os.getenv("GOOGLE_CLIENT_SECRET"),
    base_url=GOOGLE_BASE_URL,
    jwt_signing_key=os.getenv("JWT_SIGNING_KEY"),
)

google_mcp = FastMCP("Tavro MCP Server (Google)", auth=google_auth)
google_mcp.mount(core)

google_app = google_mcp.http_app(path=MCP_PATH)

# ---------------------------
# Azure Provider + app
# ---------------------------
# REQUIRED by FastMCP AzureProvider
# azure_auth = AzureProvider(
#     client_id=os.getenv("AZURE_CLIENT_ID"),
#     client_secret=os.getenv("AZURE_CLIENT_SECRET"),
#     tenant_id=os.getenv("AZURE_TENANT_ID"),  # required (or "organizations"/"consumers")
#     base_url=AZURE_BASE_URL,  # includes /azure
#     jwt_signing_key=os.getenv("JWT_SIGNING_KEY"),
#     required_scopes=["read"],
# )

# azure_mcp = FastMCP("Tavro MCP Server (Azure)", auth=azure_auth)
# azure_mcp.mount(core)

# azure_app = azure_mcp.http_app(path=MCP_PATH)

# # ---------------------------
# # AWS Cognito Auth + MCP — now uses TavroCognitoProvider
# # ---------------------------
# cognito_auth = TavroCognitoProvider(
#     user_pool_id=os.getenv("COGNITO_USER_POOL_ID"),
#     client_id=os.getenv("COGNITO_CLIENT_ID"),
#     client_secret=os.getenv("COGNITO_CLIENT_SECRET"),
#     base_url=COGNITO_BASE_URL,
#     aws_region=os.getenv("COGNITO_AWS_REGION", "us-east-2"),
#     jwt_signing_key=os.getenv("JWT_SIGNING_KEY"),
# )

# cognito_auth_wrapped = MultiAuth(
#     server=cognito_auth,
#     verifiers=[jwt_verifier],
# )

# cognito_mcp = FastMCP("Tavro MCP Server (AWS Cognito)", auth=cognito_auth_wrapped)
# cognito_mcp.mount(core)
# cognito_app = cognito_mcp.http_app(path=MCP_PATH)

# ---------------------------
# Zitadel Auth + MCP — now uses ZitadelProvider
# ---------------------------
zitadel_auth = ZitadelProvider(
    issuer=os.getenv("ZITADEL_ISSUER", ""),
    client_id=os.getenv("ZITADEL_CLIENT_ID", ""),
    client_secret=os.getenv("ZITADEL_CLIENT_SECRET") or None,
    base_url=ZITADEL_BASE_URL,
    config_url=os.getenv("ZITADEL_CONFIG_URL") or None,
    jwt_signing_key=os.getenv("JWT_SIGNING_KEY"),
    required_scopes=os.getenv("ZITADEL_SCOPES", "openid profile email"),
    prompt=os.getenv("ZITADEL_PROMPT") or None,
    require_authorization_consent="external",
)

zitadel_auth_wrapped = MultiAuth(
    server=zitadel_auth,
    verifiers=[
        TavroZitadelTokenVerifier(
            provider=zitadel_auth,
            required_scopes=os.getenv("ZITADEL_SCOPES", "openid profile email").split(),
        )
    ],
)

zitadel_mcp = FastMCP(
    "Tavro MCP Server (ZITADEL)",
    auth=zitadel_auth_wrapped,
)

zitadel_mcp.mount(core)

zitadel_app = zitadel_mcp.http_app(path=MCP_PATH, json_response=True)

# ---------------------------
# Parent lifespan
# ---------------------------
@asynccontextmanager
async def lifespan(app: Starlette):
    async with (google_app.lifespan(app), zitadel_app.lifespan(app)):
        yield

# ---------------------------
# Root Starlette app
# ---------------------------
async def root_health(request):
    return JSONResponse({"status": "ok"})

routes = [
    Route("/health", root_health, methods=["GET"]),
    # Mount(COGNITO_PREFIX, app=cognito_app),
    # Mount(GITHUB_PREFIX, app=github_app),
    Mount(GOOGLE_PREFIX, app=google_app),
    # Mount(AZURE_PREFIX, app=azure_app),
    Mount(ZITADEL_PREFIX, app=zitadel_app),
]

app = Starlette(routes=routes, middleware=middleware, lifespan=lifespan)

# for r in github_auth.get_well_known_routes(mcp_path=MCP_PATH):
#     app.router.routes.append(r)

for r in google_auth.get_well_known_routes(mcp_path=MCP_PATH):
    app.router.routes.append(r)

# for r in azure_auth.get_well_known_routes(mcp_path=MCP_PATH):
#     app.router.routes.append(r)

# for r in cognito_auth_wrapped.get_well_known_routes(mcp_path=MCP_PATH):
#     app.router.routes.append(r)

for r in zitadel_auth_wrapped.get_well_known_routes(mcp_path=MCP_PATH):
    app.router.routes.append(r)

# ---------------------------
# Run
# ---------------------------
if __name__ == "__main__":
    print(f"Starting FastMCP server on port {os.getenv('mcp_port')}")
    try:
        uvicorn.run(app, host="0.0.0.0", port=int(os.getenv('mcp_port')))
    except Exception as e:
        print(f"Failed to start FastMCP server: {str(e)}")
        raise
