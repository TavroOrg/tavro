"""
api/insights.py — server-computed Insights summary.

Aggregates the Insights page entirely on the backend, reading live from the
core.* (and twin.*) tables on every request, and returns ready-to-render JSON so
the frontend does minimal work. The bucketing rules below are a faithful 1:1 port
of the classifiers that previously lived in tavro_app/src/pages/InsightsPage.tsx.

NOTE on data realities (see plan): agent_governance_events / agent_ai_models /
agent_ai_use_cases are currently empty, so governance "days waiting", AI-model
provider, and agent<->usecase links have no source. Provider comes from
core.agents.source_system. KPI values, sparkline trends and HITL "age" fallback
have no telemetry source and are derived from the real risk score (kept so the
page renders identically) — flagged as derived, removable later.
"""
from __future__ import annotations

import math
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.database import get_db
from api.routers.agents import CORE, _require_tenant
from api.error_handler import raise_server_error

router = APIRouter()


# ---------------------------------------------------------------------------
# Helpers — ports of the InsightsPage.tsx classifiers
# ---------------------------------------------------------------------------

def _norm(value: Any) -> str:
    return str(value if value is not None else "").strip().lower()


def _display(value: Any, fallback: str = "Unknown") -> str:
    text_val = str(value if value is not None else "").strip()
    return text_val or fallback


def _to_float(value: Any) -> Optional[float]:
    try:
        if value is None or str(value).strip() == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _hash_string(value: str) -> int:
    # Mirrors the TS hashString: h = (h*31 + code) | 0 (32-bit), then abs.
    h = 0
    for ch in value:
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    if h >= 0x80000000:
        h -= 0x100000000
    return abs(h)


def _risk_class(row: Dict[str, Any]) -> str:
    labels = [
        _norm(row.get("blended_risk_class")),
        _norm(row.get("regulatory_risk_class")),
        _norm(row.get("aivss_class")),
    ]
    labels = [l for l in labels if l]
    if any("critical" in l or "prohibited" in l for l in labels):
        return "critical"
    if any("high" in l for l in labels):
        return "high"
    if any("medium" in l or "moderate" in l for l in labels):
        return "medium"
    score = _to_float(row.get("blended_risk_score"))
    if score is None:
        score = _to_float(row.get("aivss_score"))
    if score is None:
        score = _to_float(row.get("regulatory_risk_score"))
    if score is not None:
        if score >= 8:
            return "critical"
        if score >= 6:
            return "high"
        if score >= 3:
            return "medium"
    return "low"


def _risk_score(row: Dict[str, Any]) -> float:
    score = _to_float(row.get("blended_risk_score"))
    if score is None:
        score = _to_float(row.get("aivss_score"))
    if score is not None:
        return score
    cls = _risk_class(row)
    return {"critical": 9.0, "high": 7.0, "medium": 4.0}.get(cls, 1.0)


def _blended_label(row: Dict[str, Any]) -> str:
    raw = _display(row.get("blended_risk_class"), "Unassessed")
    risk = _norm(raw)
    if "critical" in risk or "prohibited" in risk:
        return "Critical"
    if "high" in risk:
        return "High"
    if "medium" in risk or "moderate" in risk:
        return "Medium"
    if "low" in risk:
        return "Low"
    return raw


def _has_blended_risk(row: Dict[str, Any]) -> bool:
    return bool(str(row.get("blended_risk_class") or "").strip())


def _has_resolved_risk(row: Dict[str, Any]) -> bool:
    status = _norm(row.get("governance_status")) or _norm(row.get("risk_state"))
    return bool(
        row.get("blended_risk_class")
        or row.get("blended_risk_score") is not None
        or row.get("aivss_class")
        or row.get("aivss_score") is not None
        or "completed" in status
        or "approved" in status
    )


def _risk_not_triggered(row: Dict[str, Any]) -> bool:
    if _has_resolved_risk(row):
        return False
    status = _norm(row.get("governance_status")) or _norm(row.get("risk_state"))
    return not ("running" in status or "progress" in status)


def _needs_human(row: Dict[str, Any]) -> bool:
    status = _norm(row.get("governance_status")) or _norm(row.get("risk_state"))
    return any(k in status for k in ("human", "hitl", "review", "pending", "approval", "escalat"))


def _pretty_env(value: Any) -> str:
    env = _norm(value)
    if not env or env == "unknown":
        return "Unknown"
    if "prod" in env or "live" in env:
        return "Production"
    if "stag" in env:
        return "Staging"
    if "dev" in env:
        return "Development"
    if "test" in env:
        return "Testing"
    if "uat" in env:
        return "UAT"
    if "qa" in env:
        return "QA"
    return str(value)


def _has_known_env(value: Any) -> bool:
    env = _norm(value)
    return bool(env and env != "unknown")


