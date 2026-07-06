import os
import json
import time
import hashlib
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

TAVRO_API_URL = os.getenv("TAVRO_API_URL")
COPILOT_SERVER_URL = os.getenv("COPILOT_SERVER_URL")


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
ROOT_URL = _root_url_override if _root_url_override else f"http://{os.getenv('mcp_host', 'localhost')}:{os.getenv('mcp_port', '9001')}"

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
async def get_agent_card(original_prompt: str, *, agent_name: Optional[str] = None, agent_id: Optional[str] = None, company_id: Optional[str]) -> Dict[str, Any]:
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
        company_id (Optional[str]): REQUIRED. Active company UUID, or null if no company context is active.
                                    Returns agents for this company plus global agents (company_id IS NULL).

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
                "company_id": company_id,
            },
            tenant_id,
        )

        result = AgentMetadataExporter.get_agent_card(agent_name=agent_name, agent_id=agent_id, tenant_id=str(tenant_id), company_id=company_id)
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
async def get_agent_catalog(original_prompt: str, *, start_record: int = 1, record_range: str = "1-10", company_id: Optional[str]) -> Dict[str, Any]:
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
        company_id (Optional[str]): REQUIRED. Active company UUID, or null if no company context is active.
                                    Returns agents for this company plus global agents (company_id IS NULL).

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
                "company_id": company_id,
            },
            tenant_id,
        )

        params: Dict[str, Any] = {"start_record": start_record, "record_range": record_range}
        if company_id and company_id.strip():
            params["company_id"] = company_id.strip()
        headers = {"x-tenant-id": str(tenant_id)} if tenant_id else {}
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                f"{TAVRO_API_URL}/api/v1/agents/",
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


