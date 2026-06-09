import os
from pathlib import Path
from crewai import Agent, Task, Crew, Process
from crewai_tools import TXTSearchTool
from pydantic import BaseModel
from services.risk_agents.llm_config import get_crewai_llm

DEFAULT_TXT_SEARCH_EMBEDDER = "onnx"

# ---------- Output schemas ----------
class Article5Output(BaseModel):
    subliminal_and_manipulative_techniques: str
    exploitation_of_vulnerabilities: str
    social_scoring_systems: str
    risk_assessment_for_criminal_offences: str
    facial_recognition_database_creation: str
    emotion_inference_in_workplace_and_education: str
    biometric_categorisation: str
    real_time_remote_biometric_identification: str


class Article6Output(BaseModel):
    biometrics: str
    critical_infrastructure: str
    education_and_vocational_training: str
    employment_and_self_employment: str
    access_to_essential_services: str
    law_enforcement: str
    migration_and_border_control: str
    administration_of_justice: str
    safety_component_of_a_product: str
    medical_devices: str
    in_vitro_diagnostic_medical_devices: str
    other_high_risk_items: str


class RiskClassificationOutput(BaseModel):
    risk_classification: str
    personally_identifiable_information: str
    protected_health_information: str
    payment_card_industry: str
    article_5: Article5Output
    article_6: Article6Output
    risk_rating_rationale: str