def _is_prod_env(value: Any) -> bool:
    env = _norm(value)
    return "prod" in env or "live" in env


def _is_dev_env(value: Any) -> bool:
    env = _norm(value)
    return any(k in env for k in ("dev", "stag", "test", "qa", "uat"))


def _autonomy_bucket(value: Any) -> Optional[str]:
    text_val = _norm(value)
    if not text_val:
        return None
    if "2.1" in text_val:
        return "supervised"
    if "2.2" in text_val:
        return "semi"
    if "2.3" in text_val:
        return "full"
    if any(k in text_val for k in ("none", "copilot", "human-in-the-loop")):
        return "supervised"
    if any(k in text_val for k in ("semi", "partial", "approval", "well-defined", "decision tree")):
        return "semi"
    if any(k in text_val for k in ("full", "fully", "open-ended", "free communication")):
        return "full"
    if "supervised" in text_val or "human" in text_val:
        return "supervised"
    match = re.search(r"-?\d+(?:\.\d+)?", text_val)
    numeric = _to_float(match.group(0)) if match else None
    if numeric is not None:
        if numeric <= 0:
            return "supervised"
        if numeric < 1:
            return "semi"
        return "full"
    return None


def _pretty_provider(value: Any) -> str:
    raw = str(value if value is not None else "").strip()
    p = raw.lower()
    if not p or p in ("unknown", "unknown provider"):
        return "Unknown Provider"
    if any(k in p for k in ("servicenow", "service now", "service-now", "now platform")):
        return "ServiceNow"
    if any(k in p for k in ("google", "gcp", "vertex", "gemini")):
        return "Google"
    if "azure" in p or "microsoft" in p:
        return "Azure"
    return raw


def _normalize_lifecycle(value: Any) -> Optional[str]:
    stage = re.sub(r"[_-]+", " ", _norm(value))
    if not stage:
        return None
    if any(k in stage for k in ("monitor", "operate", "active governance", "live")):
        return "Monitor"
    if any(k in stage for k in ("deploy", "release", "launch")):
        return "Deploy"
    if any(k in stage for k in ("develop", "development", "build", "test")):
        return "Develop"
    if any(k in stage for k in ("design", "prototype", "variant")):
        return "Design"
    if any(k in stage for k in ("plan", "idea", "identify", "blueprint")):
        return "Plan"
    return None


def _has_usecase_context(row: Dict[str, Any]) -> bool:
    return (row.get("business_process_count") or 0) > 0 or (row.get("business_application_count") or 0) > 0


def _classify_agent_stage(row: Dict[str, Any]) -> str:
    status = _norm(row.get("governance_status")) or _norm(row.get("risk_state"))
    risk_state = _norm(row.get("risk_state"))
    # Stage follows the risk-assessment (Temporal) workflow:
    #   running   -> Develop
    #   completed -> Deploy
    # The workflow result (resolved risk / state_name) is authoritative, because
    # governance_status can stay "Risk Assessment is running" even after the
    # workflow finishes. So a "running" status only means Develop when the
    # assessment has NOT actually completed.
    completed = _has_resolved_risk(row) or "complet" in risk_state
    running = (not completed) and any(
        k in status for k in ("running", "progress", "in_progress", "build", "develop")
    )
    if "monitor" in status or "active" in status:
        return "Monitor"
    if running:
        return "Develop"
    if completed:
        return "Deploy"
    if _has_known_env(row.get("environment")) or "deploy" in status or "release" in status:
        return "Deploy"
    if any(k in status for k in ("review", "pending", "approval", "design")):
        return "Design"
    if _has_usecase_context(row):
        return "Design"
    return "Plan"


def _classify_usecase_stage(status: Any) -> str:
    s = _norm(status)
    if any(k in s for k in ("live", "active", "deployed")):
        return "Live"
    if any(k in s for k in ("build", "progress", "develop")):
        return "In Build"
    if "approve" in s or "fund" in s:
        return "Approved"
    if any(k in s for k in ("scope", "review", "assess")):
        return "Scoped"
    return "Identified"


def _trend_dir(score: float) -> str:
    if score >= 7:
        return "up"
    if score <= 3:
        return "down"
    return "flat"


def _synth_age(seed: int) -> str:
    hours = (seed % 47) + 1
    return f"{hours}h ago" if hours < 24 else f"{hours // 24}d ago"