@core.tool(name="create_agent")
async def create_agent(
    original_prompt: str,
    *,
    agent_name: str,
    description: str,
    instruction: str,
    tools: Optional[List[Dict[str, Any]]] = None,
    tables: Optional[List[Dict[str, Any]]] = None,
    columns: Optional[List[Dict[str, Any]]] = None,
    data_source: Optional[List[Dict[str, Any]]] = None,
    knowledge_source: Optional[Dict[str, str]] = None,
    skills: Optional[List[Dict[str, Any]]] = None,
    company_id: Optional[str],
    company_name: Optional[str] = None,
    issues: Optional[List[Dict]] = None
) -> Dict[str, Any]:
    """
    Create and register a new AI agent with defined identity, behavior, and optional integrations.

    This function initializes an agent by capturing its core configuration, including its
    name, purpose, and operational instructions. The agent can optionally be extended with
    external tools, knowledge sources, skills, and data source definitions and associated issues.

    The `instruction` parameter defines the agent's behavior and decision-making logic,
    guiding how it processes inputs and generates responses.

    Optional integrations:
    - `tools`: A list of tools the agent can use. Each tool must be a dict with:
        {"name": str, "description": str}

    - `knowledge_source`: An external knowledge source the agent can reference:
        {"name": str, "description": str}

    - `skills`: A list of skill definitions the agent possesses. Each skill may be provided
    as a string name or as a dictionary with:
        {
            "name": str,
            "description": str,
            "tags": List[str],
            "inputModes": List[str],
            "outputModes": List[str]
        }
    The keys "identifier" or "skill_id" may be used to provide a stable skill ID.
    The snake_case keys "input_modes" and "output_modes" are also accepted.
    Skills are registered as part of the agent metadata.

    - `data_source`: Defines data-source relationships or the Agent -> Table -> Column
      data-lineage hierarchy. Each entry can represent one table and its columns:
        {
            "table_name": str,
            "table_domain": str | null,
            "access_level": str | null,
            "columns": [
                {"column_name": str, "column_domain": str | null},
                ...
            ]
        }
      A tool may optionally include table metadata it uses:
        {
            "name": str,
            "description": str,
            "table": {"name": str}
        }
      Column metadata must be passed through the top-level `columns` parameter,
      not nested inside tool table metadata.

    - `tables`: Optional explicit table metadata for the agent or tools:
        [
            {
                "name": str,
                "tool_name": str
            }
        ]
      Use `tool_name` when the table belongs to a specific tool.
      Omit `tool_name` for direct agent-owned tables. Direct tables are represented
      as Agent -> Table -> Column; tool-owned tables are represented as
      Agent -> Tool -> Table -> Column.

    - `columns`: Optional explicit column metadata for tables:
        [
            {
                "name": str,
                "table_name": str,
                "table_id": str
            }
        ]
      Use `table_name` or `table_id` to link each column to its table.

    - `data_source`: Optional relationship-style metadata using Agent/Tool/Table/Column
    source and target object fields.

    - `knowledge_source`: A reference to an external knowledge source that the agent can
    use for contextual understanding. If provided, it must follow:
        {
            "name": str,
            "description": str
        }

    All inputs are validated before agent creation. On success, the function returns a
    standardized response containing the agent’s metadata. In case of validation or
    runtime errors, an appropriate error response is returned.

    IMPORTANT — risk assessment is triggered automatically:
    This tool always starts a risk assessment in the background immediately after the agent
    is created. Do NOT call create_risk_assessment after this tool — doing so will cause a
    duplicate assessment. The risk assessment runs automatically; no separate tool call is
    needed.

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
        original_prompt (str): REQUIRED. Copy the user's EXACT verbatim message here word-for-word.
                               Do NOT leave empty, summarize, or paraphrase.
                               Example: if the user typed "create an agent called X that does Y", set this to "create an agent called X that does Y".
        agent_name (str): Unique name of the agent.
        description (str): Brief description of the agent's purpose.
        instruction (str): Behavioral instructions that define how the agent operates.
                           IMPORTANT: Do NOT invent or reference other agent names (e.g. "Intelligence Agent",
                           "Revenue Agent") unless the user has explicitly named them or they are confirmed to
                           exist in the catalog context. If the agent coordinates with upstream agents, describe
                           their roles generically (e.g. "upstream analytical agents") rather than fabricating names.
        tools (Optional[List[Dict[str, Any]]]): Optional list of tool definitions.
        tables (Optional[List[Dict[str, Any]]]): Optional table definitions.
        columns (Optional[List[Dict[str, Any]]]): Optional column definitions.
        data_source (Optional[List[Dict[str, Any]]]): Optional data-source relationships.
        knowledge_source (Optional[Dict[str, str]]): Optional knowledge source definition.
        skills (Optional[List[Dict[str, Any]]]): Optional list of skill definitions to register and link to this agent.
            Each skill can include name, description, tags, inputModes/input_modes, and outputModes/output_modes.
        issues (Optional[List[Dict]]): Optional list of issues to associate with the agent.
        company_id (Optional[str]): REQUIRED. Active company UUID, or null if no company context is active.

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
                "tables": tables,
                "columns": columns,
                "data_source": data_source,
                "knowledge_source": knowledge_source,
                "skills": skills,
                "issues": issues,
            },
            tenant_id,
        )

        result = AgentMetadataExporter.create_agent(
            agent_name=agent_name,
            description=description,
            instruction=instruction,
            tools=tools,
            tables=tables,
            columns=columns,
            data_source=data_source,
            knowledge_source=knowledge_source,
            skills=skills,
            issues=issues,
            tenant_id=tenant_id,
            company_id=company_id,
            company_name=company_name,
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
    Re-run or regenerate the risk assessment for an agent that already exists in the catalog.

    IMPORTANT — when NOT to call this tool:
    - Do NOT call this tool after create_agent. The create_agent tool already triggers a risk
      assessment automatically as part of agent creation. Calling create_risk_assessment
      immediately after create_agent will cause a duplicate assessment run with no benefit.
    - Do NOT call this tool proactively or as a "next step" after any agent-creation or
      idea-conversion flow. Risk assessment is always started automatically by create_agent.

    ONLY call this tool when the user EXPLICITLY asks to re-run, regenerate, refresh, or
    manually trigger a risk assessment for an agent that already exists — for example:
      "re-run the risk assessment for agent abc123"
      "trigger a new risk assessment for the Fraud Detection Agent"
      "refresh the risk score for agent xyz"

    Args:
        original_prompt (str): REQUIRED. Copy the user's EXACT verbatim message here word-for-word.
                               Do NOT leave empty, summarize, or paraphrase.
                               Example: if the user typed "create risk assessment for agent abc123", set this to "create risk assessment for agent abc123".
        agent_id (str): The unique identifier of the agent for which the risk assessment is to be re-run.
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
async def create_ai_use_case(original_prompt: str, *, title: str, description: str, business_problem_statement: str, expected_benefits: str, priority: str, regulatory_impact: Optional[List[str]] = None, solution_approach: Optional[str] = None, use_case_owner: Optional[str] = None, impacted_business_applications: Optional[List[str]] = None, impacted_business_processes: Optional[List[str]] = None, company_id: Optional[str] = None, company_name: Optional[str] = None, assumptions: Optional[str] = None, quantified_financial_benefits: Optional[str] = None, total_financial_impact_summary: Optional[str] = None, implementation_cost_estimate: Optional[str] = None, return_on_investment: Optional[str] = None, risk_considerations: Optional[str] = None, implementation_roadmap: Optional[str] = None, recommendation: Optional[str] = None, executive_summary: Optional[str] = None) -> Dict[str, Any]:
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
        if assumptions is not None:
            payload["assumptions"] = assumptions
        if quantified_financial_benefits is not None:
            payload["quantified_financial_benefits"] = quantified_financial_benefits
        if total_financial_impact_summary is not None:
            payload["total_financial_impact_summary"] = total_financial_impact_summary
        if implementation_cost_estimate is not None:
            payload["implementation_cost_estimate"] = implementation_cost_estimate
        if return_on_investment is not None:
            payload["return_on_investment"] = return_on_investment
        if risk_considerations is not None:
            payload["risk_considerations"] = risk_considerations
        if implementation_roadmap is not None:
            payload["implementation_roadmap"] = implementation_roadmap
        if recommendation is not None:
            payload["recommendation"] = recommendation
        if executive_summary is not None:
            payload["executive_summary"] = executive_summary

        headers = {"x-tenant-id": str(tenant_id), "Content-Type": "application/json"} if tenant_id else {"Content-Type": "application/json"}
        cid = company_id.strip() if company_id and company_id.strip() else None
        cname = company_name.strip() if company_name and company_name.strip() else None
        url = f"{TAVRO_API_URL}/api/v1/use-cases/"
        params_list = []
        if cid:
            params_list.append(f"company_id={cid}")
        if cname:
            params_list.append(f"company_name={cname}")
        if params_list:
            url += "?" + "&".join(params_list)
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                url,
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
async def get_ai_use_case(original_prompt: str, *, use_case_id: Optional[str] = None, title: Optional[str] = None, start_record: int = 1, record_range: str = "1-10", company_id: Optional[str]) -> Dict[str, Any]:
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
    company_id (Optional[str]): REQUIRED. Active company UUID, or null if no company context is active.
                                Returns use cases for this company plus global use cases (company_id IS NULL).

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
                "company_id": company_id,
            },
            tenant_id,
        )

        headers = {"x-tenant-id": str(tenant_id)} if tenant_id else {}
        async with httpx.AsyncClient(timeout=30.0) as client:
            if use_case_id:
                uc_params: Dict[str, Any] = {}
                if company_id and company_id.strip():
                    uc_params["company_id"] = company_id.strip()
                resp = await client.get(
                    f"{TAVRO_API_URL}/api/v1/use-cases/{use_case_id}",
                    params=uc_params,
                    headers=headers,
                )
            else:
                params: Dict[str, Any] = {
                    "start_record": start_record,
                    "record_range": record_range,
                }
                if title:
                    params["title"] = title
                if company_id and company_id.strip():
                    params["company_id"] = company_id.strip()
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
async def update_agent(
    original_prompt: str,
    *,
    agent_id: Optional[str] = None,
    agent_name: Optional[str] = None,
    description: Optional[str] = None,
    instruction: Optional[str] = None,
    tools: Optional[List[Dict[str, Any]]] = None,
    knowledge_source: Optional[Dict[str, str]] = None,
    tables: Optional[List[Dict[str, Any]]] = None,
    columns: Optional[List[Dict[str, Any]]] = None,
    data_source: Optional[List[Dict[str, Any]]] = None,
    skills: Optional[List[Any]] = None,
    issues: Optional[List[Dict]] = None,
) -> Dict[str, Any]:
    """
    Update an existing AI agent's configuration.

    Only provided fields are changed. Omitting a field leaves it unchanged.
    Allows modification of agent metadata such as name, description, behavior
    instructions, tools, knowledge sources, tables, columns, data source, and skills.

    - `skills`: When provided, updates the skill list for this agent. Each skill can be
      a string name or a dictionary with:
        {
            "name": str,
            "description": str,
            "tags": List[str],
            "inputModes": List[str],
            "outputModes": List[str]
        }
      The keys "identifier"/"skill_id", "input_modes", and "output_modes" are also accepted.

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
        tables (Optional[List[Dict[str, Any]]]): Tables to rename or update. Each entry must include
                           the new name and a way to identify the existing table:
                               {
                                   "name": str,       # new table name to set
                                   "old_name": str,   # current table name (use when table_id is unknown)
                                   "table_id": str    # table identifier (preferred when available)
                               }
                           Use "old_name" when the user refers to the current name (e.g. "rename
                           SNOW_incident to Incidents"). Use "table_id" when you already know it.
        columns (Optional[List[Dict[str, Any]]]): Columns to rename. Each entry must include
                           the new name and a way to identify the existing column:
                               {
                                   "name": str,       # new column name to set
                                   "old_name": str,   # current column name (required)
                                   "table_id": str    # table the column belongs to (preferred for precision)
                               }
                           Use "old_name" for the current column name (e.g. "rename col_id to incident_id").
                           Provide "table_id" when the same column name exists in multiple tables.
        data_source (Optional[List[Dict[str, Any]]]): Data-source relationships or table/column definitions.
        skills (Optional[List[Any]]): Updated skill list for this agent.
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
                "tables": tables,
                "columns": columns,
                "data_source": data_source,
                "skills": skills,
                "issues": issues
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
            tables=tables,
            columns=columns,
            data_source=data_source,
            skills=skills,
            issues=issues,
            tenant_id=str(tenant_id)
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


@core.tool(name="generate_agent_artifacts")
async def generate_agent_artifacts(
    original_prompt: str,
    *,
    agent_id: str,
    agent_name: str,
    requirements_markdown: str,
    technical_markdown: str,
) -> Dict[str, Any]:
    """
    Convert the Requirements and Technical Design markdown documents to PDF files
    and attach them to the specified agent record.

    Call this tool immediately after generating both documents for a newly created agent.
    It produces two PDFs:
      - "{agent_name} Requirement.pdf"
      - "{agent_name} Technical.pdf"
    Both are uploaded as attachments to the agent and visible in the Attachments tab.

    Args:
        original_prompt (str): REQUIRED. Copy the user's EXACT verbatim message here word-for-word.
        agent_id (str): The agent_id returned by create_agent.
        agent_name (str): The exact name of the agent (used to name the PDF files).
        requirements_markdown (str): The full markdown content of the Requirements document.
        technical_markdown (str): The full markdown content of the Technical Design document.

    Returns:
        Dict[str, Any]: Attachment metadata for both uploaded PDFs, or error details.
    """
    print(f"generate_agent_artifacts requested for agent_id={agent_id}")

    try:
        token = get_access_token()
        tenant_id = token.claims.get("tenant_id") if token else None
        log_tool_call(
            "generate_agent_artifacts",
            original_prompt,
            {"agent_id": agent_id, "agent_name": agent_name},
            tenant_id,
        )

        import base64 as _base64
        req_pdf_bytes = AgentMetadataExporter._markdown_to_pdf(
            requirements_markdown, agent_name=agent_name, doc_type="Requirement Document"
        )
        tech_pdf_bytes = AgentMetadataExporter._markdown_to_pdf(
            technical_markdown, agent_name=agent_name, doc_type="Technical Document"
        )

        headers: Dict[str, str] = {"Content-Type": "application/json"}
        if tenant_id:
            headers["x-tenant-id"] = str(tenant_id)

        results = []
        for pdf_bytes, doc_type in (
            (req_pdf_bytes, "Requirement"),
            (tech_pdf_bytes, "Technical"),
        ):
            filename = f"{agent_name} {doc_type}.pdf"
            payload = {
                "filename": filename,
                "mime_type": "application/pdf",
                "content_base64": _base64.b64encode(pdf_bytes).decode("utf-8"),
            }
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(
                    f"{TAVRO_API_URL}/api/v1/agents/{agent_id}/attachments",
                    json=payload,
                    headers=headers,
                )
                resp.raise_for_status()
                results.append(resp.json())

        return {
            "message": f"Artifacts generated and attached to agent '{agent_name}'.",
            "attachments": results,
        }

    except ValueError as ve:
        print("Validation error: %s", ve)
        return {"error": "VALIDATION_ERROR", "details": str(ve)}
    except Exception as e:
        print("Unexpected error in generate_agent_artifacts: %s", e)
        return {"error": "INTERNAL_ERROR", "details": str(e)}


@core.tool(name="generate_spark_ideas")
async def generate_spark_ideas(
    original_prompt: str,
    *,
    company_id: str,
    dimensions: Optional[List[str]] = None,
    direction: Optional[str] = None,
    idea_count: int = 5,
    company_name: Optional[str] = None,
    industry: Optional[str] = None,
    region: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Generate fresh AI use-case ideas ("Spark" ideas) for a company by scanning its blueprint
    (processes, risks, applications, integrations, strategy) for automation gaps, or by
    proposing ideas focused on one specific topic the user names.

    Call this tool whenever the user asks to brainstorm, ideate, or get suggestions for new
    AI use cases, automation opportunities, or agent ideas — e.g. "give me some ideas for...",
    "what AI opportunities exist for...", "suggest use cases around...", "what could we
    automate in...", "inspire me". Do NOT call this for a request to create one specific,
    already-fully-defined use case or agent — use create_ai_use_case or create_agent for that
    instead.

    Args:
    original_prompt (str): REQUIRED. Copy the user's EXACT verbatim message here word-for-word.
    company_id (str): Mandatory. The active company's UUID.
    dimensions (List[str], optional): Blueprint categories to focus the scan on, e.g.
                                       ["process", "risk"]. Leave empty to scan the whole
                                       company blueprint.
    direction (str, optional): A specific topic or focus area if the user named one, e.g.
                                "predictive maintenance", "supplier risk". Leave empty for a
                                general scan across the blueprint.
    idea_count (int): Number of ideas to generate, between 1 and 16. Defaults to 5.
    company_name (str, optional): Company display name, used to ground idea language.
    industry (str, optional): Company industry, used to ground idea language.
    region (str, optional): Company region, used to ground idea language.

    Returns:
    Dict[str, Any]: { "ideas": [ { idea_id, title, description, rationale, signal_type,
    signal_label, target_dimensions, complexity, estimated_impact, target_nodes }, ... ] }.
    Present 2-3 of the most relevant ideas to the user in natural language, referring to each
    one by its title. The ideas are already saved to the company's Spark idea library.
    """
    print("Generate spark ideas requested")
    try:
        token = get_access_token()
        tenant_id = token.claims.get("tenant_id") if token else None
        log_tool_call(
            "generate_spark_ideas",
            original_prompt,
            {
                "company_id": company_id,
                "dimensions": dimensions,
                "direction": direction,
                "idea_count": idea_count,
            },
            tenant_id,
        )

        if not company_id or not company_id.strip():
            return {
                "error": "NO_COMPANY_BLUEPRINT",
                "message": "Set up your Company Blueprint first — Spark uses your company profile as context for idea generation. Tell the user this in plain language and do not invent a company.",
            }

        headers = {"x-tenant-id": str(tenant_id), "Content-Type": "application/json"} if tenant_id else {"Content-Type": "application/json"}
        count = max(1, min(int(idea_count or 5), 16))
        direction_clean = direction.strip() if direction and direction.strip() else None

        async with httpx.AsyncClient(timeout=90.0) as client:
            # Step 1: DB context (candidates or company nodes + edges) from the Tavro API.
            ctx_params: Dict[str, Any] = {"company_id": company_id, "idea_count": count}
            if dimensions:
                ctx_params["dimensions"] = ",".join(dimensions)
            if direction_clean:
                ctx_params["direction"] = direction_clean
            ctx_resp = await client.get(
                f"{TAVRO_API_URL}/api/v1/spark/context",
                params=ctx_params,
                headers=headers,
            )
            ctx_resp.raise_for_status()
            context = ctx_resp.json()

            # Blueprint is empty for this company — there is nothing to ground ideas in.
            # Mirror the same gate the Spark UI applies before calling "Inspire Me".
            is_grounded = bool(context.get("candidates")) or bool(context.get("company_nodes"))
            if not is_grounded:
                return {
                    "error": "EMPTY_COMPANY_BLUEPRINT",
                    "message": "This company's Blueprint has no processes, risks, applications, or other dimensions yet — Spark needs at least some blueprint context to generate grounded ideas. Tell the user to add to their Company Blueprint first, then try again.",
                }

            # Step 2: generate ideas through the same Anthropic infrastructure used by the
            # AI Assistant (copilot server), so idea quality and model config stay unified.
            stream_resp = await client.post(
                f"{COPILOT_SERVER_URL}/spark/generate/stream",
                json={
                    "mode": context.get("mode"),
                    "candidates": context.get("candidates"),
                    "companyNodes": context.get("company_nodes"),
                    "direction": direction_clean,
                    "companyName": company_name,
                    "industry": industry,
                    "region": region,
                    "edges": context.get("edges"),
                    "ideaCount": count,
                    "similarAgents": context.get("similar_agents"),
                },
                headers={"Content-Type": "application/json"},
            )
            stream_resp.raise_for_status()

            ideas: List[Dict[str, Any]] = []
            stream_error: Optional[str] = None
            event_name = ""
            for raw_line in stream_resp.text.splitlines():
                line = raw_line.strip()
                if line.startswith("event:"):
                    event_name = line[len("event:"):].strip()
                elif line.startswith("data:"):
                    data = line[len("data:"):].strip()
                    if event_name == "idea" and data and data != "{}":
                        try:
                            ideas.append(json.loads(data))
                        except Exception:
                            pass
                    elif event_name == "error" and data:
                        try:
                            stream_error = json.loads(data).get("message") or data
                        except Exception:
                            stream_error = data
                    event_name = ""

            if not ideas and stream_error:
                return {"error": "GENERATION_ERROR", "details": stream_error}

            # Step 3: persist ideas to the company's Spark idea library.
            if ideas:
                await client.post(
                    f"{TAVRO_API_URL}/api/v1/spark/ideas/batch",
                    json={
                        "company_id": company_id,
                        "ideas": ideas,
                        "clear_existing": direction_clean is None,
                    },
                    headers=headers,
                )

        return {"ideas": ideas, "count": len(ideas)}

    except ValueError as ve:
        return {"error": "VALIDATION_ERROR", "details": str(ve)}
    except Exception as e:
        return {"error": "INTERNAL_ERROR", "details": str(e)}


@core.tool(name="convert_spark_idea")
async def convert_spark_idea(
    original_prompt: str,
    *,
    company_id: str,
    title: str,
    description: str,
    rationale: str,
    target_dimensions: List[str],
    signal_label: Optional[str] = None,
    complexity: Optional[str] = None,
    estimated_impact: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Expand a Spark idea already discussed in this conversation into complete AI use case
    fields and an agent design recommendation.

    Call this tool when the user asks to convert, develop, expand, or build out an idea that
    was just suggested in this conversation — e.g. "convert the first idea into a use case",
    "develop idea 2 further", "build out that idea", "turn this into an agent". Use the exact
    title, description, and rationale you previously presented for that idea as the arguments
    here — do not invent a new idea.

    This tool only drafts the structured fields; it does NOT create or save anything by
    itself. After calling it, call create_ai_use_case with the returned use_case_fields, and —
    if the user also wants an agent — call create_agent with the returned
    agent_recommendation, in the same turn, to actually persist them.

    Args:
    original_prompt (str): REQUIRED. Copy the user's EXACT verbatim message here word-for-word.
    company_id (str): Mandatory. The active company's UUID.
    title (str): Mandatory. The idea's title, exactly as previously presented.
    description (str): Mandatory. The idea's description, exactly as previously presented.
    rationale (str): Mandatory. The idea's rationale/ROI, exactly as previously presented.
    target_dimensions (List[str]): Mandatory. The blueprint dimensions the idea targets.
    signal_label (str, optional): The signal label originally shown with the idea.
    complexity (str, optional): 'Low', 'Medium', or 'High', if previously shown.
    estimated_impact (str, optional): 'Low', 'Medium', or 'High', if previously shown.

    Returns:
    Dict[str, Any]: { "use_case_fields": {...}, "agent_recommendation": {...} }.
    """
    print("Convert spark idea requested")
    try:
        token = get_access_token()
        tenant_id = token.claims.get("tenant_id") if token else None
        log_tool_call(
            "convert_spark_idea",
            original_prompt,
            {"company_id": company_id, "title": title},
            tenant_id,
        )

        if not company_id or not company_id.strip():
            return {
                "error": "NO_COMPANY_BLUEPRINT",
                "message": "Set up your Company Blueprint first — Spark uses your company profile as context for idea generation. Tell the user this in plain language and do not invent a company.",
            }

        headers = {"x-tenant-id": str(tenant_id), "Content-Type": "application/json"} if tenant_id else {"Content-Type": "application/json"}
        synthetic_idea_id = hashlib.sha256(f"{company_id}:{title}".encode("utf-8")).hexdigest()[:16]

        payload: Dict[str, Any] = {
            "idea_id": synthetic_idea_id,
            "company_id": company_id,
            "title": title,
            "description": description,
            "rationale": rationale,
            "target_dimensions": target_dimensions or [],
        }
        if signal_label is not None:
            payload["signal_label"] = signal_label
        if complexity is not None:
            payload["complexity"] = complexity
        if estimated_impact is not None:
            payload["estimated_impact"] = estimated_impact

        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                f"{TAVRO_API_URL}/api/v1/spark/convert",
                json=payload,
                headers=headers,
            )
            resp.raise_for_status()
            return resp.json()
    except ValueError as ve:
        return {"error": "VALIDATION_ERROR", "details": str(ve)}
    except Exception as e:
        return {"error": "INTERNAL_ERROR", "details": str(e)}


# =============================================================
# ── COMPANY BLUEPRINT: initiate, research, build, update ─────
# =============================================================


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


@core.tool(name="list_companies")
async def list_companies(
    original_prompt: str,
    offset: int = 0,
    limit: int = 50,
) -> Dict[str, Any]:
    """
    List all companies with pagination.

    Args:
        original_prompt (str): REQUIRED verbatim user message.
        offset (int): Number of records to skip (default 0).
        limit (int): Max records to return (default 50, max 200).

    Returns:
        Dict[str, Any]: Paginated list of companies with total, offset, limit, items.
    """
    try:
        token = get_access_token()
        tenant_id = token.claims.get("tenant_id") if token else None
        log_tool_call("list_companies", original_prompt, {"offset": offset, "limit": limit}, tenant_id)

        headers = {"x-tenant-id": str(tenant_id)} if tenant_id else {}
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                f"{TAVRO_API_URL}/api/v1/companies",
                params={"offset": offset, "limit": limit},
                headers=headers,
            )
            resp.raise_for_status()
            return resp.json()
    except ValueError as ve:
        return {"error": "VALIDATION_ERROR", "details": str(ve)}
    except Exception as e:
        return {"error": "INTERNAL_ERROR", "details": str(e)}


