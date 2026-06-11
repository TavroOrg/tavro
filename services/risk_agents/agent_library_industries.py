from crewai import Agent, Task, Crew, Process
from crewai_tools import WebsiteSearchTool
from pydantic import BaseModel, field_validator
from services.risk_agents.llm_config import get_crewai_llm
import os

GICS_WIKIPEDIA_URL = "https://en.wikipedia.org/wiki/Global_Industry_Classification_Standard"
DEFAULT_EMBEDDER = "onnx"


# ---------- Output schema ----------

class AgentIndustriesOutput(BaseModel):
    industry: str

    @field_validator("industry", mode="before")
    @classmethod
    def validate_industry(cls, v):
        if isinstance(v, list):
            v = v[0] if v else ""
        cleaned = str(v).strip()
        if not cleaned:
            raise ValueError("industry must be a non-empty string.")
        return cleaned


# ---------- Main function ----------

def classify_agent_industries(
    agent_name: str,
    agent_description: str,
    use_case_context: str,
) -> dict:
    """
    Maps an AI agent to the single most relevant GICS Industry (third level:
    Sector → Industry Group → Industry → Sub-Industry), sourced live from
    the GICS Wikipedia page.

    Returns a dict with a single key: industry (str) containing
    the exact GICS Industry name.
    """

    gics_tool = WebsiteSearchTool(
        website=GICS_WIKIPEDIA_URL,
        collection_name="gics_taxonomy",
        config={
            "embedding_model": {
                "provider": os.getenv("CREWAI_TXT_SEARCH_EMBEDDER", DEFAULT_EMBEDDER).strip()
                            or DEFAULT_EMBEDDER,
                "config": {},
            },
        },
    )

    industry_agent = Agent(
        role="GICS Industry Classifier",
        goal=(
            "Map an AI agent's capabilities to the single most relevant GICS Industry "
            "from the Global Industry Classification Standard by consulting the GICS "
            "Wikipedia page. "
            "GICS has four levels: Sector, Industry Group, Industry, Sub-Industry. "
            "You MUST output exactly one name from the third level — Industry — only. "
            "You never output a Sector, Industry Group, Sub-Industry, or invented name."
        ),
        verbose=True,
        memory=False,
        backstory=(
            "You are a financial analyst and enterprise AI specialist trained in the "
            "Global Industry Classification Standard (GICS), the joint standard developed "
            "by S&P Dow Jones Indices and MSCI. "
            "GICS has four levels: Sector → Industry Group → Industry → Sub-Industry. "
            "You specialise in the third level — Industry (e.g. Software, Banks, "
            "Pharmaceuticals, Aerospace & Defense). You consult the taxonomy directly "
            "to ensure you only use authoritative, correctly spelled Industry names."
        ),
        tools=[gics_tool],
        llm=get_crewai_llm(),
    )

    industry_task = Task(
        description=(
            "You MUST follow all rules exactly.\n"
            "Return ONLY the required JSON. Do NOT include any text outside the JSON.\n\n"

            "## INPUT\n"
            "- agent_name: {agent_name}\n"
            "- agent_description: {agent_description}\n"
            "- use_case_context: {use_case_context}\n\n"

            "---\n\n"

            "## SECTION 1 — Fetch the GICS Taxonomy (MANDATORY first step)\n\n"
            f"Search the GICS taxonomy at {GICS_WIKIPEDIA_URL} to retrieve the full "
            "four-level hierarchy: Sector → Industry Group → Industry → Sub-Industry. "
            "You MUST use the tool before classifying. "
            "Focus on the third level — Industry.\n\n"

            "---\n\n"

            "## SECTION 2 — Classification Rules (MANDATORY)\n\n"
            "EVIDENCE RULE:\n"
            "  Base your classification ONLY on information explicitly stated in "
            "agent_description and use_case_context. Do NOT infer from the agent name alone.\n\n"
            "LEVEL RULE (CRITICAL):\n"
            "  GICS has four levels: Sector, Industry Group, Industry, Sub-Industry.\n"
            "  You MUST select from the THIRD level — Industry — only.\n"
            "  Do NOT output a Sector (level 1), Industry Group (level 2), "
            "or Sub-Industry (level 4).\n\n"
            "SCOPE RULES:\n"
            "  - Select exactly ONE GICS Industry that best represents the agent's primary domain.\n"
            "  - If the agent is cross-domain, select the ONE Industry where it has the "
            "    most direct and meaningful applicability.\n\n"
            "NAME RULES (CRITICAL):\n"
            "  - Copy the Industry name EXACTLY as it appears in the GICS taxonomy "
            "    — character for character, including capitalisation and punctuation.\n"
            "  - Do NOT paraphrase, abbreviate, or create composite names.\n"
            "  - Do NOT use acronyms.\n\n"

            "---\n\n"

            "## SECTION 3 — Quality Check (MANDATORY before output)\n"
            "  - Confirm the output value appears verbatim in the Industry column of the "
            "    GICS taxonomy (third level).\n"
            "  - Confirm it is NOT a Sector, Industry Group, or Sub-Industry.\n"
            "  - Confirm exactly ONE Industry name is returned.\n"
            "  - Confirm no free-form or invented name appears.\n"
            "  - Confirm no text exists outside the required JSON.\n\n"

            "---\n\n"

            "## SECTION 4 — Output\n"
            "Return ONLY the following JSON structure:\n"
        ),
        expected_output=(
            "{"
            "  \"industry\": \"<exact GICS Industry name (third level only)>\""
            "}"
        ),
        agent=industry_agent,
        tools=[gics_tool],
        output_json=AgentIndustriesOutput,
    )

    inputs = {
        "agent_name":        agent_name,
        "agent_description": agent_description,
        "use_case_context":  use_case_context,
    }

    crew = Crew(
        agents=[industry_agent],
        tasks=[industry_task],
        process=Process.sequential,
        verbose=True,
        tracing=False,
    )

    result = crew.kickoff(inputs=inputs)
    raw = result.json_dict

    industry = raw.get("industry", "")
    if isinstance(industry, list):
        industry = industry[0] if industry else ""

    return {"industry": str(industry).strip()}