def classify_risk(agent_name: str, agent_description: str, agent_instructions: str):
    skills_file = Path(__file__).resolve().parent.parent / "skills" / "EU_AI_Act.txt"
    txt_tool = TXTSearchTool(
        txt=str(skills_file),
        collection_name="eu_ai_act_risk_classification",
        config={
            "embedding_model": {
                "provider": os.getenv("CREWAI_TXT_SEARCH_EMBEDDER", DEFAULT_TXT_SEARCH_EMBEDDER).strip() or DEFAULT_TXT_SEARCH_EMBEDDER,
                "config": {},
            },
        },
    )
    
    risk_classification_agent = Agent(
        role="Risk Classification Agent",
        goal=(
            "Analyze the provided agent name or use case and its description to determine the risk classification based on the EU_AI_Act.txt Fill the JSON fields for Articles 5 and 6 with detailed assessments and justifications, including a classification based on PII, PHI, and PCI information."
        ),
        verbose=True,
        memory=False,
        backstory=(
            "You specialize in evaluating AI agents and use cases in the context of the EU AI Act." 
            "By analyzing functionalities, purposes, and compliance requirements, you provide well-reasoned risk classifications with detailed justifications."
        ),
        tools=[txt_tool],
        llm=get_crewai_llm()
    )

    risk_classification_task = Task(
        description=(
            "Thoroughly analyze the EU_AI_Act.txt to understand its regulations."
            "Based on the user-provided **agent name or use case** {agent_name}, **description** {description}, and **instructions** {agent_instructions},"
            "classify the risk as 'Prohibited', 'High Risk', or 'Other'."
    
            "**Business Rules for Classification:**"
            "* Make sure to refer each of the points and sub-points from the EU_AI_Act.txt article 5 and article 6 and relate them wisely with fields marking as 'Yes'or 'No'."
            "* If any field from **Article 5** is marked as 'Yes', the classification must be **'Prohibited'**."
            "* If any field from **Article 6** is marked as 'Yes', the classification must be **'High Risk'**."
            "* If all fields are marked as 'No' and the input does not align with Articles 5 or 6, classify as **'Other'**."
            "* If the input relates to **'Clinical Trials for Digital Twins'** or **'Digital Twins for Personalized Health Care'**, classify as **'High Risk'**."
            "* If the input relates to **'Anti-Money Laundering'** or **'Fraud Detection'**, classify as **'Other'**."
            "* If the input is **only about creating a training module or training class**, classify as **'Other'**."
    
    
            ### **Steps to Follow:**
            "1. Analyze the provided {agent_name},{description} and {agent_instructions} to infer the **intended purpose** and **functionality**."
            "2. Read the **EU_AI_Act.txt** carefully to ensure accurate classification."
            "3. Identify relevant fields from **Article 5** and **Article 6** and mark them as **'Yes' or 'No' ONLY**."
            "4. If all fields are 'No', classify the agent as **'Other'**, unless otherwise indicated."
            "5. Generate a **'Risk Rating Rationale'** explaining the classification, referring to specific clauses in **EU_AI_Act.txt**."
            "6. Evaluate the data sensitivity using the following rules:"
            "    - **PII** (Personally Identifiable Information): Mark as 'Yes' if any personal identifiers such as names, emails, phone numbers, addresses, etc., are used."
            "    - **PHI** (Protected Health Information): Mark as 'Yes' if medical records, diagnoses, prescriptions, or health-related data are involved."
            "    - **PCI** (Payment Card Industry): Mark as 'Yes' if credit card numbers, debit card numbers, or any payment-related data is used."
            "    - **CRITICAL DEFAULT RULE**: If you are uncertain about PII, PHI, or PCI, you MUST default to 'Yes' to ensure privacy protection."
            "    - Base PII, PHI, PCI evaluation ONLY on information explicitly present in the agent data. Do NOT infer, assume, or speculate."
            "7. Adjust the final risk classification using this strict ordered cascade — stop at the FIRST matching rule:"
            "    - If any Article 5 field = 'Yes' → classification = **'Prohibited'**"
            "    - Else if any Article 6 field = 'Yes' → classification = **'High Risk'**"
            "    - Else if PII = 'Yes' → classification = **'High Risk'**"
            "    - Else if PHI = 'Yes' → classification = **'High Risk'**"
            "    - Else if PCI = 'Yes' → classification = **'High Risk'**"
            "    - Else → classification = **'Other'**"
            "    - **FINAL OVERRIDE**: If classification = 'Other' but any of PII, PHI, or PCI = 'Yes', set classification to **'High Risk'**. Never output 'Other' when PII, PHI, or PCI is 'Yes'."
        ),
        expected_output=(
            "{"
                "\"risk_classification\": \"<Prohibited/High Risk/Other>\","
                "\"Personally Identifiable Information\": \"<Yes/No>\","
                "\"Protected Health Information\": \"<Yes/No>\","
                "\"Payment Card Industry\": \"<Yes/No>\","
                "\"Article 5(Prohibited AI Practices)\": {"
                    "\"Subliminal and Manipulative Techniques\": \"<Yes/No>\","
                    "\"Exploitation of Vulnerabilities\": \"<Yes/No>\","
                    "\"Social Scoring Systems\": \"<Yes/No>\","
                    "\"Risk Assessment for Criminal Offences\": \"<Yes/No>\","
                    "\"Facial Recognition Database Creation\": \"<Yes/No>\","
                    "\"Emotion Inference in Workplace and Education\": \"<Yes/No>\","
                    "\"Biometric Categorisation\": \"<Yes/No>\","
                    "\"Real-Time Remote Biometric Identification\": \"<Yes/No>\""
                "},"
                "\"Article 6(High-Risk AI Systems)\": {"
                    "\"Biometrics\": \"<Yes/No>\","
                    "\"Critical Infrastructure\": \"<Yes/No>\","
                    "\"Education and Vocational Training\": \"<Yes/No>\","
                    "\"Employment, Workers’ Management and Access to Self-Employment\": \"<Yes/No>\","
                    "\"Access to and Enjoyment of Essential Private Services and Essential Public Services and Benefits\": \"<Yes/No>\","
                    "\"Law Enforcement\": \"<Yes/No>\","
                    "\"Migration, Asylum and Border Control Management\": \"<Yes/No>\","
                    "\"Administration of Justice and Democratic Processes\": \"<Yes/No>\","
                    "\"Safety Component of a Product\": \"<Yes/No>\","
                    "\"Medical Devices\": \"<Yes/No>\","
                    "\"In Vitro Diagnostic Medical Devices\": \"<Yes/No>\","
                    "\"Other High Risk Items\": \"<Yes/No>\""
                "},"
                "\"Risk Rating Rationale\": \"<A concise justification for the risk classification based on the analysis.>\""
            "}"
        ),
        agent=risk_classification_agent,
        tools=[txt_tool],
        output_json=RiskClassificationOutput,
    )


    inputs = {
        "agent_name": agent_name,
        "description": agent_description,
        "agent_instructions": agent_instructions
    }

    risk_classification_crew = Crew(
        agents=[risk_classification_agent],
        tasks=[risk_classification_task],
        process=Process.sequential,
        verbose=True,
    )
    
    result = risk_classification_crew.kickoff(inputs=inputs)
    
    result_data = result.json_dict

    output = {
        "Risk Classification": result_data.get("risk_classification", "Other"),
        "Personally Identifiable Information": result_data.get("personally_identifiable_information", "No"),
        "Protected Health Information": result_data.get("protected_health_information", "No"),
        "Payment Card Industry": result_data.get("payment_card_industry", "No"),
        "Article 5(Prohibited AI Practices)": {
            "Subliminal and Manipulative Techniques": result_data['article_5'].get("subliminal_and_manipulative_techniques", "No"),
            "Exploitation of Vulnerabilities": result_data['article_5'].get("exploitation_of_vulnerabilities", "No"),
            "Social Scoring Systems": result_data['article_5'].get("social_scoring_systems", "No"),
            "Risk Assessment for Criminal Offences": result_data['article_5'].get("risk_assessment_for_criminal_offences", "No"),
            "Facial Recognition Database Creation": result_data['article_5'].get("facial_recognition_database_creation", "No"),
            "Emotion Inference in Workplace and Education": result_data['article_5'].get("emotion_inference_in_workplace_and_education", "No"),
            "Biometric Categorisation": result_data['article_5'].get("biometric_categorisation", "No"),
            "Real-Time Remote Biometric Identification": result_data['article_5'].get("real_time_remote_biometric_identification", "No")
        },
        "Article 6(High-Risk AI Systems)": {
            "Biometrics": result_data['article_6'].get("biometrics", "No"),
            "Critical Infrastructure": result_data['article_6'].get("critical_infrastructure", "No"),
            "Education and Vocational Training": result_data['article_6'].get("education_and_vocational_training", "No"),
            "Employment, Workers’ Management and Access to Self-Employment": result_data['article_6'].get("employment_and_self_employment", "No"),
            "Access to and Enjoyment of Essential Private Services and Essential Public Services and Benefits": result_data['article_6'].get("access_to_essential_services", "No"),
            "Law Enforcement": result_data['article_6'].get("law_enforcement", "No"),
            "Migration, Asylum and Border Control Management": result_data['article_6'].get("migration_and_border_control", "No"),
            "Administration of Justice and Democratic Processes": result_data['article_6'].get("administration_of_justice", "No"),
            "Safety Component of a Product": result_data['article_6'].get("safety_component_of_a_product", "No"),
            "Medical Devices": result_data['article_6'].get("medical_devices", "No"),
            "In Vitro Diagnostic Medical Devices": result_data['article_6'].get("in_vitro_diagnostic_medical_devices", "No"),
            "Other High Risk Items": result_data['article_6'].get("other_high_risk_items", "No")
        },
        "Risk Rating Rationale": result_data.get("risk_rating_rationale")
    }
    
    return output
