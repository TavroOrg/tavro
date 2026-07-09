# The default set of public.lookup rows every new company should start
# Seeded automatically when a company is created.
# Cleaned up when a company is deleted.
# Tuple shape: (table_name, column_name, label, value, sequence, is_default)
# =============================================================

from typing import List, Tuple

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

LookupDefault = Tuple[str, str, str, str, int, bool]

LOOKUP_DEFAULTS: List[LookupDefault] = [
    # ai_use_cases.status
    ("ai_use_cases", "status", "Identified", "Identified", 1, True),
    ("ai_use_cases", "status", "Scoped", "Scoped", 2, False),
    ("ai_use_cases", "status", "Approved", "Approved", 3, False),
    ("ai_use_cases", "status", "In Build", "In Build", 4, False),
    ("ai_use_cases", "status", "Live", "Live", 5, False),

    # ai_use_cases.priority
    ("ai_use_cases", "priority", "1 - Critical", "1 - Critical", 1, False),
    ("ai_use_cases", "priority", "2 - High", "2 - High", 2, False),
    ("ai_use_cases", "priority", "3 - Moderate", "3 - Moderate", 3, False),
    ("ai_use_cases", "priority", "4 - Low", "4 - Low", 4, False),
    ("ai_use_cases", "priority", "5 - Planning", "5 - Planning", 5, False),

    # ai_models.vendor_or_inhouse
    ("ai_models", "vendor_or_inhouse", "Vendor", "Vendor", 1, False),
    ("ai_models", "vendor_or_inhouse", "In-house", "In-house", 2, False),

    # ai_models.provider
    ("ai_models", "provider", "OpenAI", "OpenAI", 1, False),
    ("ai_models", "provider", "Anthropic", "Anthropic", 2, False),
    ("ai_models", "provider", "Google", "Google", 3, False),
    ("ai_models", "provider", "Meta", "Meta", 4, False),
    ("ai_models", "provider", "HuggingFace", "HuggingFace", 5, False),
    ("ai_models", "provider", "Mistral", "Mistral", 6, False),
    ("ai_models", "provider", "AWS Bedrock", "AWS Bedrock", 7, False),
    ("ai_models", "provider", "Internal", "Internal", 8, False),

    # ai_models.model_type
    ("ai_models", "model_type", "Large Language Model (LLM)", "Large Language Model (LLM)", 1, False),
    ("ai_models", "model_type", "Classifier", "Classifier", 2, False),
    ("ai_models", "model_type", "Regressor", "Regressor", 3, False),
    ("ai_models", "model_type", "Recommendation Engine", "Recommendation Engine", 4, False),
    ("ai_models", "model_type", "Computer Vision", "Computer Vision", 5, False),
    ("ai_models", "model_type", "Agent", "Agent", 6, False),

    # ai_models.technique_class
    ("ai_models", "technique_class", "Transformer", "Transformer", 1, False),
    ("ai_models", "technique_class", "Deep Neural Network (DNN)", "Deep Neural Network (DNN)", 2, False),
    ("ai_models", "technique_class", "Random Forest", "Random Forest", 3, False),
    ("ai_models", "technique_class", "Gradient Boosted Trees", "Gradient Boosted Trees", 4, False),
    ("ai_models", "technique_class", "SVM", "SVM", 5, False),
    ("ai_models", "technique_class", "Linear/Logistic Regression", "Linear/Logistic Regression", 6, False),

    # ai_models.learning_approach
    ("ai_models", "learning_approach", "Supervised", "Supervised", 1, False),
    ("ai_models", "learning_approach", "Unsupervised", "Unsupervised", 2, False),
    ("ai_models", "learning_approach", "Semi-supervised", "Semi-supervised", 3, False),
    ("ai_models", "learning_approach", "Self-supervised", "Self-supervised", 4, False),
    ("ai_models", "learning_approach", "Reinforcement Learning", "Reinforcement Learning", 5, False),

    # ai_models.automation_level
    ("ai_models", "automation_level", "Human-in-the-loop (HITL)", "Human-in-the-loop (HITL)", 1, False),
    ("ai_models", "automation_level", "Human-on-the-loop (HOTL)", "Human-on-the-loop (HOTL)", 2, False),
    ("ai_models", "automation_level", "Fully Autonomous", "Fully Autonomous", 3, False),

    # ai_models.update_frequency
    ("ai_models", "update_frequency", "Real-time/Continuous", "Real-time/Continuous", 1, False),
    ("ai_models", "update_frequency", "Daily", "Daily", 2, False),
    ("ai_models", "update_frequency", "Weekly", "Weekly", 3, False),
    ("ai_models", "update_frequency", "Monthly", "Monthly", 4, False),
    ("ai_models", "update_frequency", "Quarterly", "Quarterly", 5, False),
    ("ai_models", "update_frequency", "Static/Ad-hoc", "Static/Ad-hoc", 6, False),

    # ai_models.status
    ("ai_models", "status", "Ideation", "Ideation", 1, False),
    ("ai_models", "status", "Development", "Development", 2, False),
    ("ai_models", "status", "Production", "Production", 3, False),
    ("ai_models", "status", "Retired", "Retired", 4, False),

    # ai_models.emergency_tier
    ("ai_models", "emergency_tier", "Mission Critical", "Mission Critical", 1, False),
    ("ai_models", "emergency_tier", "Business Critical", "Business Critical", 2, False),
    ("ai_models", "emergency_tier", "Non-Critical", "Non-Critical", 3, False),

    # ai_models.business_criticality
    ("ai_models", "business_criticality", "High", "High", 1, False),
    ("ai_models", "business_criticality", "Medium", "Medium", 2, False),
    ("ai_models", "business_criticality", "Low", "Low", 3, False),

    # agents.agent_type
    ("agents", "agent_type", "Config-driven", "Config-driven", 1, True),
    ("agents", "agent_type", "Code-driven", "Code-driven", 2, False),
    # ("agents", "agent_type", "Autonomous Agent", "Autonomous Agent", 3, False),
    # ("agents", "agent_type", "Multi-agent Crew", "Multi-agent Crew", 4, False),
    # ("agents", "agent_type", "Rule-based", "Rule-based", 5, False),
    # ("agents", "agent_type", "Hybrid", "Hybrid", 6, False),

    # agent_data_sources.access_level
    ("agent_data_sources", "access_level", "Read-Only", "Read-Only", 1, False),
    ("agent_data_sources", "access_level", "Write-Only", "Write-Only", 2, False),
    ("agent_data_sources", "access_level", "Read-Write", "Read-Write", 3, False),
    ("agent_data_sources", "access_level", "Admin/Full Access", "Admin/Full Access", 4, False),

    # agent_data_sources.source_object_type
    ("agent_data_sources", "source_object_type", "Database Table", "Database Table", 1, False),
    ("agent_data_sources", "source_object_type", "API Endpoint", "API Endpoint", 2, False),
    ("agent_data_sources", "source_object_type", "Message Queue", "Message Queue", 3, False),
    ("agent_data_sources", "source_object_type", "File Share", "File Share", 4, False),

    # agent_data_sources.target_object_type
    ("agent_data_sources", "target_object_type", "Object Storage", "Object Storage", 1, False),
    ("agent_data_sources", "target_object_type", "Document Repository", "Document Repository", 2, False),
    ("agent_data_sources", "target_object_type", "External System", "External System", 3, False),

    # compliance_item.jurisdiction
    ("compliance_item", "jurisdiction", "US-FL", "US-FL", 2, False),
    ("compliance_item", "jurisdiction", "US-NY", "US-NY", 3, False),
    ("compliance_item", "jurisdiction", "US-CA", "US-CA", 4, False),
    ("compliance_item", "jurisdiction", "US-TX", "US-TX", 5, False),
    ("compliance_item", "jurisdiction", "EU", "EU", 6, False),
    ("compliance_item", "jurisdiction", "UK", "UK", 7, False),
    ("compliance_item", "jurisdiction", "CA", "CA", 8, False),
    ("compliance_item", "jurisdiction", "AU", "AU", 9, False),
    ("compliance_item", "jurisdiction", "GLOBAL", "GLOBAL", 10, False),

    # compliance_item.industry_tags
    ("compliance_item", "industry_tags", "banking", "banking", 1, False),
    ("compliance_item", "industry_tags", "fintech", "fintech", 2, False),
    ("compliance_item", "industry_tags", "insurance", "insurance", 3, False),
    ("compliance_item", "industry_tags", "healthcare", "healthcare", 4, False),
    ("compliance_item", "industry_tags", "manufacturing", "manufacturing", 5, False),
    ("compliance_item", "industry_tags", "retail", "retail", 6, False),
    ("compliance_item", "industry_tags", "technology", "technology", 7, False),
    ("compliance_item", "industry_tags", "all-industries", "all-industries", 8, False),

    # compliance_item.issuing_body
    ("compliance_item", "issuing_body", "FinCEN", "FinCEN", 1, False),
    ("compliance_item", "issuing_body", "OCC", "OCC", 2, False),
    ("compliance_item", "issuing_body", "SEC", "SEC", 3, False),
    ("compliance_item", "issuing_body", "CFPB", "CFPB", 4, False),
    ("compliance_item", "issuing_body", "FTC", "FTC", 5, False),
    ("compliance_item", "issuing_body", "HHS/OCR", "HHS/OCR", 6, False),
    ("compliance_item", "issuing_body", "EU Commission", "EU Commission", 7, False),
    ("compliance_item", "issuing_body", "UK ICO", "UK ICO", 8, False),

    # compliance_impact.impact_type
    ("compliance_impact", "impact_type", "financial", "financial", 1, False),
    ("compliance_impact", "impact_type", "operational", "operational", 2, False),
    ("compliance_impact", "impact_type", "reputational", "reputational", 3, False),
    ("compliance_impact", "impact_type", "regulatory", "regulatory", 4, False),
    ("compliance_impact", "impact_type", "strategic", "strategic", 5, False),

    # business_applications.emergency_tier
    ("business_applications", "emergency_tier", "Mission Critical", "Mission Critical", 1, False),
    ("business_applications", "emergency_tier", "Business Critical", "Business Critical", 2, False),
    ("business_applications", "emergency_tier", "Non-Critical", "Non-Critical", 3, False),

    # business_applications.business_criticality
    ("business_applications", "business_criticality", "High", "High", 1, False),
    ("business_applications", "business_criticality", "Medium", "Medium", 2, False),
    ("business_applications", "business_criticality", "Low", "Low", 3, False),

    # business_processes.business_criticality
    ("business_processes", "business_criticality", "Tier 1 (Systemic)", "1.0", 1, False),
    ("business_processes", "business_criticality", "Tier 2 (Core)", "0.7", 2, False),
    ("business_processes", "business_criticality", "Tier 3 (Operational)", "0.4", 3, False),
    ("business_processes", "business_criticality", "Tier 4 (Experimental)", "0.1", 4, False),

    # business_processes.financial_impact
    ("business_processes", "financial_impact", "Systemic", "1", 1, False),
    ("business_processes", "financial_impact", "Material", "0.7", 2, False),
    ("business_processes", "financial_impact", "Absorbable", "0.4", 3, False),
    ("business_processes", "financial_impact", "Immaterial", "0.1", 4, False),

    # business_processes.regulatory_impact
    ("business_processes", "regulatory_impact", "Restricted", "1", 1, False),
    ("business_processes", "regulatory_impact", "Statutory", "0.7", 2, False),
    ("business_processes", "regulatory_impact", "Governed", "0.4", 3, False),
    ("business_processes", "regulatory_impact", "Unregulated", "0.1", 4, False),

    # business_processes.reputational_impact
    ("business_processes", "reputational_impact", "Toxic", "1", 1, False),
    ("business_processes", "reputational_impact", "Adverse", "0.7", 2, False),
    ("business_processes", "reputational_impact", "Private", "0.4", 3, False),
    ("business_processes", "reputational_impact", "Contained", "0.1", 4, False),

    # business_processes.process_health_state
    ("business_processes", "process_health_state", "Stable", "Stable", 1, False),
    ("business_processes", "process_health_state", "Needs Improvement", "Needs Improvement", 2, False),
    ("business_processes", "process_health_state", "At Risk", "At Risk", 3, False),

    # business_integrations.emergency_tier
    ("business_integrations", "emergency_tier", "Mission Critical", "Mission Critical", 1, False),
    ("business_integrations", "emergency_tier", "Business Critical", "Business Critical", 2, False),
    ("business_integrations", "emergency_tier", "Non-Critical", "Non-Critical", 3, False),

    # business_integrations.business_criticality
    ("business_integrations", "business_criticality", "High", "High", 1, False),
    ("business_integrations", "business_criticality", "Medium", "Medium", 2, False),
    ("business_integrations", "business_criticality", "Low", "Low", 3, False),

    # business_integrations.protocol
    ("business_integrations", "protocol", "REST", "REST", 1, False),
    ("business_integrations", "protocol", "GraphQL", "GraphQL", 2, False),
    ("business_integrations", "protocol", "Webhook", "Webhook", 3, False),
    ("business_integrations", "protocol", "gRPC", "gRPC", 4, False),
    ("business_integrations", "protocol", "SOAP", "SOAP", 5, False),
    ("business_integrations", "protocol", "MCP", "MCP", 6, False),
    ("business_integrations", "protocol", "Event Stream", "Event Stream", 7, False),
    ("business_integrations", "protocol", "EDI", "EDI", 8, False),

    # business_integrations.authentication_method
    ("business_integrations", "authentication_method", "OAuth2", "OAuth2", 1, False),
    ("business_integrations", "authentication_method", "API Key", "API Key", 2, False),
    ("business_integrations", "authentication_method", "mTLS", "mTLS", 3, False),
    ("business_integrations", "authentication_method", "Basic", "Basic", 4, False),
    ("business_integrations", "authentication_method", "None", "None", 5, False),

    # business_integrations.data_sensitivity
    ("business_integrations", "data_sensitivity", "None", "None", 1, False),
    ("business_integrations", "data_sensitivity", "PII", "PII", 2, False),
    ("business_integrations", "data_sensitivity", "PCI", "PCI", 3, False),
    ("business_integrations", "data_sensitivity", "PHI", "PHI", 4, False),
    ("business_integrations", "data_sensitivity", "Confidential", "Confidential", 5, False),

    # business_integrations.availability_status
    ("business_integrations", "availability_status", "Active", "Active", 1, False),
    ("business_integrations", "availability_status", "Deprecated", "Deprecated", 2, False),
    ("business_integrations", "availability_status", "Planned", "Planned", 3, False),
    ("business_integrations", "availability_status", "Unknown", "Unknown", 4, False),

    # issues.issue_type   
    ("issues", "issue_type", "Hallucination", "Hallucination", 1, False),
    ("issues", "issue_type", "Tool Failure", "Tool Failure", 2, False),
    ("issues", "issue_type", "Latency Breach", "Latency Breach", 3, False),
    ("issues", "issue_type", "Drift Violation", "Drift Violation", 4, False),
    ("issues", "issue_type", "Guardrail Trigger", "Guardrail Trigger", 5, False),
    ("issues", "issue_type", "Data Quality", "Data Quality", 6, False),
    ("issues", "issue_type", "Authorization Failure", "Authorization Failure", 7, False),
    ("issues", "issue_type", "Output Policy Violation", "Output Policy Violation", 8, False),
    ("issues", "issue_type", "Risk Management", "Risk Management", 9, False),
    ("issues", "issue_type", "Fraud Detection", "Fraud Detection", 10, False),
    ("issues", "issue_type", "Customer Engagement", "Customer Engagement", 11, False),

    # issues.severity
    ("issues", "severity", "Critical", "Critical", 1, False),
    ("issues", "severity", "High", "High", 2, False),
    ("issues", "severity", "Medium", "Medium", 3, False),
    ("issues", "severity", "Low", "Low", 4, False),
    ("issues", "severity", "Informational", "Informational", 5, False),

    # issues.source
    ("issues", "source", "Evaluation Framework", "Evaluation Framework", 1, False),
    ("issues", "source", "Alert Monitor", "Alert Monitor", 2, False),
    ("issues", "source", "Drift Detector", "Drift Detector", 3, False),
    ("issues", "source", "Manual Review", "Manual Review", 4, False),

    # issues.status
    ("issues", "status", "Open", "Open", 1, False),
    ("issues", "status", "In Progress", "In Progress", 2, False),
    ("issues", "status", "Resolved", "Resolved", 3, False),
    ("issues", "status", "Dismissed", "Dismissed", 4, False),
    ("issues", "status", "Escalated", "Escalated", 5, False),
]

