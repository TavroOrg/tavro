// ── src/types/audit.ts ───────────────────────────────────────────────────────

export type AuditScopeType =
  | 'single'          // one use case × one regulation
  | 'use_case_all'    // one use case × all regulations/policies
  | 'catalog_single'  // all use cases × one regulation
  | 'full';           // all use cases × all regulations

export type AuditStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type FindingStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
export type RiskLevel = 'critical' | 'high' | 'medium' | 'low' | 'none';

export interface AuditGap {
  requirement:   string;
  current_state: string;
  gap:           string;
  severity:      RiskLevel;
}

export interface AuditRecommendation {
  action:   string;
  priority: 'immediate' | 'short_term' | 'long_term';
  owner:    string;
}

export interface AuditFinding {
  id:                    string;
  audit_run_id:          string;
  company_id:            string;
  use_case_id:           string;
  use_case_name:         string;
  compliance_item_id:    string | null;
  compliance_item_name:  string;
  compliance_item_type:  string;
  status:                FindingStatus;
  risk_level:            RiskLevel | null;
  risk_score:            number | null;
  confidence:            number | null;
  applicable_rules:      string[] | null;
  gaps:                  AuditGap[] | null;
  compliant_areas:       string[] | null;
  recommendations:       AuditRecommendation[] | null;
  summary:               string | null;
  agent_session_id:      string | null;
  tokens_used:           number | null;
  assessment_duration_ms: number | null;
  error_message:         string | null;
  created_at:            string;
  updated_at:            string;
}

export interface AuditRun {
  id:                    string;
  company_id:            string;
  scope_type:            AuditScopeType;
  use_case_id:           string | null;
  use_case_name:         string | null;
  agent_id:              string | null;
  agent_name:            string | null;
  compliance_item_id:    string | null;
  compliance_item_name:  string | null;
  status:                AuditStatus;
  total_pairs:           number;
  completed_pairs:       number;
  failed_pairs:          number;
  overall_risk:          RiskLevel | null;
  summary_text:          string | null;
  error_message:         string | null;
  initiated_by:          string | null;
  created_at:            string;
  updated_at:            string;
  completed_at:          string | null;
  findings?:             AuditFinding[];
  // computed from server
  critical_count?:       number;
  high_count?:           number;
}

export interface AuditInitRequest {
  company_id:          string;
  scope_type:          AuditScopeType;
  use_case_id?:        string;
  use_case_name?:      string;
  agent_id?:           string;
  agent_name?:         string;
  compliance_item_id?: string;
  initiated_by?:       string;
}

// ── SSE event types ───────────────────────────────────────────────────────────

export interface AuditProgressEvent {
  type:          'progress';
  status:        AuditStatus;
  completed:     number;
  failed:        number;
  total:         number;
  pct:           number;
  overall_risk:  RiskLevel | null;
}

export interface AuditFindingEvent {
  type:    'finding';
  finding: AuditFinding;
}

export interface AuditDoneEvent {
  type:         'done';
  status:       AuditStatus;
  overall_risk: RiskLevel | null;
  summary:      string | null;
}

export type AuditSSEEvent = AuditProgressEvent | AuditFindingEvent | AuditDoneEvent | { type: 'error' | 'timeout'; message?: string };

// ── UI helpers ────────────────────────────────────────────────────────────────

export const RISK_META: Record<RiskLevel, { label: string; color: string; bg: string; badge: string; dot: string }> = {
  critical: { label: 'Critical', color: '#7f1d1d', bg: '#fef2f2', badge: '#fecaca', dot: '#dc2626' },
  high:     { label: 'High',     color: '#991b1b', bg: '#fff1f2', badge: '#fecdd3', dot: '#e11d48' },
  medium:   { label: 'Medium',   color: '#92400e', bg: '#fffbeb', badge: '#fde68a', dot: '#d97706' },
  low:      { label: 'Low',      color: '#14532d', bg: '#f0fdf4', badge: '#bbf7d0', dot: '#16a34a' },
  none:     { label: 'None',     color: '#475569', bg: '#f8fafc', badge: '#e2e8f0', dot: '#64748b' },
};

export const SCOPE_LABELS: Record<AuditScopeType, string> = {
  single:          'Single use case × single regulation',
  use_case_all:    'Single use case × all compliance items',
  catalog_single:  'Full catalog × single regulation',
  full:            'Full catalog × all compliance items',
};