@core.tool(name="delete_company")
async def delete_company(original_prompt: str, *, company_id: str) -> Dict[str, Any]:
    """
    Delete a company and all its associated blueprint data (dim_nodes, dim_edges, source_refs).
    Audit logs are retained. This action is irreversible.

    Args:
        original_prompt (str): REQUIRED verbatim user message.
        company_id (str): UUID of the company to delete.

    Returns:
        Dict[str, Any]: Summary of deleted records or error details.
    """
    try:
        token = get_access_token()
        tenant_id = token.claims.get("tenant_id") if token else None
        log_tool_call("delete_company", original_prompt, {"company_id": company_id}, tenant_id)

        headers = {"x-tenant-id": str(tenant_id)} if tenant_id else {}
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.delete(
                f"{TAVRO_API_URL}/api/v1/companies/{company_id}",
                headers=headers,
            )
            resp.raise_for_status()
            return resp.json()
    except ValueError as ve:
        return {"error": "VALIDATION_ERROR", "details": str(ve)}
    except Exception as e:
        return {"error": "INTERNAL_ERROR", "details": str(e)}


@core.tool(name="research_blueprint")
async def research_blueprint(
    original_prompt: str,
    *,
    company_id: str,
    company_name: str,
    industry: str,
    region: str = "",
    ticker: Optional[str] = None,
    is_public: bool = False,
) -> Dict[str, Any]:
    """
    Initiate AI-powered research to build a Company Blueprint.

    For PUBLIC companies (is_public=True or ticker provided), this fetches SEC EDGAR 10-K
    filings and performs web search to generate accurate blueprint dimensions.
    For PRIVATE companies (is_public=False), it uses AI knowledge of the industry.

    The research produces a list of dimension nodes (profile, strategy, organisation,
    finance, process, application, integration, risk) that populate the company blueprint.

    After research, call save_blueprint_nodes to persist the returned nodes.

    Args:
        original_prompt (str): REQUIRED verbatim user message.
        company_id (str): UUID of the company to research.
        company_name (str): Full name of the company.
        industry (str): Company industry (e.g. "Financial Services", "Healthcare").
        region (str): Geographic region (optional).
        ticker (str, optional): Stock ticker symbol for public companies (e.g. "AAPL").
        is_public (bool): True if the company is publicly traded.

    Returns:
        Dict[str, Any]: Research result containing nodes (list of dimension nodes),
                        sources, notice, turns_used, tokens_cap — or error details.
    """
    try:
        token = get_access_token()
        tenant_id = token.claims.get("tenant_id") if token else None
        log_tool_call(
            "research_blueprint",
            original_prompt,
            {
                "company_id": company_id,
                "company_name": company_name,
                "industry": industry,
                "region": region,
                "ticker": ticker,
                "is_public": is_public,
            },
            tenant_id,
        )

        payload: Dict[str, Any] = {
            "company_id": company_id,
            "company_name": company_name,
            "industry": industry,
            "region": region,
            "is_public": is_public or bool(ticker),
        }
        if ticker:
            payload["ticker"] = ticker

        headers: Dict[str, str] = {"Content-Type": "application/json"}
        if tenant_id:
            headers["x-tenant-id"] = str(tenant_id)

        # The research endpoint streams SSE events. Consume the stream and return
        # the final "result" event payload.
        async with httpx.AsyncClient(timeout=300.0) as client:
            async with client.stream(
                "POST",
                f"{TAVRO_API_URL}/api/v1/blueprint/research",
                json=payload,
                headers=headers,
            ) as resp:
                resp.raise_for_status()
                async for raw_line in resp.aiter_lines():
                    line = raw_line.strip()
                    if not line.startswith("data:"):
                        continue
                    event = json.loads(line[5:].strip())
                    if event.get("type") == "result":
                        return event.get("data", {})
                    if event.get("type") == "error":
                        return {
                            "error": "RESEARCH_ERROR",
                            "details": event.get("message", "Research failed"),
                        }

        return {"error": "RESEARCH_ERROR", "details": "Stream ended without a result event"}

    except ValueError as ve:
        return {"error": "VALIDATION_ERROR", "details": str(ve)}
    except Exception as e:
        return {"error": "INTERNAL_ERROR", "details": str(e)}


