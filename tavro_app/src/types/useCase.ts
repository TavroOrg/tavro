// ── AI Use Case — Summary (catalog card) ─────────────────────────────────────

export interface UseCaseSummary {
    identifier: string;
    name: string;
    description?: string | null;
    proposed_by?: string | null;
    owner?: string | null;
    /** Business function / domain, e.g. "Finance", "Operations" */
    function?: string | null;
    problem_statement?: string | null;
    expected_benefits?: string | null;
    solution_approach?: string | null;
    created_ts?: string | null;
    updated_ts?: string | null;
    /** e.g. "High" | "Medium" | "Low" */
    priority?: string | null;
    /** e.g. "Active" | "Proposed" | "In Review" | "Deprecated" */
    status?: string | null;
    /** e.g. "Critical" | "High" | "Medium" | "Low" */
    overall_risk?: string | null;
    related_agent_count?: number | string | null;
    no_of_associated_agents?: number | string | null;
}

// ── Related entities on the detail page ───────────────────────────────────────

export interface UseCaseAgent {
    agent_id?: string | null;
    name?: string | null;
    role?: string | null;
    environment?: string | null;
}

export interface UseCaseApplication {
    identifier?: string | null;
    name?: string | null;
    description?: string | null;
    business_criticality?: string | null;
    emergency_tier?: string | null;
}

export interface UseCaseProcess {
    identifier?: string | null;
    name?: string | null;
    description?: string | null;
    business_criticality?: string | null;
}

export interface UseCaseControl {
    identifier?: string | null;
    name?: string | null;
    objective?: string | null;
    domain?: string | null;
}

export interface UseCaseRiskAssessment {
    identifier?: string | null;
    name?: string | null;
    assessor?: string | null;
    date?: string | null;
    blended_risk_score?: string | null;
    blended_risk_classification?: string | null;
    aivss_score?: string | null;
    aivss_classification?: string | null;
    state?: string | null;
}

// ── AI Use Case — Full Detail ─────────────────────────────────────────────────

export interface UseCaseDetail extends UseCaseSummary {
    agents?: UseCaseAgent[] | null;
    applications?: UseCaseApplication[] | null;
    business_processes?: UseCaseProcess[] | null;
    controls?: UseCaseControl[] | null;
    risk_assessments?: UseCaseRiskAssessment[] | null;
}
