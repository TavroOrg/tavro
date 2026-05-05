import os
import uvicorn
from typing import Dict, Any, Optional, List

from fastmcp import FastMCP
from starlette.routing import Route
from starlette.responses import JSONResponse
from fastmcp.server.auth.providers.github import GitHubProvider

from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware

from risk_agents.agent_extractor import AgentMetadataExporter

from utils.set_environment import set_environment



set_environment("mcp")
set_environment("oAuth")
set_environment("secrets")
set_environment("fastapi")

# ---------------------------
# Constants / deployment URLs
# ---------------------------
# Priority: mcp_root_url from config.yaml → fallback to http://localhost:<port>
_root_url_override = os.getenv("mcp_root_url", "").strip()
ROOT_URL = _root_url_override if _root_url_override else f"http://{os.getenv('mcp_host', 'localhost')}:{os.getenv('mcp_port', '9000')}"

# -----------------------------------------------------------------------
#  NEW: Custom Cognito token verifier — preserves email from JWT claims
# -----------------------------------------------------------------------
auth = GitHubProvider(
    client_id=os.getenv("GITHUB_CLIENT_ID"),
    client_secret=os.getenv("GITHUB_CLIENT_SECRET"),
    base_url=ROOT_URL,
    jwt_signing_key=os.getenv("JWT_SIGNING_KEY"),
    required_scopes=["read:user"],
)


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

mcp = FastMCP("AWS Cognito OAuth Example Server", auth=auth)
# Apply CORS middleware to the MCP server's app
app = mcp.http_app(middleware=middleware)

async def root_health(request):
    return JSONResponse({"status": "ok"})

app.router.routes.append(
    Route("/health", root_health, methods=["GET"])
)

# ---------------------------
# tools
# ---------------------------

@mcp.tool(name="get_agent_card")
async def get_agent_card(agent_name: Optional[str] = None, agent_id: Optional[str] = None) -> Dict[str, Any]:
    """
    Retrieve the full agent card metadata and risk summary for a specific AI agent by name.

    This tool returns the complete set of attributes for the given AI agent,
    including capabilities, modes, metadata, identification, risk assessment,
    provider information, transport/protocol details, and versioning.

    Use this tool whenever detailed information about a particular AI agent is requested.

    Args:
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

    try:

        result = AgentMetadataExporter.get_agent_card(agent_name=agent_name, agent_id=agent_id)
        if result is None:
            return {"error": "NOT_FOUND", "details": f"No agent found with name '{agent_name}'"}

        return result

    except ValueError as ve:
        print("Validation error: %s", ve)
        return {"error": "VALIDATION_ERROR", "details": str(ve)}

    except Exception as e:
        print("Unexpected error")
        return {"error": "INTERNAL_ERROR", "details": str(e)}

@mcp.tool(name="get_agent_catalog")
async def get_agent_catalog(start_record: int = 1, record_range: str = "1-10") -> Dict[str, Any]:
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
        result = AgentMetadataExporter.get_agent_catalog(
            start_record=start_record,
            record_range=record_range,
        )

        return result

    except ValueError as ve:
        print("Validation error: %s", ve)
        return {"error": "VALIDATION_ERROR", "details": str(ve)}

    except Exception as e:
        print("Unexpected error")
        return {"error": "INTERNAL_ERROR", "details": str(e)}

@mcp.tool(name="create_agent")
async def create_agent(agent_name: str, description: str, instruction: str, tools: Optional[List[Dict[str, str]]] = None, knowledge_source: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    """
    Create and register a new AI agent with defined identity, behavior, and optional integrations.

    This function initializes an agent by capturing its core configuration, including its
    name, purpose, and operational instructions. The agent can optionally be extended with
    external tools and knowledge sources to enhance its capabilities.

    The `instruction` parameter defines the agent’s behavior and decision-making logic,
    guiding how it processes inputs and generates responses.

    Optional integrations:
    - `tools`: A list of tools the agent can use to perform external actions (e.g., APIs,
    workflows). Each tool must be defined as a dictionary with:
        {
            "name": str,
            "description": str
        }

    - `knowledge_source`: A reference to an external knowledge source that the agent can
    use for contextual understanding. If provided, it must follow:
        {
            "name": str,
            "description": str
        }

    All inputs are validated before agent creation. On success, the function returns a
    standardized response containing the agent’s metadata. In case of validation or
    runtime errors, an appropriate error response is returned.

    Args:
        agent_name (str): Unique name of the agent.
        description (str): Brief description of the agent’s purpose.
        instruction (str): Behavioral instructions that define how the agent operates.
        tools (Optional[List[Dict[str, str]]]): Optional list of tool definitions.
        knowledge_source (Optional[Dict[str, str]]): Optional knowledge source definition.

    Returns:
        Dict[str, Any]: A response containing agent metadata or error details.
    """
    print("Create agent requested")

    try:

        result = AgentMetadataExporter.create_agent(
            agent_name=agent_name,
            description=description,
            instruction=instruction,
            tools=tools,
            # data_source=data_source,
            knowledge_source=knowledge_source
        )
        return result

    except ValueError as ve:
        print("Validation error: %s", ve)
        return {"error": "VALIDATION_ERROR", "details": str(ve)}

    except Exception as e:
        print("Unexpected error")
        return {"error": "INTERNAL_ERROR", "details": str(e)}

@mcp.tool(name="create_risk_assessment")
async def create_risk_assessment(agent_id: str) -> Dict[str, Any]:
    """
    Create a risk assessment for an existing agent by taking input as agent_id.
    This tool fetches the agent's metadata and triggers the risk assessment.
    """
    print(f"Create risk assessment requested for agent_id={agent_id}")

    try:
        return AgentMetadataExporter.create_risk_assessment_from_agent_id(agent_id=agent_id)

    except ValueError as ve:
        print("Validation error: %s", ve)
        return {"error": "VALIDATION_ERROR", "details": str(ve)}

    except Exception as e:
        print("Unexpected error")
        return {"error": "INTERNAL_ERROR", "details": str(e)}

@mcp.tool(name="create_ai_use_case")
async def create_ai_use_case(title: str, description: str, business_problem_statement: str, expected_benefits: str, priority: str, regulatory_impact: Optional[List[str]] = None, solution_approach: Optional[str] = None, use_case_owner: Optional[str] = None, impacted_business_applications: Optional[List[str]] = None, impacted_business_processes: Optional[List[str]] = None) -> Dict[str, Any]:
    """
    Register a new AI Use Case to establish governance and business context.

    This function creates a new AI use case record, capturing key business and technical details needed for oversight, risk assessment, and lifecycle management. It helps align system capabilities with intended business outcomes and supports governance processes.

    Args:

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
        print(f"Received title: '{title}', description: '{description}', business_problem_statement: '{business_problem_statement}', expected_benefits: '{expected_benefits}', priority: '{priority}', regulatory_impact: '{regulatory_impact}', solution_approach: '{solution_approach}', use_case_owner: '{use_case_owner}', impacted_business_applications: '{impacted_business_applications}', impacted_business_processes: '{impacted_business_processes}'")

        result = AgentMetadataExporter.create_ai_use_case(
            title=title,
            description=description,
            business_problem_statement=business_problem_statement,
            expected_benefits=expected_benefits,
            priority=priority,
            regulatory_impact=regulatory_impact,
            solution_approach=solution_approach,
            use_case_owner=use_case_owner,
            impacted_business_applications=impacted_business_applications,
            impacted_business_processes=impacted_business_processes,
        )
        print(result)
        return result

    except ValueError as ve:
        print("Validation error: %s", ve)
        return {"error": "VALIDATION_ERROR", "details": str(ve)}

    except Exception as e:
        print("Unexpected error")
        return {"error": "INTERNAL_ERROR", "details": str(e)}