@core.tool(name="save_blueprint_nodes")
async def save_blueprint_nodes(
    original_prompt: str,
    *,
    company_id: str,
    nodes: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Persist AI-researched blueprint nodes into the company's blueprint.

    Call this after research_blueprint to save the returned nodes. Each node
    is deduplicated by label — existing nodes are skipped (not overwritten).

    Args:
        original_prompt (str): REQUIRED verbatim user message.
        company_id (str): UUID of the company the nodes belong to.
        nodes (List[Dict]): List of dimension node objects, each with:
            - category (str): One of profile, strategy, process, application,
                              integration, organisation, risk, finance, custom.
            - label (str): Short name for the dimension (e.g. "Revenue Strategy").
            - summary (str): 2-5 sentence description of the dimension.
            - tags (List[str]): Descriptive keyword tags.
            - visibility (str): "public" | "internal" | "restricted" | "confidential" (default: "internal").
            - sensitive (bool): Whether this node contains sensitive data (default: false).

    Returns:
        Dict[str, Any]: {"saved": int, "skipped": int} counts.
    """
    try:
        token = get_access_token()
        tenant_id = token.claims.get("tenant_id") if token else None
        log_tool_call(
            "save_blueprint_nodes",
            original_prompt,
            {"company_id": company_id, "node_count": len(nodes)},
            tenant_id,
        )

        payload = {"company_id": company_id, "nodes": nodes}
        headers: Dict[str, str] = {"Content-Type": "application/json"}
        if tenant_id:
            headers["x-tenant-id"] = str(tenant_id)

        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                f"{TAVRO_API_URL}/api/v1/blueprint/save-researched-nodes",
                json=payload,
                headers=headers,
            )
            resp.raise_for_status()
            return resp.json()
    except ValueError as ve:
        return {"error": "VALIDATION_ERROR", "details": str(ve)}
    except Exception as e:
        return {"error": "INTERNAL_ERROR", "details": str(e)}


@core.tool(name="seed_blueprint_template")
async def seed_blueprint_template(
    original_prompt: str,
    *,
    company_id: str,
    template: str,
) -> Dict[str, Any]:
    """
    Seed a company blueprint from a predefined industry template.

    Use this to quickly populate a blueprint with standard dimensions for a given
    industry, rather than running full AI research. Existing nodes are skipped.

    Args:
        original_prompt (str): REQUIRED verbatim user message.
        company_id (str): UUID of the company to seed.
        template (str): Industry template name (e.g. "banking", "insurance",
                        "healthcare", "manufacturing", "retail", "tech"). Use "blank" for empty.

    Returns:
        Dict[str, Any]: {"seeded": int, "skipped": int, "message": str}.
    """
    try:
        token = get_access_token()
        tenant_id = token.claims.get("tenant_id") if token else None
        log_tool_call(
            "seed_blueprint_template",
            original_prompt,
            {"company_id": company_id, "template": template},
            tenant_id,
        )

        payload = {"company_id": company_id, "template": template}
        headers: Dict[str, str] = {"Content-Type": "application/json"}
        if tenant_id:
            headers["x-tenant-id"] = str(tenant_id)

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{TAVRO_API_URL}/api/v1/blueprint/seed-template",
                json=payload,
                headers=headers,
            )
            resp.raise_for_status()
            return resp.json()
    except ValueError as ve:
        return {"error": "VALIDATION_ERROR", "details": str(ve)}
    except Exception as e:
        return {"error": "INTERNAL_ERROR", "details": str(e)}


# =============================================================
# ── DIMENSION NODES: CRUD + company relationship ─────────────
# =============================================================

@core.tool(name="list_dim_nodes")
async def list_dim_nodes(
    original_prompt: str,
    *,
    company_id: str,
    dim_type_id: Optional[str] = None,
    category: Optional[str] = None,
    search: Optional[str] = None,
    active_only: bool = True,
    offset: int = 0,
    limit: int = 100,
) -> Dict[str, Any]:
    """
    List dimension nodes for a company's blueprint.

    Dimensions are the building blocks of a Company Blueprint. Each node represents
    one dimension of the company (e.g. a business process, application, risk factor).

    Args:
        original_prompt (str): REQUIRED verbatim user message.
        company_id (str): UUID of the company (required).
        dim_type_id (str, optional): Filter by dimension type UUID.
        category (str, optional): Filter by category (profile, strategy, process,
                                   application, integration, organisation, risk, finance, custom).
        search (str, optional): Full-text search across label and summary.
        active_only (bool): If True (default), only return active (non-deleted) nodes.
        offset (int): Pagination offset (default 0).
        limit (int): Max records (default 100, max 500).

    Returns:
        Dict[str, Any]: Paginated list with total, offset, limit, items.
    """
    try:
        token = get_access_token()
        tenant_id = token.claims.get("tenant_id") if token else None
        log_tool_call(
            "list_dim_nodes",
            original_prompt,
            {"company_id": company_id, "category": category, "search": search},
            tenant_id,
        )

        params: Dict[str, Any] = {
            "company_id": company_id,
            "active_only": active_only,
            "offset": offset,
            "limit": limit,
        }
        if dim_type_id:
            params["dim_type_id"] = dim_type_id
        if category:
            params["category"] = category
        if search:
            params["search"] = search

        headers = {"x-tenant-id": str(tenant_id)} if tenant_id else {}
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                f"{TAVRO_API_URL}/api/v1/dim-nodes",
                params=params,
                headers=headers,
            )
            resp.raise_for_status()
            return resp.json()
    except ValueError as ve:
        return {"error": "VALIDATION_ERROR", "details": str(ve)}
    except Exception as e:
        return {"error": "INTERNAL_ERROR", "details": str(e)}


@core.tool(name="get_dim_node")
async def get_dim_node(original_prompt: str, *, node_id: str) -> Dict[str, Any]:
    """
    Retrieve a single dimension node by its UUID.

    Args:
        original_prompt (str): REQUIRED verbatim user message.
        node_id (str): UUID of the dimension node.

    Returns:
        Dict[str, Any]: Full dimension node record including label, summary, tags,
                        category, visibility, sensitive, valid_from, valid_to.
    """
    try:
        token = get_access_token()
        tenant_id = token.claims.get("tenant_id") if token else None
        log_tool_call("get_dim_node", original_prompt, {"node_id": node_id}, tenant_id)

        headers = {"x-tenant-id": str(tenant_id)} if tenant_id else {}
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                f"{TAVRO_API_URL}/api/v1/dim-nodes/{node_id}",
                headers=headers,
            )
            resp.raise_for_status()
            return resp.json()
    except ValueError as ve:
        return {"error": "VALIDATION_ERROR", "details": str(ve)}
    except Exception as e:
        return {"error": "INTERNAL_ERROR", "details": str(e)}


@core.tool(name="create_dim_node")
async def create_dim_node(
    original_prompt: str,
    *,
    company_id: str,
    dim_type_id: str,
    label: str,
    summary: Optional[str] = None,
    tags: Optional[List[str]] = None,
    visibility: str = "internal",
    sensitive: bool = False,
) -> Dict[str, Any]:
    """
    Create a new dimension node in a company's blueprint.

    A dimension node represents one dimension of the company blueprint (e.g. a business
    process, application, integration, or strategic element). When the dim_type category
    is 'application', 'process', or 'integration', a corresponding business entity record
    is automatically created and linked.

    Args:
        original_prompt (str): REQUIRED verbatim user message.
        company_id (str): UUID of the company this node belongs to.
        dim_type_id (str): UUID of the dimension type. Use list_dim_types to get available types.
        label (str): Short name for the dimension (e.g. "Customer Onboarding Process").
        summary (str, optional): 2-5 sentence description of this dimension.
        tags (List[str], optional): Descriptive tags (e.g. ["onboarding", "customer-facing"]).
        visibility (str): "public" | "internal" | "restricted" | "confidential" (default: "internal").
        sensitive (bool): True if this node contains sensitive/confidential data (default: False).

    Returns:
        Dict[str, Any]: Created dimension node record with id, company_id, dim_type_id,
                        label, category, valid_from, updated_at.
    """
    try:
        token = get_access_token()
        tenant_id = token.claims.get("tenant_id") if token else None
        log_tool_call(
            "create_dim_node",
            original_prompt,
            {"company_id": company_id, "dim_type_id": dim_type_id, "label": label},
            tenant_id,
        )

        payload: Dict[str, Any] = {
            "company_id": company_id,
            "dim_type_id": dim_type_id,
            "label": label,
            "visibility": visibility,
            "sensitive": sensitive,
            "tags": tags or [],
        }
        if summary is not None:
            payload["summary"] = summary

        headers: Dict[str, str] = {"Content-Type": "application/json"}
        if tenant_id:
            headers["x-tenant-id"] = str(tenant_id)

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{TAVRO_API_URL}/api/v1/dim-nodes",
                json=payload,
                headers=headers,
            )
            resp.raise_for_status()
            return resp.json()
    except ValueError as ve:
        return {"error": "VALIDATION_ERROR", "details": str(ve)}
    except Exception as e:
        return {"error": "INTERNAL_ERROR", "details": str(e)}


@core.tool(name="update_dim_node")
async def update_dim_node(
    original_prompt: str,
    *,
    node_id: str,
    label: Optional[str] = None,
    summary: Optional[str] = None,
    tags: Optional[List[str]] = None,
    visibility: Optional[str] = None,
    sensitive: Optional[bool] = None,
    dim_type_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Update fields on an existing dimension node. Only provided fields are changed.

    Args:
        original_prompt (str): REQUIRED verbatim user message.
        node_id (str): UUID of the dimension node to update.
        label (str, optional): Updated label/name.
        summary (str, optional): Updated summary description.
        tags (List[str], optional): Updated tags list (replaces existing tags).
        visibility (str, optional): Updated visibility level.
        sensitive (bool, optional): Updated sensitive flag.
        dim_type_id (str, optional): Reassign to a different dimension type UUID.

    Returns:
        Dict[str, Any]: Updated dimension node record or error details.
    """
    try:
        token = get_access_token()
        tenant_id = token.claims.get("tenant_id") if token else None
        log_tool_call("update_dim_node", original_prompt, {"node_id": node_id}, tenant_id)

        payload: Dict[str, Any] = {}
        if label is not None:
            payload["label"] = label
        if summary is not None:
            payload["summary"] = summary
        if tags is not None:
            payload["tags"] = tags
        if visibility is not None:
            payload["visibility"] = visibility
        if sensitive is not None:
            payload["sensitive"] = sensitive
        if dim_type_id is not None:
            payload["dim_type_id"] = dim_type_id

        if not payload:
            return {"error": "VALIDATION_ERROR", "details": "No fields provided to update"}

        headers: Dict[str, str] = {"Content-Type": "application/json"}
        if tenant_id:
            headers["x-tenant-id"] = str(tenant_id)

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.patch(
                f"{TAVRO_API_URL}/api/v1/dim-nodes/{node_id}",
                json=payload,
                headers=headers,
            )
            resp.raise_for_status()
            return resp.json()
    except ValueError as ve:
        return {"error": "VALIDATION_ERROR", "details": str(ve)}
    except Exception as e:
        return {"error": "INTERNAL_ERROR", "details": str(e)}


@core.tool(name="delete_dim_node")
async def delete_dim_node(original_prompt: str, *, node_id: str) -> Dict[str, Any]:
    """
    Soft-delete a dimension node (sets valid_to = now). The record is retained for audit.

    Args:
        original_prompt (str): REQUIRED verbatim user message.
        node_id (str): UUID of the dimension node to deactivate.

    Returns:
        Dict[str, Any]: {"status": "deleted", "node_id": str} or error details.
    """
    try:
        token = get_access_token()
        tenant_id = token.claims.get("tenant_id") if token else None
        log_tool_call("delete_dim_node", original_prompt, {"node_id": node_id}, tenant_id)

        headers = {"x-tenant-id": str(tenant_id)} if tenant_id else {}
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.delete(
                f"{TAVRO_API_URL}/api/v1/dim-nodes/{node_id}",
                headers=headers,
            )
            resp.raise_for_status()
            return {"status": "deleted", "node_id": node_id}
    except ValueError as ve:
        return {"error": "VALIDATION_ERROR", "details": str(ve)}
    except Exception as e:
        return {"error": "INTERNAL_ERROR", "details": str(e)}


# =============================================================
# ── DIMENSION EDGES: relationship CRUD ───────────────────────
# =============================================================

@core.tool(name="list_dim_edges")
async def list_dim_edges(
    original_prompt: str,
    *,
    company_id: str,
    node_id: Optional[str] = None,
    rel_type: Optional[str] = None,
    active_only: bool = True,
    offset: int = 0,
    limit: int = 200,
) -> Dict[str, Any]:
    """
    List dimension edges (relationships) for a company's blueprint.

    Edges model how dimensions relate to each other (e.g. a process depends_on
    an application, or a risk governs a process).

    Args:
        original_prompt (str): REQUIRED verbatim user message.
        company_id (str): UUID of the company (required).
        node_id (str, optional): Filter to edges involving this specific node (both directions).
        rel_type (str, optional): Filter by relationship type:
            depends_on | owned_by | supports | risks | enables | part_of | governed_by |
            replaced_by | custom.
        active_only (bool): Only return active (non-deleted) edges (default True).
        offset (int): Pagination offset (default 0).
        limit (int): Max records (default 200, max 1000).

    Returns:
        Dict[str, Any]: Paginated list with total, offset, limit, items.
                        Each item includes source_id, target_id, rel_type,
                        source_label, target_label, weight.
    """
    try:
        token = get_access_token()
        tenant_id = token.claims.get("tenant_id") if token else None
        log_tool_call(
            "list_dim_edges",
            original_prompt,
            {"company_id": company_id, "node_id": node_id, "rel_type": rel_type},
            tenant_id,
        )

        params: Dict[str, Any] = {
            "company_id": company_id,
            "active_only": active_only,
            "offset": offset,
            "limit": limit,
        }
        if node_id:
            params["node_id"] = node_id
        if rel_type:
            params["rel_type"] = rel_type

        headers = {"x-tenant-id": str(tenant_id)} if tenant_id else {}
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                f"{TAVRO_API_URL}/api/v1/dim-edges",
                params=params,
                headers=headers,
            )
            resp.raise_for_status()
            return resp.json()
    except ValueError as ve:
        return {"error": "VALIDATION_ERROR", "details": str(ve)}
    except Exception as e:
        return {"error": "INTERNAL_ERROR", "details": str(e)}


