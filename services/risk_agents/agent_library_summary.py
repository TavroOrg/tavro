from crewai import Agent, Task, Crew, Process
from pydantic import BaseModel, field_validator
from services.risk_agents.llm_config import get_crewai_llm


# ---------- Output schema ----------

class AgentSummaryOutput(BaseModel):
    summary: str

    @field_validator("summary", mode="before")
    @classmethod
    def validate_summary(cls, v):
        text = str(v).strip()
        if not text:
            raise ValueError("summary must be a non-empty string.")
        return text


# ---------- Main function ----------

def generate_agent_summary(
    agent_name: str,
    agent_description: str,
    use_case_context: str,
) -> dict:
    """
    Generates a 1-2 sentence plain-English summary for an agent library entry.

    The summary:
      - States clearly what the agent does and why it is useful.
      - Contains NO acronyms (every abbreviation is spelled out in full).
      - Contains NO client names, company names, or organisation references.
      - Is vendor-neutral and broadly applicable.

    Returns a dict with a single key: summary (str).
    """

    summary_agent = Agent(
        role="Agent Library Summary Writer",
        goal=(
            "Write a concise, jargon-free 1-2 sentence description of an AI agent "
            "that can appear in a publicly facing agent library catalog. "
            "The description must communicate purpose and value without using acronyms "
            "or referencing any specific client, company, or organisation."
        ),
        verbose=True,
        memory=False,
        backstory=(
            "You are a senior technical writer with expertise in AI governance and enterprise "
            "software documentation. You distil complex agent descriptions into clear, accessible "
            "language suitable for business and technical audiences alike. "
            "You never use abbreviations without spelling them out first, and you never mention "
            "client names or proprietary system names."
        ),
        llm=get_crewai_llm(),
    )

    summary_task = Task(
        description=(
            "You MUST follow all rules exactly.\n"
            "Return ONLY the required JSON. Do NOT include any text outside the JSON.\n\n"

            "## INPUT\n"
            "- agent_name: {agent_name}\n"
            "- agent_description: {agent_description}\n"
            "- use_case_context: {use_case_context}\n\n"

            "---\n\n"

            "## SECTION 1 — Summary Rules (MANDATORY)\n\n"
            "Write exactly 1-2 sentences that:\n"
            "  1. State what the agent does (its primary capability or function).\n"
            "  2. State why it is useful (the business or operational value it delivers).\n\n"
            "HARD CONSTRAINTS — violating any of these invalidates the output:\n"
            "  - NO acronyms of any kind. If you must reference a concept that is commonly "
            "    abbreviated, spell it out in full (e.g., write 'artificial intelligence' not 'AI', "
            "    'application programming interface' not 'API', "
            "    'large language model' not 'LLM').\n"
            "  - NO client names, company names, product names, or organisation references "
            "    of any kind — even if they appear in the input.\n"
            "  - NO proprietary system names, internal project names, or brand names.\n"
            "  - NO filler phrases such as 'This agent...', 'The agent is designed to...', "
            "    'Leveraging AI...', or similar.\n"
            "  - The summary must be vendor-neutral and applicable across industries.\n\n"

            "---\n\n"

            "## SECTION 2 — Quality Check (MANDATORY before output)\n"
            "  - Confirm no acronym appears in the summary.\n"
            "  - Confirm no proper noun referring to a client or organisation appears.\n"
            "  - Confirm the summary is exactly 1-2 sentences.\n"
            "  - Confirm no text exists outside the required JSON.\n\n"

            "---\n\n"

            "## SECTION 3 — Output\n"
            "Return ONLY the following JSON structure:\n"
        ),
        expected_output=(
            "{"
            "  \"summary\": \"<1-2 sentence plain-English description — no acronyms, no client references>\""
            "}"
        ),
        agent=summary_agent,
        output_json=AgentSummaryOutput,
    )

    inputs = {
        "agent_name":        agent_name,
        "agent_description": agent_description,
        "use_case_context":  use_case_context,
    }

    crew = Crew(
        agents=[summary_agent],
        tasks=[summary_task],
        process=Process.sequential,
        verbose=True,
        tracing=False,
    )

    result = crew.kickoff(inputs=inputs)
    raw = result.json_dict

    return {
        "summary": str(raw.get("summary", "")).strip(),
    }