# Representative stage-gate checklist items per lifecycle stage. core.agent_governance_events
# is empty, so the specific gate an agent is "awaiting" has no telemetry source; we derive a
# stable, stage-appropriate label (numbered by stage) so the card reads like a real gate queue.
# Deterministic per agent via the id hash. Flagged as derived — replace once governance events
# carry the actual gate.
_STAGE_GATES = {
    "Plan":    ["1.1 Use Case Definition", "1.3 Stakeholder Alignment", "1.5 Feasibility Review"],
    "Design":  ["2.2 Architecture Review", "2.4 Risk Threshold Sign-off", "2.6 Scenario Stress Testing"],
    "Develop": ["3.2 Model Build Sign-off", "3.5 Data Pipeline Integration", "3.7 Test Coverage Gate"],
    "Deploy":  ["4.1 Pre-Prod Validation", "4.3 Release Approval", "4.5 Versioning & Rollback"],
    "Monitor": ["5.2 Drift Monitoring", "5.4 Incident Response Plan", "5.6 Periodic Re-assessment"],
}


def _stage_gate(stage: str, seed: int) -> str:
    options = _STAGE_GATES.get(stage)
    if not options:
        return "Governance review"
    return options[seed % len(options)]


def _days_since(ts: Any) -> int:
    if not ts:
        return 0
    try:
        dt = ts if isinstance(ts, datetime) else datetime.fromisoformat(str(ts))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return max(0, (datetime.now(timezone.utc) - dt).days)
    except (TypeError, ValueError):
        return 0


def _to_dt(ts: Any) -> Optional[datetime]:
    if not ts:
        return None
    try:
        dt = ts if isinstance(ts, datetime) else datetime.fromisoformat(str(ts))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except (TypeError, ValueError):
        return None


def _relative_time(ts: Any) -> str:
    dt = _to_dt(ts)
    if not dt:
        return "Recently"
    seconds = max(0, int((datetime.now(timezone.utc) - dt).total_seconds()))
    if seconds < 60:
        return "Just now"
    minutes = seconds // 60
    if minutes < 60:
        return f"{minutes}m ago"
    hours = minutes // 60
    if hours < 24:
        return f"{hours}h ago"
    days = hours // 24
    if days == 1:
        return "Yesterday"
    if days < 7:
        return f"{days} days ago"
    weeks = days // 7
    if weeks < 5:
        return f"{weeks}w ago"
    months = days // 30
    if months < 12:
        return f"{months}mo ago"
    years = days // 365
    return f"{years}y ago"


# KPI catalog — port of KPI_DEFINITIONS. Each returns (value, target, status).
def _kpi_task_completion(perf):  # noqa: ANN001
    v = 82 + perf * 16
    return f"{v:.0f}%", "95%", ("pass" if v >= 95 else "warn" if v >= 90 else "fail")


def _kpi_latency(perf):
    v = 0.8 + (1 - perf) * 3.2
    return f"{v:.1f}s", "2.0s", ("pass" if v <= 2.0 else "warn" if v <= 2.8 else "fail")


def _kpi_error_rate(perf):
    v = 0.2 + (1 - perf) * 3.0
    return f"{v:.1f}%", "≤1%", ("pass" if v <= 1 else "warn" if v <= 2 else "fail")


def _kpi_cost(perf):
    v = 0.05 + (1 - perf) * 0.20
    return f"${v:.2f}", "$0.10", ("pass" if v <= 0.10 else "warn" if v <= 0.15 else "fail")


def _kpi_false_positive(perf):
    v = 1 + (1 - perf) * 9
    return f"{v:.1f}%", "≤5%", ("pass" if v <= 5 else "warn" if v <= 7 else "fail")


def _kpi_accuracy(perf):
    v = 86 + perf * 13
    return f"{v:.1f}%", "≥97%", ("pass" if v >= 97 else "warn" if v >= 93 else "fail")


def _kpi_uptime(perf):
    v = 98 + perf * 1.9
    return f"{v:.2f}%", "≥99.5%", ("pass" if v >= 99.5 else "warn" if v >= 99 else "fail")


def _kpi_escalation(perf):
    v = 2 + (1 - perf) * 18
    return f"{v:.0f}%", "≤10%", ("pass" if v <= 10 else "warn" if v <= 15 else "fail")


_KPI_DEFINITIONS = [
    ("Task Completion Rate", _kpi_task_completion),
    ("Response Latency", _kpi_latency),
    ("Error Rate", _kpi_error_rate),
    ("Cost per Operation", _kpi_cost),
    ("False Positive Rate", _kpi_false_positive),
    ("Accuracy Score", _kpi_accuracy),
    ("Uptime", _kpi_uptime),
    ("Escalation Rate", _kpi_escalation),
]


def _make_kpi_trend(status: str, seed: int) -> List[float]:
    direction = 1 if status == "fail" else -1 if status == "pass" else 0
    out = []
    for i in range(7):
        drift = direction * (i - 3) * 0.6
        wiggle = 0.35 if ((seed >> (i % 16)) & 1) else -0.35
        out.append(round(5 + drift + wiggle, 3))
    return out


def _pct(count: int, total: int) -> int:
    return round((count / total) * 100) if total else 0