@core.tool(name="get_dim_edge")
async def get_dim_edge(original_prompt: str, *, edge_id: str) -> Dict[str, Any]:
    """
    Retrieve a single dimension edge (relationship) by its UUID.

    Args:
        original_prompt (str): REQUIRED verbatim user message.
        edge_id (str): UUID of the dimension edge.

    Returns:
        Dict[str, Any]: Edge record including source_id, target_id, source_label,
                        target_label, rel_type, weight, meta, valid_from.
    """
    try:
        token = get_access_token()
        tenant_id = token.claims.get("tenant_id") if token else None
        log_tool_call("get_dim_edge", original_prompt, {"edge_id": edge_id}, tenant_id)

        headers = {"x-tenant-id": str(tenant_id)} if tenant_id else {}
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                f"{TAVRO_API_URL}/api/v1/dim-edges/{edge_id}",
                headers=headers,
            )
            resp.raise_for_status()
            return resp.json()
    except ValueError as ve:
        return {"error": "VALIDATION_ERROR", "details": str(ve)}
    except Exception as e:
        return {"error": "INTERNAL_ERROR", "details": str(e)}


@core.tool(name="create_dim_edge")
async def create_dim_edge(
    original_prompt: str,
    *,
    source_id: str,
    target_id: str,
    rel_type: str,
    weight: float = 0.5,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Create a relationship (edge) between two dimension nodes in the blueprint graph.

    Edges express how blueprint dimensions relate to each other. Both source and
    target nodes must belong to the same company.

    Args:
        original_prompt (str): REQUIRED verbatim user message.
        source_id (str): UUID of the source dimension node.
        target_id (str): UUID of the target dimension node.
        rel_type (str): Relationship type. One of:
            depends_on | owned_by | supports | risks | enables | part_of |
            governed_by | replaced_by | custom.
        weight (float): Relationship strength from 0.0 to 1.0 (default 0.5).
        meta (Dict, optional): Additional key-value metadata about the relationship.

    Returns:
        Dict[str, Any]: Created edge record with id, source_id, target_id, rel_type,
                        weight, valid_from — or error details.
    """
    try:
        token = get_access_token()
        tenant_id = token.claims.get("tenant_id") if token else None
        log_tool_call(
            "create_dim_edge",
            original_prompt,
            {"source_id": source_id, "target_id": target_id, "rel_type": rel_type},
            tenant_id,
        )

        payload: Dict[str, Any] = {
            "source_id": source_id,
            "target_id": target_id,
            "rel_type": rel_type,
            "weight": weight,
            "meta": meta or {},
        }

        headers: Dict[str, str] = {"Content-Type": "application/json"}
        if tenant_id:
            headers["x-tenant-id"] = str(tenant_id)

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{TAVRO_API_URL}/api/v1/dim-edges",
                json=payload,
                headers=headers,
            )
            resp.raise_for_status()
            return resp.json()
    except ValueError as ve:
        return {"error": "VALIDATION_ERROR", "details": str(ve)}
    except Exception as e:
        return {"error": "INTERNAL_ERROR", "details": str(e)}


@core.tool(name="delete_dim_edge")
async def delete_dim_edge(original_prompt: str, *, edge_id: str) -> Dict[str, Any]:
    """
    Soft-delete a dimension edge (sets valid_to = now). The record is retained for audit.

    Args:
        original_prompt (str): REQUIRED verbatim user message.
        edge_id (str): UUID of the dimension edge to deactivate.

    Returns:
        Dict[str, Any]: {"status": "deleted", "edge_id": str} or error details.
    """
    try:
        token = get_access_token()
        tenant_id = token.claims.get("tenant_id") if token else None
        log_tool_call("delete_dim_edge", original_prompt, {"edge_id": edge_id}, tenant_id)

        headers = {"x-tenant-id": str(tenant_id)} if tenant_id else {}
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.delete(
                f"{TAVRO_API_URL}/api/v1/dim-edges/{edge_id}",
                headers=headers,
            )
            resp.raise_for_status()
            return {"status": "deleted", "edge_id": edge_id}
    except ValueError as ve:
        return {"error": "VALIDATION_ERROR", "details": str(ve)}
    except Exception as e:
        return {"error": "INTERNAL_ERROR", "details": str(e)}


# =============================================================
# ── DIMENSION TYPES: catalog of available dimension categories
# =============================================================

@core.tool(name="list_dim_types")
async def list_dim_types(original_prompt: str) -> Dict[str, Any]:
    """
    List all available dimension types (the taxonomy for blueprint dimensions).

    System-defined types: profile, strategy, process, application, integration,
    organisation, risk, finance, custom. Custom types can also be created.

    Args:
        original_prompt (str): REQUIRED verbatim user message.

    Returns:
        Dict[str, Any]: List of dimension type records, each with id, name, category,
                        system_defined, max_hops.
    """
    try:
        token = get_access_token()
        tenant_id = token.claims.get("tenant_id") if token else None
        log_tool_call("list_dim_types", original_prompt, {}, tenant_id)

        headers = {"x-tenant-id": str(tenant_id)} if tenant_id else {}
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                f"{TAVRO_API_URL}/api/v1/dim-types",
                headers=headers,
            )
            resp.raise_for_status()
            return {"items": resp.json()}
    except ValueError as ve:
        return {"error": "VALIDATION_ERROR", "details": str(ve)}
    except Exception as e:
        return {"error": "INTERNAL_ERROR", "details": str(e)}


@core.tool(name="get_dim_type")
async def get_dim_type(original_prompt: str, *, dim_type_id: str) -> Dict[str, Any]:
    """
    Retrieve a dimension type by its UUID.

    Args:
        original_prompt (str): REQUIRED verbatim user message.
        dim_type_id (str): UUID of the dimension type.

    Returns:
        Dict[str, Any]: Dimension type record with id, name, category, system_defined,
                        max_hops, value_schema.
    """
    try:
        token = get_access_token()
        tenant_id = token.claims.get("tenant_id") if token else None
        log_tool_call("get_dim_type", original_prompt, {"dim_type_id": dim_type_id}, tenant_id)

        headers = {"x-tenant-id": str(tenant_id)} if tenant_id else {}
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                f"{TAVRO_API_URL}/api/v1/dim-types/{dim_type_id}",
                headers=headers,
            )
            resp.raise_for_status()
            return resp.json()
    except ValueError as ve:
        return {"error": "VALIDATION_ERROR", "details": str(ve)}
    except Exception as e:
        return {"error": "INTERNAL_ERROR", "details": str(e)}


@core.tool(name="create_dim_type")
async def create_dim_type(
    original_prompt: str,
    *,
    name: str,
    category: str,
    system_defined: bool = False,
    max_hops: int = 2,
    value_schema: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Create a custom dimension type to extend the blueprint taxonomy.

    Args:
        original_prompt (str): REQUIRED verbatim user message.
        name (str): Unique display name for this dimension type (e.g. "Vendor").
        category (str): Category must be one of the system-defined values:
            profile | strategy | process | application | integration |
            organisation | risk | finance | custom.
        system_defined (bool): Mark as system-defined (default False for custom types).
        max_hops (int): Maximum graph traversal hops (1-5, default 2).
        value_schema (Dict, optional): JSON Schema for validating node values in this type.

    Returns:
        Dict[str, Any]: Created dimension type record or error details.
    """
    try:
        token = get_access_token()
        tenant_id = token.claims.get("tenant_id") if token else None
        log_tool_call(
            "create_dim_type",
            original_prompt,
            {"name": name, "category": category},
            tenant_id,
        )

        payload: Dict[str, Any] = {
            "name": name,
            "category": category,
            "system_defined": system_defined,
            "max_hops": max_hops,
        }
        if value_schema is not None:
            payload["value_schema"] = value_schema

        headers: Dict[str, str] = {"Content-Type": "application/json"}
        if tenant_id:
            headers["x-tenant-id"] = str(tenant_id)

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{TAVRO_API_URL}/api/v1/dim-types",
                json=payload,
                headers=headers,
            )
            resp.raise_for_status()
            return resp.json()
    except ValueError as ve:
        return {"error": "VALIDATION_ERROR", "details": str(ve)}
    except Exception as e:
        return {"error": "INTERNAL_ERROR", "details": str(e)}


# =============================================================
# ── BUSINESS APPLICATIONS: CRUD + blueprint relationship ──────
# =============================================================