TENANT_WIDE_DEFAULTS: List[LookupDefault] = [
    # company.industry
    ("company", "industry", "Commercial Banking", "Commercial Banking", 1, False),
    ("company", "industry", "Insurance", "Insurance", 2, False),
    ("company", "industry", "Healthcare", "Healthcare", 3, False),
    ("company", "industry", "Manufacturing", "Manufacturing", 4, False),
    ("company", "industry", "Retail & CPG", "Retail & CPG", 5, False),
    ("company", "industry", "Technology", "Technology", 6, False),
]


async def ensure_tenant_wide_defaults(db: AsyncSession, tenant_id: str) -> None:
    
    if not TENANT_WIDE_DEFAULTS:
        return
    await db.execute(
        text("""
            INSERT INTO public.lookup
                (tenant_id, company_id, table_name, column_name, label, value, sequence, is_default, active, created_ts, updated_ts)
            SELECT :tenant_id, NULL, :table_name, :column_name, :label, :value, :sequence, :is_default, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            WHERE NOT EXISTS (
                SELECT 1 FROM public.lookup
                WHERE tenant_id = :tenant_id AND company_id IS NULL
                  AND table_name = :table_name AND column_name = :column_name AND value = :value
            )
        """),
        [
            {
                "tenant_id": tenant_id,
                "table_name": table_name,
                "column_name": column_name,
                "label": label,
                "value": value,
                "sequence": sequence,
                "is_default": is_default,
            }
            for table_name, column_name, label, value, sequence, is_default in TENANT_WIDE_DEFAULTS
        ],
    )