# Maps blueprint dim_type.category -> profile section label (port of
# PROFILE_SECTION_DEFINITIONS).
_PROFILE_SECTIONS = [
    ("Company Overview", ["profile"]),
    ("Industry & Market", ["strategy"]),
    ("Regulatory Context", ["risk"]),
    ("Financial Profile", ["finance"]),
    ("Competitive Landscape", ["application", "process", "integration"]),
    ("ESG & Sustainability", ["organisation"]),
]

def _profile_dimension_hint(categories: List[str], category_labels: Dict[str, str]) -> str:
    labels = [_display(category_labels.get(cat), cat.title()) for cat in categories]
    if not labels:
        return "a Blueprint dimension"
    if len(labels) == 1:
        return f"a {labels[0]} dimension"
    return f"{', '.join(labels[:-1])}, or {labels[-1]} dimensions"


# ---------------------------------------------------------------------------
# SQL
# ---------------------------------------------------------------------------

_AGENTS_SQL = f"""
SELECT
    a.agent_id,
    a.agent_internal_id,
    a.agent_name,
    a.agent_description,
    a.source_system,
    a.created_ts,
    a.updated_ts,
    i.environment,
    i.governance_status,
    cfg.autonomy_level,
    r.blended_risk_score,
    r.blended_risk_class,
    r.regulatory_risk_score,
    r.regulatory_risk_class,
    r.aivss_score,
    r.aivss_class,
    r.state_name        AS risk_state,
    r.assessment_ts,
    app.application_name,
    COALESCE(ds.cnt, 0) AS data_source_count,
    COALESCE(bp.cnt, 0) AS business_process_count,
    COALESCE(ba.cnt, 0) AS business_application_count
FROM {CORE}.agents a
LEFT JOIN LATERAL (
    SELECT environment, governance_status
    FROM {CORE}.agent_identifications
    WHERE agent_id = a.agent_id AND COALESCE(is_current, TRUE) = TRUE
    ORDER BY is_current DESC NULLS LAST, updated_ts DESC NULLS LAST
    LIMIT 1
) i ON TRUE
LEFT JOIN LATERAL (
    SELECT autonomy_level
    FROM {CORE}.agent_configurations
    WHERE agent_internal_id = a.agent_internal_id AND COALESCE(is_current, TRUE) = TRUE
    ORDER BY is_current DESC NULLS LAST, updated_ts DESC NULLS LAST
    LIMIT 1
) cfg ON TRUE
LEFT JOIN LATERAL (
    SELECT blended_risk_score, blended_risk_class, regulatory_risk_score,
           regulatory_risk_class, aivss_score, aivss_class, state_name, assessment_ts
    FROM {CORE}.agent_risk_assessments
    WHERE agent_internal_id = a.agent_internal_id AND COALESCE(is_current, TRUE) = TRUE
    ORDER BY assessment_ts DESC NULLS LAST, updated_ts DESC NULLS LAST
    LIMIT 1
) r ON TRUE
LEFT JOIN LATERAL (
    SELECT application_name
    FROM {CORE}.agent_business_applications
    WHERE agent_internal_id = a.agent_internal_id
    ORDER BY created_ts DESC NULLS LAST
    LIMIT 1
) app ON TRUE
LEFT JOIN (
    SELECT agent_internal_id, COUNT(*)::int AS cnt FROM {CORE}.agent_data_sources GROUP BY agent_internal_id
) ds ON ds.agent_internal_id = a.agent_internal_id
LEFT JOIN (
    SELECT agent_internal_id, COUNT(*)::int AS cnt FROM {CORE}.agent_business_processes GROUP BY agent_internal_id
) bp ON bp.agent_internal_id = a.agent_internal_id
LEFT JOIN (
    SELECT agent_internal_id, COUNT(*)::int AS cnt FROM {CORE}.agent_business_applications GROUP BY agent_internal_id
) ba ON ba.agent_internal_id = a.agent_internal_id
WHERE COALESCE(a.is_current, TRUE) = TRUE
  AND (a.tenant_id = :tid OR a.tenant_id IS NULL)
"""

_USECASES_SQL = f"""
SELECT ai_use_case_id, name, status, created_ts, updated_ts
FROM {CORE}.ai_use_cases u
WHERE (tenant_id = :tid OR tenant_id IS NULL)
"""

_SPARK_COUNTS_SQL = f"""
SELECT
    COUNT(*)::int AS total,
    COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS this_week
FROM {CORE}.spark_ideas
WHERE company_id = :cid
"""

_RECENT_SPARK_SQL = f"""
SELECT idea_id, title, created_at, updated_at
FROM {CORE}.spark_ideas
WHERE company_id = :cid
ORDER BY COALESCE(updated_at, created_at) DESC NULLS LAST
LIMIT :limit
"""

_COMPANY_PICK_SQL = """
SELECT id FROM twin.company WHERE tenant_id = :tid ORDER BY updated_at DESC NULLS LAST LIMIT 1
"""