@core.tool(name="get_application_catalog")
async def get_application_catalog(original_prompt: str, *, start_record: int = 1, record_range: str = "1-10", company_id: Optional[str]) -> Dict[str, Any]:
    """
    Retrieve paginated application catalog.

    Args:
        original_prompt (str): REQUIRED verbatim user message.
        start_record (int): Starting index.
        record_range (str): Range like "1-10".
        company_id (Optional[str]): REQUIRED. Active company UUID, or null if no company context is active.
                                    Returns applications for this company plus global applications (company_id IS NULL).

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
                "company_id": company_id,
            },
            tenant_id,
        )

        result = AgentMetadataExporter.get_application_catalog(
            start_record=start_record,
            record_range=record_range,
            tenant_id=str(tenant_id),
            company_id=company_id,
        )

        return result

    except ValueError as ve:
        return {"error": "VALIDATION_ERROR", "details": str(ve)}
    except Exception as e:
        return {"error": "INTERNAL_ERROR", "details": str(e)}


@core.tool(name="get_application")
async def get_application(original_prompt: str, *, application_id: str, company_id: Optional[str]) -> Dict[str, Any]:
    """
    Retrieve a business application by its ID.

    Args:
        original_prompt (str): REQUIRED verbatim user message.
        application_id (str): The business_application_id (hex string).
        company_id (Optional[str]): REQUIRED. Active company UUID, or null if no company context is active.
                                    Returns the application only if it belongs to this company or is a
                                    global application (company_id IS NULL).

    Returns:
        Dict[str, Any]: Full application record including name, description, vendor,
                        business_criticality, embedded_ai, risk scores, company_id.
    """
    try:
        token = get_access_token()
        tenant_id = token.claims.get("tenant_id") if token else None
        log_tool_call("get_application", original_prompt, {"application_id": application_id, "company_id": company_id}, tenant_id)

        headers = {"x-tenant-id": str(tenant_id)} if tenant_id else {}
        params: Dict[str, Any] = {}
        if company_id and company_id.strip():
            params["company_id"] = company_id.strip()
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                f"{TAVRO_API_URL}/api/v1/applications/{application_id}",
                params=params,
                headers=headers,
            )
            resp.raise_for_status()
            return resp.json()
    except ValueError as ve:
        return {"error": "VALIDATION_ERROR", "details": str(ve)}
    except Exception as e:
        return {"error": "INTERNAL_ERROR", "details": str(e)}


@core.tool(name="create_application")
async def create_application(
    original_prompt: str,
    *,
    application_name: str,
    company_id: Optional[str],
    application_description: Optional[str] = None,
    tags: Optional[List[str]] = None,
    emergency_tier: Optional[str] = None,
    business_owner: Optional[str] = None,
    application_portfolio_manager: Optional[str] = None,
    vendor_name: Optional[str] = None,
    business_criticality: Optional[str] = None,
    it_application_owner: Optional[str] = None,
    embedded_ai: Optional[str] = None,
    opt_out_option: Optional[str] = None,
    privacy_policy_url: Optional[str] = None,
    data_excluded_from_ai_training: Optional[str] = None,
    vendor_description: Optional[str] = None,
    current_installed_version: Optional[str] = None,
    is_current_version_supported: Optional[str] = None,
    latest_released_version: Optional[str] = None,
    latest_release_date: Optional[str] = None,
    latest_release_documentation_link: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Create a new business application and optionally link it to a company's blueprint.

    When company_id is provided, the application is automatically synced to the company's
    blueprint as an 'application' dimension node.

    Args:
        original_prompt (str): REQUIRED verbatim user message.
        application_name (str): Name of the business application (required).
        company_id (Optional[str]): REQUIRED. Active company UUID, or null. When provided, links the application to the company's blueprint.
        application_description (str, optional): Description of the application's purpose.
        tags (List[str], optional): Descriptive tags for the application (e.g. ["crm", "saas"]).
        emergency_tier (str, optional): Emergency classification tier.
        business_owner (str, optional): Business owner name or team.
        application_portfolio_manager (str, optional): Portfolio manager.
        vendor_name (str, optional): Software vendor name.
        business_criticality (str, optional): Criticality level (e.g. "Critical", "High").
        it_application_owner (str, optional): IT owner.
        embedded_ai (str, optional): Whether the application has embedded AI ("Yes"/"No").
        opt_out_option (str, optional): AI opt-out availability.
        privacy_policy_url (str, optional): URL to the vendor privacy policy.
        data_excluded_from_ai_training (str, optional): Data exclusion from AI training details.
        vendor_description (str, optional): Description of the vendor.
        current_installed_version (str, optional): Version currently deployed.
        is_current_version_supported (str, optional): Whether current version is supported.
        latest_released_version (str, optional): Latest vendor release.
        latest_release_date (str, optional): Date of latest release.
        latest_release_documentation_link (str, optional): Link to release docs.

    Returns:
        Dict[str, Any]: Created application record with business_application_id and all fields.
    """
    try:
        token = get_access_token()
        tenant_id = token.claims.get("tenant_id") if token else None
        log_tool_call(
            "create_application",
            original_prompt,
            {"application_name": application_name, "company_id": company_id},
            tenant_id,
        )

        payload: Dict[str, Any] = {"application_name": application_name}
        if tags is not None:
            payload["tags"] = tags
        for field, val in [
            ("application_description", application_description),
            ("emergency_tier", emergency_tier),
            ("business_owner", business_owner),
            ("application_portfolio_manager", application_portfolio_manager),
            ("vendor_name", vendor_name),
            ("business_criticality", business_criticality),
            ("it_application_owner", it_application_owner),
            ("embedded_ai", embedded_ai),
            ("opt_out_option", opt_out_option),
            ("privacy_policy_url", privacy_policy_url),
            ("data_excluded_from_ai_training", data_excluded_from_ai_training),
            ("vendor_description", vendor_description),
            ("current_installed_version", current_installed_version),
            ("is_current_version_supported", is_current_version_supported),
            ("latest_released_version", latest_released_version),
            ("latest_release_date", latest_release_date),
            ("latest_release_documentation_link", latest_release_documentation_link),
        ]:
            if val is not None:
                payload[field] = val

        headers: Dict[str, str] = {"Content-Type": "application/json"}
        if tenant_id:
            headers["x-tenant-id"] = str(tenant_id)

        url = f"{TAVRO_API_URL}/api/v1/applications"
        if company_id:
            url += f"?company_id={company_id}"

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
            return resp.json()
    except ValueError as ve:
        return {"error": "VALIDATION_ERROR", "details": str(ve)}
    except Exception as e:
        return {"error": "INTERNAL_ERROR", "details": str(e)}


@core.tool(name="update_application")
async def update_application(
    original_prompt: str,
    *,
    application_id: str,
    application_name: Optional[str] = None,
    application_description: Optional[str] = None,
    tags: Optional[List[str]] = None,
    emergency_tier: Optional[str] = None,
    business_owner: Optional[str] = None,
    application_portfolio_manager: Optional[str] = None,
    vendor_name: Optional[str] = None,
    business_criticality: Optional[str] = None,
    it_application_owner: Optional[str] = None,
    embedded_ai: Optional[str] = None,
    opt_out_option: Optional[str] = None,
    privacy_policy_url: Optional[str] = None,
    data_excluded_from_ai_training: Optional[str] = None,
    vendor_description: Optional[str] = None,
    current_installed_version: Optional[str] = None,
    is_current_version_supported: Optional[str] = None,
    latest_released_version: Optional[str] = None,
    latest_release_date: Optional[str] = None,
    latest_release_documentation_link: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Update fields on an existing business application. Only provided fields are changed.

    Args:
        original_prompt (str): REQUIRED verbatim user message.
        application_id (str): The business_application_id to update.
        application_name (str, optional): Updated application name.
        application_description (str, optional): Updated description.
        tags (List[str], optional): Updated tags.
        emergency_tier (str, optional): Updated emergency tier.
        business_owner (str, optional): Updated business owner.
        application_portfolio_manager (str, optional): Updated portfolio manager.
        vendor_name (str, optional): Updated vendor.
        business_criticality (str, optional): Updated criticality.
        it_application_owner (str, optional): Updated IT owner.
        embedded_ai (str, optional): Updated embedded AI flag.
        opt_out_option (str, optional): Updated opt-out option.
        privacy_policy_url (str, optional): Updated privacy policy URL.
        data_excluded_from_ai_training (str, optional): Updated AI training exclusion.
        vendor_description (str, optional): Updated vendor description.
        current_installed_version (str, optional): Updated current version.
        is_current_version_supported (str, optional): Updated support status.
        latest_released_version (str, optional): Updated latest version.
        latest_release_date (str, optional): Updated latest release date.
        latest_release_documentation_link (str, optional): Updated docs link.

    Returns:
        Dict[str, Any]: Updated application record or error details.
    """
    try:
        token = get_access_token()
        tenant_id = token.claims.get("tenant_id") if token else None
        log_tool_call("update_application", original_prompt, {"application_id": application_id}, tenant_id)

        payload: Dict[str, Any] = {}
        if tags is not None:
            payload["tags"] = tags
        for field, val in [
            ("application_name", application_name),
            ("application_description", application_description),
            ("emergency_tier", emergency_tier),
            ("business_owner", business_owner),
            ("application_portfolio_manager", application_portfolio_manager),
            ("vendor_name", vendor_name),
            ("business_criticality", business_criticality),
            ("it_application_owner", it_application_owner),
            ("embedded_ai", embedded_ai),
            ("opt_out_option", opt_out_option),
            ("privacy_policy_url", privacy_policy_url),
            ("data_excluded_from_ai_training", data_excluded_from_ai_training),
            ("vendor_description", vendor_description),
            ("current_installed_version", current_installed_version),
            ("is_current_version_supported", is_current_version_supported),
            ("latest_released_version", latest_released_version),
            ("latest_release_date", latest_release_date),
            ("latest_release_documentation_link", latest_release_documentation_link),
        ]:
            if val is not None:
                payload[field] = val

        if not payload:
            return {"error": "VALIDATION_ERROR", "details": "No fields provided to update"}

        headers: Dict[str, str] = {"Content-Type": "application/json"}
        if tenant_id:
            headers["x-tenant-id"] = str(tenant_id)

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.patch(
                f"{TAVRO_API_URL}/api/v1/applications/{application_id}",
                json=payload,
                headers=headers,
            )
            resp.raise_for_status()
            return resp.json()
    except ValueError as ve:
        return {"error": "VALIDATION_ERROR", "details": str(ve)}
    except Exception as e:
        return {"error": "INTERNAL_ERROR", "details": str(e)}


@core.tool(name="delete_application")
async def delete_application(original_prompt: str, *, application_id: str) -> Dict[str, Any]:
    """
    Delete a business application and its agent/use-case relationships.

    Args:
        original_prompt (str): REQUIRED verbatim user message.
        application_id (str): The business_application_id to delete.

    Returns:
        Dict[str, Any]: {"status": "deleted", "application_id": str} or error details.
    """
    try:
        token = get_access_token()
        tenant_id = token.claims.get("tenant_id") if token else None
        log_tool_call("delete_application", original_prompt, {"application_id": application_id}, tenant_id)

        headers = {"x-tenant-id": str(tenant_id)} if tenant_id else {}
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.delete(
                f"{TAVRO_API_URL}/api/v1/applications/{application_id}",
                headers=headers,
            )
            resp.raise_for_status()
            return resp.json()
    except ValueError as ve:
        return {"error": "VALIDATION_ERROR", "details": str(ve)}
    except Exception as e:
        return {"error": "INTERNAL_ERROR", "details": str(e)}


# =============================================================
# ── BUSINESS PROCESSES: CRUD + blueprint relationship ─────────
# =============================================================

@core.tool(name="get_process_catalog")
async def get_process_catalog(original_prompt: str, *, start_record: int = 1, record_range: str = "1-10", company_id: Optional[str]) -> Dict[str, Any]:
    """
    Retrieve paginated process catalog.

    Args:
        original_prompt (str): REQUIRED verbatim user message.
        start_record (int): Start index.
        record_range (str): Range like "1-10".
        company_id (Optional[str]): REQUIRED. Active company UUID, or null if no company context is active.
                                    Returns processes for this company plus global processes (company_id IS NULL).

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
                "company_id": company_id,
            },
            tenant_id,
        )

        result = AgentMetadataExporter.get_process_catalog(
            start_record=start_record,
            record_range=record_range,
            tenant_id=str(tenant_id),
            company_id=company_id,
        )

        return result

    except ValueError as ve:
        return {"error": "VALIDATION_ERROR", "details": str(ve)}
    except Exception as e:
        return {"error": "INTERNAL_ERROR", "details": str(e)}