async def seed_lookup_defaults(db: AsyncSession, tenant_id: str, company_id: str) -> None:
    """
    Populate public.lookup with the default picklist set for a newly
    created company. Safe to call more than once — existing rows for the
    same (tenant_id, company_id, table_name, column_name, value) are left
    untouched via ON CONFLICT DO NOTHING, so it never clobbers values an
    admin has already customized for this company.
    """
    if LOOKUP_DEFAULTS:
        await db.execute(
            text("""
                INSERT INTO public.lookup
                    (tenant_id, company_id, table_name, column_name, label, value, sequence, is_default, active, created_ts, updated_ts)
                VALUES
                    (:tenant_id, :company_id, :table_name, :column_name, :label, :value, :sequence, :is_default, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                ON CONFLICT (tenant_id, company_id, table_name, column_name, value) DO NOTHING
            """),
            [
                {
                    "tenant_id": tenant_id,
                    "company_id": company_id,
                    "table_name": table_name,
                    "column_name": column_name,
                    "label": label,
                    "value": value,
                    "sequence": sequence,
                    "is_default": is_default,
                }
                for table_name, column_name, label, value, sequence, is_default in LOOKUP_DEFAULTS
            ],
        )

    await ensure_tenant_wide_defaults(db, tenant_id)


async def delete_lookup_defaults(db: AsyncSession, tenant_id: str, company_id: str) -> None:
    """Remove every public.lookup row scoped to this exact tenant+company (called on company delete)."""
    await db.execute(
        text("DELETE FROM public.lookup WHERE tenant_id = :tenant_id AND company_id = :company_id"),
        {"tenant_id": tenant_id, "company_id": company_id},
    )