_PROFILE_NODES_SQL = """
SELECT dt.category::text AS category, dn.updated_at
FROM twin.dim_node dn
JOIN twin.dim_type dt ON dt.id = dn.dim_type_id
WHERE dn.company_id = :cid AND dn.valid_to IS NULL
"""

_DIM_TYPE_LABELS_SQL = """
SELECT category::text AS category, name
FROM twin.dim_type
ORDER BY system_defined DESC NULLS LAST, name
"""


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.get("/summary", summary="Get Insights Summary")
async def get_insights_summary(
    request: Request,
    company_id: Optional[str] = None,
    x_tenant_id: Optional[str] = Header(default=None),  # surfaces an input box in /docs; read via _require_tenant
    db: AsyncSession = Depends(get_db),
):
    tenant_id = _require_tenant(request)
    cid = company_id.strip() if company_id and company_id.strip() else None
    agent_sql = _AGENTS_SQL
    usecase_sql = _USECASES_SQL
    params: Dict[str, Any] = {"tid": tenant_id}

    if cid:
        params["cid"] = cid
        try:
            col_check = await db.execute(
                text("""
                    SELECT 1 FROM information_schema.columns
                    WHERE table_schema = :schema AND table_name = :tbl AND column_name = 'company_id'
                    LIMIT 1
                """),
                {"schema": CORE, "tbl": "agents"},
            )
            if col_check.first():
                agent_sql += "\n  AND (CAST(a.company_id AS text) = :cid OR a.company_id IS NULL OR CAST(a.company_id AS text) = '')"
        except Exception:
            pass
        try:
            col_check = await db.execute(
                text("""
                    SELECT 1 FROM information_schema.columns
                    WHERE table_schema = :schema AND table_name = :tbl AND column_name = 'company_id'
                    LIMIT 1
                """),
                {"schema": CORE, "tbl": "ai_use_cases"},
            )
            if col_check.first():
                usecase_sql += "\n  AND (CAST(u.company_id AS text) = :cid OR u.company_id IS NULL OR CAST(u.company_id AS text) = '')"
        except Exception:
            pass

    try:
        agent_rows = [dict(r) for r in (await db.execute(text(agent_sql), params)).mappings().all()]
        uc_rows = [dict(r) for r in (await db.execute(text(usecase_sql), params)).mappings().all()]
    except Exception as e:  # noqa: BLE001
        raise_server_error(e)

    total_agents = len(agent_rows)

    # --- precompute per-agent derived fields ---
    for a in agent_rows:
        a["_risk"] = _risk_class(a)
        a["_score"] = _risk_score(a)
        a["_stage"] = _classify_agent_stage(a)
        a["_autonomy"] = _autonomy_bucket(a.get("autonomy_level"))
        a["_provider"] = _pretty_provider(a.get("source_system"))
        a["_env"] = _pretty_env(a.get("environment"))

    # --- lifecycle distributions ---
    agent_stage_order = ["Plan", "Design", "Develop", "Deploy", "Monitor"]
    agent_counts = {s: 0 for s in agent_stage_order}
    for a in agent_rows:
        agent_counts[a["_stage"]] += 1
    agent_lifecycle = [{"stage": s, "count": agent_counts[s]} for s in agent_stage_order]

    uc_stage_order = ["Identified", "Scoped", "Approved", "In Build", "Live"]
    uc_counts = {s: 0 for s in uc_stage_order}
    for uc in uc_rows:
        uc_counts[_classify_usecase_stage(uc.get("status"))] += 1
    usecase_lifecycle = [{"stage": s, "count": uc_counts[s]} for s in uc_stage_order]

    # --- provider distribution (only Google/Azure/ServiceNow) ---
    provider_labels = ["Google", "Azure", "ServiceNow"]
    provider_counts = {l: 0 for l in provider_labels}
    for a in agent_rows:
        if a["_provider"] in provider_counts:
            provider_counts[a["_provider"]] += 1
    known_provider_total = sum(provider_counts.values())
    provider_distribution = [
        {"label": l, "count": provider_counts[l], "pct": _pct(provider_counts[l], known_provider_total)}
        for l in provider_labels
    ]

    # --- blended risk distribution (only agents that carry a blended class) ---
    blended_rows = [a for a in agent_rows if _has_blended_risk(a)]
    risk_labels = ["Critical", "High", "Medium", "Low"]
    blended_distribution = []
    for l in risk_labels:
        c = sum(1 for a in blended_rows if _blended_label(a) == l)
        blended_distribution.append({"label": l, "count": c, "pct": _pct(c, len(blended_rows))})

    # --- autonomy distribution ---
    autonomy_keys = [("supervised", "Supervised"), ("semi", "Semi-Autonomous"), ("full", "Fully Autonomous")]
    autonomy_distribution = []
    for key, label in autonomy_keys:
        c = sum(1 for a in agent_rows if a["_autonomy"] == key)
        autonomy_distribution.append({"label": label, "count": c, "pct": _pct(c, total_agents)})

    # --- risk agent lists ---
    crit_high = [a for a in agent_rows if a["_risk"] in ("critical", "high")]
    prod_source = sorted(
        [a for a in crit_high if _is_prod_env(a.get("environment")) or not _has_known_env(a.get("environment"))],
        key=lambda a: a["_score"], reverse=True,
    )
    prod_ids = {a["agent_id"] for a in prod_source}
    dev_source = [a for a in crit_high if a["agent_id"] not in prod_ids and _is_dev_env(a.get("environment"))]

    def _to_risk_agent(a: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "id": a.get("agent_id"),
            "name": a.get("agent_name"),
            "desc": a.get("agent_description") or "No description available",
            "risk": a["_risk"],
            "env": a["_env"],
            "app": _display(a.get("application_name"), "") or None,
            "riskScore": a["_score"],
            "trendDir": _trend_dir(a["_score"]),
        }

    production_risk_agents = [_to_risk_agent(a) for a in prod_source]
    development_risk_agents = [_to_risk_agent(a) for a in dev_source]

    # --- HITL escalations ---
    attention = [a for a in agent_rows if _needs_human(a)]
    if attention:
        hitl = [
            {
                "id": a.get("agent_id"),
                "agent": a.get("agent_name"),
                "trigger": _display(a.get("governance_status") or a.get("risk_state"), "Awaiting human review"),
                "age": _synth_age(_hash_string(str(a.get("agent_id") or ""))),
                "severity": "high" if a["_risk"] in ("critical", "high") else "medium",
                "status": _display(a.get("governance_status") or a.get("risk_state"), "Pending Review"),
            }
            for a in attention
        ]
    else:
        hitl = [
            {
                "id": a.get("agent_id"),
                "agent": a.get("agent_name"),
                "trigger": "Risk assessment not yet triggered",
                "age": _synth_age(_hash_string(str(a.get("agent_id") or ""))),
                "severity": "medium",
                "status": "Pending Review",
            }
            for a in agent_rows if _risk_not_triggered(a)
        ]

    spark_total, spark_this_week = await _spark_counts(db, company_id, tenant_id)
    use_cases_in_progress = sum(
        1
        for uc in uc_rows
        if any(k in _norm(uc.get("status")) for k in ("progress", "build", "develop"))
    )
    live_agents = sum(1 for a in agent_rows if _is_prod_env(a.get("environment")))
    need_review = sum(1 for a in agent_rows if _needs_human(a))

    # --- stage gate blockers (every agent) ---
    stage_gate_blockers = [
        {
            "id": a.get("agent_id"),
            "agent": a.get("agent_name"),
            "gate": _stage_gate(a["_stage"], _hash_string(str(a.get("agent_id") or ""))),
            "stage": a["_stage"],
            "env": a["_env"],
            "days": _days_since(a.get("assessment_ts")),
        }
        for a in agent_rows
    ]

    # --- success metrics (derived from risk score) ---
    success_metrics = []
    resolved = [a for a in agent_rows if _has_resolved_risk(a)]
    for idx, a in enumerate(resolved):
        perf = max(0.0, min(1.0, 1 - a["_score"] / 10))
        kpi_name, compute = _KPI_DEFINITIONS[idx % len(_KPI_DEFINITIONS)]
        value, target, status = compute(perf)
        seed = _hash_string(str(a.get("agent_id") or ""))
        success_metrics.append({
            "id": a.get("agent_id"),
            "agent": a.get("agent_name"),
            "kpi": kpi_name,
            "value": value,
            "target": target,
            "status": status,
            "trend": _make_kpi_trend(status, seed),
        })

    # --- company profile (twin) ---
    company_profile = await _build_company_profile(db, company_id, tenant_id)
    recent_activity = await _home_recent_activity(db, company_id, agent_rows, uc_rows, tenant_id)
    attention_items = _home_attention_items(agent_rows, uc_rows, company_profile)

    return {
        "totals": {
            "sparkIdeas": spark_total,
            "sparkIdeasThisWeek": spark_this_week,
            "totalAgents": total_agents,
            "liveAgents": live_agents,
            "totalUseCases": len(uc_rows),
            "useCasesInProgress": use_cases_in_progress,
            "criticalCount": sum(1 for a in agent_rows if a["_risk"] == "critical"),
            "highRiskCount": sum(1 for a in agent_rows if a["_risk"] == "high"),
            "hitlOpen": len(hitl),
            "openIssues": len(hitl),
            "needReview": need_review,
        },
        "agentLifecycle": agent_lifecycle,
        "useCaseLifecycle": usecase_lifecycle,
        "providerDistribution": provider_distribution,
        "blendedRiskDistribution": blended_distribution,
        "autonomyDistribution": autonomy_distribution,
        "productionRiskAgents": production_risk_agents,
        "developmentRiskAgents": development_risk_agents,
        "hitlEscalations": hitl,
        "stageGateBlockers": stage_gate_blockers,
        "successMetrics": success_metrics,
        "companyProfile": company_profile,
        "homeRecentActivity": recent_activity,
        "homeAttentionItems": attention_items,
    }