@core.tool(name="get_process")
async def get_process(original_prompt: str, *, process_id: str, company_id: Optional[str]) -> Dict[str, Any]:
    """
    Retrieve a business process by its ID.

    Args:
        original_prompt (str): REQUIRED verbatim user message.
        process_id (str): The business_process_id (hex string).
        company_id (Optional[str]): REQUIRED. Active company UUID, or null if no company context is active.
                                    Returns the process only if it belongs to this company or is a
                                    global process (company_id IS NULL).

    Returns:
        Dict[str, Any]: Full process record including name, description, owner,
                        stakeholders, criticality, risk scores, company_id.
    """
    try:
        token = get_access_token()
        tenant_id = token.claims.get("tenant_id") if token else None
        log_tool_call("get_process", original_prompt, {"process_id": process_id, "company_id": company_id}, tenant_id)

        headers = {"x-tenant-id": str(tenant_id)} if tenant_id else {}
        params: Dict[str, Any] = {}
        if company_id and company_id.strip():
            params["company_id"] = company_id.strip()
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                f"{TAVRO_API_URL}/api/v1/processes/{process_id}",
                params=params,
                headers=headers,
            )
            resp.raise_for_status()
            return resp.json()
    except ValueError as ve:
        return {"error": "VALIDATION_ERROR", "details": str(ve)}
    except Exception as e:
        return {"error": "INTERNAL_ERROR", "details": str(e)}


@core.tool(name="create_process")
async def create_process(
    original_prompt: str,
    *,
    process_name: str,
    company_id: Optional[str],
    process_number: Optional[str] = None,
    process_description: Optional[str] = None,
    tags: Optional[List[str]] = None,
    parent_process_id: Optional[str] = None,
    stakeholders: Optional[str] = None,
    owner: Optional[str] = None,
    operators: Optional[str] = None,
    business_criticality: Optional[str] = None,
    reputational_impact: Optional[str] = None,
    financial_impact: Optional[str] = None,
    regulatory_impact: Optional[str] = None,
    sla: Optional[str] = None,
    process_health_state: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Create a new business process and optionally link it to a company's blueprint.

    When company_id is provided, the process is automatically synced to the company's
    blueprint as a 'process' dimension node.

    Args:
        original_prompt (str): REQUIRED verbatim user message.
        process_name (str): Name of the business process (required).
        company_id (Optional[str]): REQUIRED. Active company UUID, or null. When provided, links the process to the company's blueprint.
        process_number (str, optional): Process identifier/number (e.g. "P-001").
        process_description (str, optional): Description of the process workflow.
        tags (List[str], optional): Descriptive tags for the process (e.g. ["finance", "automated"]).
        parent_process_id (str, optional): ID of a parent process for hierarchy.
        stakeholders (str, optional): Names of process stakeholders.
        owner (str, optional): Process owner name or team.
        operators (str, optional): Who operates this process.
        business_criticality (str, optional): One of: "Tier 1 (Systemic)" | "Tier 2 (Core)"
                                               | "Tier 3 (Operational)" | "Tier 4 (Experimental)".
        reputational_impact (str, optional): "Toxic" | "Adverse" | "Private" | "Contained".
        financial_impact (str, optional): "Systemic" | "Material" | "Absorbable" | "Immaterial".
        regulatory_impact (str, optional): "Restricted" | "Statutory" | "Governed" | "Unregulated".
        sla (str, optional): Service Level Agreement description.
        process_health_state (str, optional): Current health state of the process.

    Returns:
        Dict[str, Any]: Created process record with business_process_id and all fields.
    """
    try:
        token = get_access_token()
        tenant_id = token.claims.get("tenant_id") if token else None
        log_tool_call(
            "create_process",
            original_prompt,
            {"process_name": process_name, "company_id": company_id},
            tenant_id,
        )

        payload: Dict[str, Any] = {"process_name": process_name}
        if tags is not None:
            payload["tags"] = tags
        for field, val in [
            ("process_number", process_number),
            ("process_description", process_description),
            ("parent_process_id", parent_process_id),
            ("stakeholders", stakeholders),
            ("owner", owner),
            ("operators", operators),
            ("business_criticality", business_criticality),
            ("reputational_impact", reputational_impact),
            ("financial_impact", financial_impact),
            ("regulatory_impact", regulatory_impact),
            ("sla", sla),
            ("process_health_state", process_health_state),
        ]:
            if val is not None:
                payload[field] = val

        headers: Dict[str, str] = {"Content-Type": "application/json"}
        if tenant_id:
            headers["x-tenant-id"] = str(tenant_id)

        url = f"{TAVRO_API_URL}/api/v1/processes"
        if company_id:
            url += f"?company_id={company_id}"

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
            return resp.json()
    except ValueError as ve:
        return {"error": "VALIDATION_ERROR", "details": str(ve)}
    except Exception as e:
        return {"error": "INTERNAL_ERROR", "details": str(e)}


@core.tool(name="update_process")
async def update_process(
    original_prompt: str,
    *,
    process_id: str,
    process_name: Optional[str] = None,
    process_number: Optional[str] = None,
    process_description: Optional[str] = None,
    tags: Optional[List[str]] = None,
    parent_process_id: Optional[str] = None,
    stakeholders: Optional[str] = None,
    owner: Optional[str] = None,
    operators: Optional[str] = None,
    business_criticality: Optional[str] = None,
    reputational_impact: Optional[str] = None,
    financial_impact: Optional[str] = None,
    regulatory_impact: Optional[str] = None,
    sla: Optional[str] = None,
    process_health_state: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Update fields on an existing business process. Only provided fields are changed.

    Args:
        original_prompt (str): REQUIRED verbatim user message.
        process_id (str): The business_process_id to update.
        process_name (str, optional): Updated process name.
        process_number (str, optional): Updated process number.
        process_description (str, optional): Updated description.
        tags (List[str], optional): Updated tags.
        parent_process_id (str, optional): Updated parent process ID.
        stakeholders (str, optional): Updated stakeholders.
        owner (str, optional): Updated owner.
        operators (str, optional): Updated operators.
        business_criticality (str, optional): Updated criticality tier.
        reputational_impact (str, optional): Updated reputational impact.
        financial_impact (str, optional): Updated financial impact.
        regulatory_impact (str, optional): Updated regulatory impact.
        sla (str, optional): Updated SLA.
        process_health_state (str, optional): Updated health state.

    Returns:
        Dict[str, Any]: Updated process record or error details.
    """
    try:
        token = get_access_token()
        tenant_id = token.claims.get("tenant_id") if token else None
        log_tool_call("update_process", original_prompt, {"process_id": process_id}, tenant_id)

        payload: Dict[str, Any] = {}
        if tags is not None:
            payload["tags"] = tags
        for field, val in [
            ("process_name", process_name),
            ("process_number", process_number),
            ("process_description", process_description),
            ("parent_process_id", parent_process_id),
            ("stakeholders", stakeholders),
            ("owner", owner),
            ("operators", operators),
            ("business_criticality", business_criticality),
            ("reputational_impact", reputational_impact),
            ("financial_impact", financial_impact),
            ("regulatory_impact", regulatory_impact),
            ("sla", sla),
            ("process_health_state", process_health_state),
        ]:
            if val is not None:
                payload[field] = val

        if not payload:
            return {"error": "VALIDATION_ERROR", "details": "No fields provided to update"}

        headers: Dict[str, str] = {"Content-Type": "application/json"}
        if tenant_id:
            headers["x-tenant-id"] = str(tenant_id)

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.patch(
                f"{TAVRO_API_URL}/api/v1/processes/{process_id}",
                json=payload,
                headers=headers,
            )
            resp.raise_for_status()
            return resp.json()
    except ValueError as ve:
        return {"error": "VALIDATION_ERROR", "details": str(ve)}
    except Exception as e:
        return {"error": "INTERNAL_ERROR", "details": str(e)}


@core.tool(name="delete_process")
async def delete_process(original_prompt: str, *, process_id: str) -> Dict[str, Any]:
    """
    Delete a business process record.

    Args:
        original_prompt (str): REQUIRED verbatim user message.
        process_id (str): The business_process_id to delete.

    Returns:
        Dict[str, Any]: {"status": "deleted", "process_id": str} or error details.
    """
    try:
        token = get_access_token()
        tenant_id = token.claims.get("tenant_id") if token else None
        log_tool_call("delete_process", original_prompt, {"process_id": process_id}, tenant_id)

        headers = {"x-tenant-id": str(tenant_id)} if tenant_id else {}
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.delete(
                f"{TAVRO_API_URL}/api/v1/processes/{process_id}",
                headers=headers,
            )
            resp.raise_for_status()
            return resp.json()
    except ValueError as ve:
        return {"error": "VALIDATION_ERROR", "details": str(ve)}
    except Exception as e:
        return {"error": "INTERNAL_ERROR", "details": str(e)}


# =============================================================
# ── BUSINESS INTEGRATIONS: CRUD + blueprint relationship ──────
# =============================================================

@core.tool(name="list_integrations")
async def list_integrations(
    original_prompt: str,
    *,
    company_id: Optional[str],
    search: Optional[str] = None,
    offset: int = 0,
    limit: int = 50,
) -> Dict[str, Any]:
    """
    List business integrations, optionally filtered by company or search term.

    Args:
        original_prompt (str): REQUIRED verbatim user message.
        company_id (Optional[str]): REQUIRED. Active company UUID, or null if no company context is active.
        search (str, optional): Search by integration name or description.
        offset (int): Pagination offset (default 0).
        limit (int): Max records (default 50, max 500).

    Returns:
        Dict[str, Any]: Paginated list with total, offset, limit, items.
    """
    try:
        token = get_access_token()
        tenant_id = token.claims.get("tenant_id") if token else None
        log_tool_call(
            "list_integrations",
            original_prompt,
            {"company_id": company_id, "search": search},
            tenant_id,
        )

        params: Dict[str, Any] = {"offset": offset, "limit": limit}
        if company_id:
            params["company_id"] = company_id
        if search:
            params["q"] = search

        headers = {"x-tenant-id": str(tenant_id)} if tenant_id else {}
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                f"{TAVRO_API_URL}/api/v1/integrations",
                params=params,
                headers=headers,
            )
            resp.raise_for_status()
            return resp.json()
    except ValueError as ve:
        return {"error": "VALIDATION_ERROR", "details": str(ve)}
    except Exception as e:
        return {"error": "INTERNAL_ERROR", "details": str(e)}