@mcp.tool(name="get_ai_use_case")
async def get_ai_use_case(use_case_id: Optional[str] = None, title: Optional[str] = None, start_record: int = 1, record_range: str = "1-10") -> Dict[str, Any]:
    """
    This function fetches AI use case records from a data source. You can filter results using identifiers or titles, and control pagination using record position and range parameters.

    Args:

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
    print("Get AI Use Case requested for use_case_id=%s title=%s start=%s range=%s", use_case_id, title, start_record, record_range)

    try:

        result = AgentMetadataExporter.get_ai_use_case(
            use_case_id=use_case_id,
            title=title,
            start_record=start_record,
            record_range=record_range,
        )

        return result
    
    except ValueError as ve:
        print("Validation error: %s", ve)
        return {"error": "VALIDATION_ERROR", "details": str(ve)}

    except Exception as e:
        print("Unexpected error")
        return {"error": "INTERNAL_ERROR", "details": str(e)}

@mcp.tool(name="create_ai_use_case_agent_relationship")
async def create_ai_use_case_agent_relationship(agent_catalog_id: str, ai_use_case_id: str) -> Dict[str, Any]:
    """
    Create/Register a relationship between an AI Use Case and an Agent.

    The tool resolves both IDs to internal records and creates the relationship.

    Args:
        agent_catalog_id (str): Agent Catalog ID.
        ai_use_case_id (str): AI Use Case ID.

    Returns:
        Dict[str, Any]: Relationship creation response.
    """
    print(f"Create AI Use Case-Agent relationship requested for agent_catalog_id={agent_catalog_id} ai_use_case_id={ai_use_case_id}")

    try:

        result = AgentMetadataExporter.create_ai_use_case_agent_relationship(
            agent_catalog_id=agent_catalog_id,
            ai_use_case_id=ai_use_case_id,
        )
        return result

    except ValueError as ve:
        print("Validation error: %s", ve)
        return {"error": "VALIDATION_ERROR", "details": str(ve)}

    except Exception as e:
        print("Unexpected error")
        return {"error": "INTERNAL_ERROR", "details": str(e)}


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