async def _spark_counts(db: AsyncSession, company_id: Optional[str], tenant_id: Optional[str] = None) -> tuple[int, int]:
    try:
        cid = company_id
        if not cid:
            row = (await db.execute(text(_COMPANY_PICK_SQL), {"tid": tenant_id})).first()
            cid = str(row[0]) if row else None
        if not cid:
            return 0, 0
        row = (await db.execute(text(_SPARK_COUNTS_SQL), {"cid": cid})).mappings().first()
        if not row:
            return 0, 0
        return int(row["total"] or 0), int(row["this_week"] or 0)
    except Exception:  # noqa: BLE001
        return 0, 0


async def _resolve_company_id(db: AsyncSession, company_id: Optional[str], tenant_id: Optional[str] = None) -> Optional[str]:
    if company_id:
        return company_id
    row = (await db.execute(text(_COMPANY_PICK_SQL), {"tid": tenant_id})).first()
    return str(row[0]) if row else None


async def _home_recent_activity(
    db: AsyncSession,
    company_id: Optional[str],
    agent_rows: List[Dict[str, Any]],
    uc_rows: List[Dict[str, Any]],
    tenant_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    events: List[Dict[str, Any]] = []

    try:
        cid = await _resolve_company_id(db, company_id, tenant_id)
        if cid:
            spark_rows = (await db.execute(text(_RECENT_SPARK_SQL), {"cid": cid, "limit": 4})).mappings().all()
            for row in spark_rows:
                ts = row.get("updated_at") or row.get("created_at")
                title = _display(row.get("title"), "Spark idea")
                events.append({
                    "id": f"spark:{row.get('idea_id')}",
                    "text": f"Spark idea added: {title}",
                    "time": _relative_time(ts),
                    "dot": "emerald",
                    "_ts": _to_dt(ts),
                })
    except Exception:  # noqa: BLE001
        pass

    for uc in uc_rows:
        ts = uc.get("updated_ts") or uc.get("created_ts")
        status = _display(uc.get("status"), "")
        name = _display(uc.get("name"), "AI use case")
        if status:
            text_value = f"{name} moved to {status} stage"
        else:
            text_value = f"AI use case updated: {name}"
        events.append({
            "id": f"usecase:{uc.get('ai_use_case_id')}",
            "text": text_value,
            "time": _relative_time(ts),
            "dot": "violet",
            "_ts": _to_dt(ts),
        })

    for agent in agent_rows:
        risk_ts = agent.get("assessment_ts")
        if risk_ts and _has_resolved_risk(agent):
            risk = _display(agent.get("blended_risk_class") or agent.get("aivss_class"), "risk")
            events.append({
                "id": f"agent-risk:{agent.get('agent_id')}",
                "text": f"{_display(agent.get('agent_name'), 'Agent')} risk classified as {risk}",
                "time": _relative_time(risk_ts),
                "dot": "amber" if agent.get("_risk") in ("critical", "high", "medium") else "emerald",
                "_ts": _to_dt(risk_ts),
            })

        ts = agent.get("updated_ts") or agent.get("created_ts")
        if ts:
            events.append({
                "id": f"agent:{agent.get('agent_id')}",
                "text": f"Agent updated: {_display(agent.get('agent_name'), 'Untitled agent')}",
                "time": _relative_time(ts),
                "dot": "emerald" if _is_prod_env(agent.get("environment")) else "violet",
                "_ts": _to_dt(ts),
            })

    events.sort(key=lambda e: e.get("_ts") or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
    return [{k: v for k, v in event.items() if k != "_ts"} for event in events[:4]]


def _home_attention_items(
    agent_rows: List[Dict[str, Any]],
    uc_rows: List[Dict[str, Any]],
    company_profile: Dict[str, Any],
) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []

    review_agents = sorted(
        [a for a in agent_rows if _needs_human(a)],
        key=lambda a: _to_dt(a.get("updated_ts")) or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )
    for agent in review_agents:
        status = _display(agent.get("governance_status") or agent.get("risk_state"), "review required")
        items.append({
            "id": f"agent-review:{agent.get('agent_id')}",
            "badge": "Approval",
            "text": f"{_display(agent.get('agent_name'), 'Agent')} - {status}",
            "action": "Review",
            "route": f"/agent/{agent.get('agent_id')}",
        })

    risk_agents = sorted(
        [a for a in agent_rows if a.get("_risk") in ("critical", "high")],
        key=lambda a: a.get("_score") or 0,
        reverse=True,
    )
    for agent in risk_agents:
        items.append({
            "id": f"agent-risk:{agent.get('agent_id')}",
            "badge": "Risk",
            "text": f"{_display(agent.get('agent_name'), 'Agent')} - {_display(agent.get('_risk'), 'risk')} risk requires review",
            "action": "Review",
            "route": f"/agent/{agent.get('agent_id')}",
        })

    for agent in [a for a in agent_rows if _risk_not_triggered(a)]:
        items.append({
            "id": f"agent-unassessed:{agent.get('agent_id')}",
            "badge": "Issue",
            "text": f"{_display(agent.get('agent_name'), 'Agent')} - risk assessment not yet triggered",
            "action": "Review",
            "route": f"/agent/{agent.get('agent_id')}",
        })

    for uc in uc_rows:
        status = _norm(uc.get("status"))
        if any(k in status for k in ("pending", "review", "approval", "approve")):
            items.append({
                "id": f"usecase-review:{uc.get('ai_use_case_id')}",
                "badge": "Approval",
                "text": f"{_display(uc.get('name'), 'AI use case')} - {uc.get('status') or 'review pending'}",
                "action": "Review",
                "route": f"/use-case/{uc.get('ai_use_case_id')}",
            })

    for gap in company_profile.get("gaps", [])[:2]:
        area = _display(gap.get("area"), "Profile")
        dimension_hint = _display(gap.get("dimensionHint"), "Blueprint dimension")
        items.append({
            "id": f"blueprint-gap:{gap.get('id')}",
            "badge": "Incomplete",
            "text": f"Blueprint - add {dimension_hint} for {area}",
            "action": "Complete",
            "route": "/blueprint",
        })

    seen: set[str] = set()
    unique: List[Dict[str, Any]] = []
    for item in items:
        item_id = str(item.get("id") or item.get("text"))
        if item_id in seen:
            continue
        seen.add(item_id)
        unique.append(item)
        if len(unique) >= 4:
            break
    return unique


async def _build_company_profile(db: AsyncSession, company_id: Optional[str], tenant_id: Optional[str] = None) -> Dict[str, Any]:
    empty = {"hasActiveCompany": False, "overallPct": 0, "sections": [], "gaps": [], "refreshes": []}
    try:
        cid = company_id
        if not cid:
            row = (await db.execute(text(_COMPANY_PICK_SQL), {"tid": tenant_id})).first()
            cid = str(row[0]) if row else None
        if not cid:
            return empty
        nodes = (await db.execute(text(_PROFILE_NODES_SQL), {"cid": cid})).mappings().all()
        dim_type_rows = (await db.execute(text(_DIM_TYPE_LABELS_SQL))).mappings().all()
    except Exception:  # noqa: BLE001
        return empty

    category_labels: Dict[str, str] = {}
    for row in dim_type_rows:
        category = _display(row.get("category"), "")
        name = _display(row.get("name"), "")
        if category and name and category not in category_labels:
            category_labels[category] = name

    by_category: Dict[str, List[Any]] = {}
    for n in nodes:
        by_category.setdefault(n["category"], []).append(n["updated_at"])

    section_counts = [
        sum(len(by_category.get(cat, [])) for cat in cats) for _, cats in _PROFILE_SECTIONS
    ]
    max_count = max([1, *section_counts])

    sections = []
    for (label, _cats), count in zip(_PROFILE_SECTIONS, section_counts):
        pct = 0 if count == 0 else min(100, round((count / max_count) * 100))
        status = "pass" if pct >= 70 else "warn" if pct >= 35 else "fail"
        sections.append({"label": label, "pct": pct, "status": status})

    gaps = [
        {
            "id": f"{s['label']}-{i}",
            "gap": f"{s['label']} dimensions missing",
            "area": s["label"],
            "dimensionHint": _profile_dimension_hint(_PROFILE_SECTIONS[i][1], category_labels),
            "severity": "high" if i < 2 else "medium",
        }
        for i, s in enumerate(sections) if s["pct"] == 0
    ]

    refreshes = []
    for label, cats in _PROFILE_SECTIONS:
        times = [t for cat in cats for t in by_category.get(cat, []) if t]
        if not times:
            continue
        latest = max(times)
        days = _days_since(latest)
        refreshes.append({
            "id": label,
            "section": label,
            "lastRefresh": "Today" if days <= 0 else f"{days}d ago",
            "stale": days > 30,
        })

    overall = round(sum(s["pct"] for s in sections) / max(1, len(sections)))
    return {"hasActiveCompany": True, "overallPct": overall, "sections": sections, "gaps": gaps, "refreshes": refreshes}