@core.tool(name="get_integration")
async def get_integration(original_prompt: str, *, integration_id: str, company_id: Optional[str]) -> Dict[str, Any]:
    """
    Retrieve a business integration by its ID.

    Args:
        original_prompt (str): REQUIRED verbatim user message.
        integration_id (str): The integration_id (hex string).
        company_id (Optional[str]): REQUIRED. Active company UUID, or null if no company context is active.
                                    Returns the integration only if it belongs to this company or is a
                                    global integration (company_id IS NULL).

    Returns:
        Dict[str, Any]: Full integration record including name, description, protocol,
                        endpoint_url, capabilities, sla, company_id.
    """
    try:
        token = get_access_token()
        tenant_id = token.claims.get("tenant_id") if token else None
        log_tool_call("get_integration", original_prompt, {"integration_id": integration_id, "company_id": company_id}, tenant_id)

        headers = {"x-tenant-id": str(tenant_id)} if tenant_id else {}
        params: Dict[str, Any] = {}
        if company_id and company_id.strip():
            params["company_id"] = company_id.strip()
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                f"{TAVRO_API_URL}/api/v1/integrations/{integration_id}",
                params=params,
                headers=headers,
            )
            resp.raise_for_status()
            return resp.json()
    except ValueError as ve:
        return {"error": "VALIDATION_ERROR", "details": str(ve)}
    except Exception as e:
        return {"error": "INTERNAL_ERROR", "details": str(e)}


@core.tool(name="create_integration")
async def create_integration(
    original_prompt: str,
    *,
    integration_name: str,
    company_id: Optional[str],
    integration_description: Optional[str] = None,
    tags: Optional[List[str]] = None,
    capabilities: Optional[str] = None,
    protocol: Optional[str] = None,
    endpoint_url: Optional[str] = None,
    authentication_method: Optional[str] = None,
    owner: Optional[str] = None,
    documentation_url: Optional[str] = None,
    data_sensitivity: Optional[str] = None,
    rate_limit: Optional[str] = None,
    availability_status: Optional[str] = None,
    sla: Optional[str] = None,
    version: Optional[str] = None,
    parent_application_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Create a new business integration and optionally link it to a company's blueprint.

    When company_id is provided, the integration is automatically synced to the company's
    blueprint as an 'integration' dimension node.

    Args:
        original_prompt (str): REQUIRED verbatim user message.
        integration_name (str): Name of the integration (required).
        company_id (Optional[str]): REQUIRED. Active company UUID, or null. When provided, links the integration to the company's blueprint.
        integration_description (str, optional): What this integration does.
        tags (List[str], optional): Descriptive tags for the integration (e.g. ["api", "real-time"]).
        capabilities (str, optional): Comma-separated list of capabilities.
        protocol (str, optional): Communication protocol (e.g. "REST", "SOAP", "gRPC").
        endpoint_url (str, optional): API endpoint URL.
        authentication_method (str, optional): Auth type (e.g. "OAuth2", "API Key").
        owner (str, optional): Team or person responsible for this integration.
        documentation_url (str, optional): Link to integration documentation.
        data_sensitivity (str, optional): Sensitivity of data transferred (e.g. "PII", "Public").
        rate_limit (str, optional): Rate limiting configuration.
        availability_status (str, optional): Current availability status.
        sla (str, optional): Service Level Agreement.
        version (str, optional): Integration version.
        parent_application_id (str, optional): ID of the parent business application.

    Returns:
        Dict[str, Any]: Created integration record with integration_id and all fields.
    """
    try:
        token = get_access_token()
        tenant_id = token.claims.get("tenant_id") if token else None
        log_tool_call(
            "create_integration",
            original_prompt,
            {"integration_name": integration_name, "company_id": company_id},
            tenant_id,
        )

        payload: Dict[str, Any] = {"integration_name": integration_name}
        if tags is not None:
            payload["tags"] = tags
        for field, val in [
            ("integration_description", integration_description),
            ("capabilities", capabilities),
            ("protocol", protocol),
            ("endpoint_url", endpoint_url),
            ("authentication_method", authentication_method),
            ("owner", owner),
            ("documentation_url", documentation_url),
            ("data_sensitivity", data_sensitivity),
            ("rate_limit", rate_limit),
            ("availability_status", availability_status),
            ("sla", sla),
            ("version", version),
            ("parent_application_id", parent_application_id),
        ]:
            if val is not None:
                payload[field] = val

        headers: Dict[str, str] = {"Content-Type": "application/json"}
        if tenant_id:
            headers["x-tenant-id"] = str(tenant_id)

        url = f"{TAVRO_API_URL}/api/v1/integrations"
        if company_id:
            url += f"?company_id={company_id}"

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
            return resp.json()
    except ValueError as ve:
        return {"error": "VALIDATION_ERROR", "details": str(ve)}
    except Exception as e:
        return {"error": "INTERNAL_ERROR", "details": str(e)}


@core.tool(name="update_integration")
async def update_integration(
    original_prompt: str,
    *,
    integration_id: str,
    company_id: Optional[str],
    integration_name: Optional[str] = None,
    integration_description: Optional[str] = None,
    tags: Optional[List[str]] = None,
    capabilities: Optional[str] = None,
    protocol: Optional[str] = None,
    endpoint_url: Optional[str] = None,
    authentication_method: Optional[str] = None,
    owner: Optional[str] = None,
    documentation_url: Optional[str] = None,
    data_sensitivity: Optional[str] = None,
    rate_limit: Optional[str] = None,
    availability_status: Optional[str] = None,
    sla: Optional[str] = None,
    version: Optional[str] = None,
    parent_application_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Update fields on an existing business integration. Only provided fields are changed.

    Optionally pass company_id to re-sync the updated integration to the blueprint.

    Args:
        original_prompt (str): REQUIRED verbatim user message.
        integration_id (str): The integration_id to update.
        company_id (Optional[str]): REQUIRED. Active company UUID, or null. When provided, re-syncs the integration to the company's blueprint.
        integration_name (str, optional): Updated name.
        integration_description (str, optional): Updated description.
        tags (List[str], optional): Updated tags.
        capabilities (str, optional): Updated capabilities.
        protocol (str, optional): Updated protocol.
        endpoint_url (str, optional): Updated endpoint URL.
        authentication_method (str, optional): Updated auth method.
        owner (str, optional): Updated owner.
        documentation_url (str, optional): Updated docs URL.
        data_sensitivity (str, optional): Updated data sensitivity.
        rate_limit (str, optional): Updated rate limit.
        availability_status (str, optional): Updated availability.
        sla (str, optional): Updated SLA.
        version (str, optional): Updated version.
        parent_application_id (str, optional): Updated parent application ID.

    Returns:
        Dict[str, Any]: Updated integration record or error details.
    """
    try:
        token = get_access_token()
        tenant_id = token.claims.get("tenant_id") if token else None
        log_tool_call("update_integration", original_prompt, {"integration_id": integration_id}, tenant_id)

        payload: Dict[str, Any] = {}
        if tags is not None:
            payload["tags"] = tags
        for field, val in [
            ("integration_name", integration_name),
            ("integration_description", integration_description),
            ("capabilities", capabilities),
            ("protocol", protocol),
            ("endpoint_url", endpoint_url),
            ("authentication_method", authentication_method),
            ("owner", owner),
            ("documentation_url", documentation_url),
            ("data_sensitivity", data_sensitivity),
            ("rate_limit", rate_limit),
            ("availability_status", availability_status),
            ("sla", sla),
            ("version", version),
            ("parent_application_id", parent_application_id),
        ]:
            if val is not None:
                payload[field] = val

        if not payload:
            return {"error": "VALIDATION_ERROR", "details": "No fields provided to update"}

        headers: Dict[str, str] = {"Content-Type": "application/json"}
        if tenant_id:
            headers["x-tenant-id"] = str(tenant_id)

        url = f"{TAVRO_API_URL}/api/v1/integrations/{integration_id}"
        if company_id:
            url += f"?company_id={company_id}"

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.patch(url, json=payload, headers=headers)
            resp.raise_for_status()
            return resp.json()
    except ValueError as ve:
        return {"error": "VALIDATION_ERROR", "details": str(ve)}
    except Exception as e:
        return {"error": "INTERNAL_ERROR", "details": str(e)}


@core.tool(name="delete_integration")
async def delete_integration(original_prompt: str, *, integration_id: str) -> Dict[str, Any]:
    """
    Delete a business integration record.

    Args:
        original_prompt (str): REQUIRED verbatim user message.
        integration_id (str): The integration_id to delete.

    Returns:
        Dict[str, Any]: {"status": "deleted", "integration_id": str} or error details.
    """
    try:
        token = get_access_token()
        tenant_id = token.claims.get("tenant_id") if token else None
        log_tool_call("delete_integration", original_prompt, {"integration_id": integration_id}, tenant_id)

        headers = {"x-tenant-id": str(tenant_id)} if tenant_id else {}
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.delete(
                f"{TAVRO_API_URL}/api/v1/integrations/{integration_id}",
                headers=headers,
            )
            resp.raise_for_status()
            return resp.json()
    except ValueError as ve:
        return {"error": "VALIDATION_ERROR", "details": str(ve)}
    except Exception as e:
        return {"error": "INTERNAL_ERROR", "details": str(e)}


# ── Enterprise tools (BUILD_MODE=enterprise only) ────────────────────────────
# Mirrors tavro_api/main.py's enterprise gating. Enterprise tool modules are
# baked into /enterprise at build time (see Dockerfile.mcp.enterprise) and
# register themselves onto `core`.
if os.getenv("BUILD_MODE", "").strip().lower() == "enterprise":
    from mcp_server.enterprise_compliance_tools import register_compliance_tools
    register_compliance_tools(
        core,
        tavro_api_url=TAVRO_API_URL,
        log_tool_call=log_tool_call,
        get_access_token=get_access_token,
    )


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
