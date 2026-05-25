// ── src/types/compliance.ts ───────────────────────────────────────────────────

export type ComplianceItemType = 'regulation' | 'policy';
export type ComplianceScope    = 'external' | 'internal';
export type ComplianceStatus   = 'draft' | 'active' | 'superseded' | 'archived';
export type ImpactLevel        = 'critical' | 'high' | 'medium' | 'low' | 'none';
export type GapStatus          = 'open' | 'in_progress' | 'closed' | 'accepted' | 'not_applicable';
export type DocType            = 'source' | 'summary' | 'guidance' | 'evidence' | 'audit' | 'policy_text' | 'custom';

export type ComplianceDimCategory =
  | 'scope' | 'requirement' | 'control' | 'deadline'
  | 'penalty' | 'audit' | 'impact' | 'custom';

// ── Compliance item ───────────────────────────────────────────────────────────

export interface ComplianceItem {
  id:                string;
  item_type:         ComplianceItemType;
  scope:             ComplianceScope;
  name:              string;
  short_name?:       string | null;
  description?:      string | null;
  issuing_body?:     string | null;
  jurisdiction:      string[];
  industry_tags:     string[];
  company_id?:       string | null;
  effective_date?:   string | null;
  review_date?:      string | null;
  sunset_date?:      string | null;
  status:            ComplianceStatus;
  ai_researched:     boolean;
  research_sources?: string[] | null;
  created_at:        string;
  updated_at:        string;
  // computed
  dim_count?:        number;
  impact_count?:     number;
  doc_count?:        number;
  open_gaps?:        number;
  max_impact?:       ImpactLevel | null;
}

export interface ComplianceItemCreate {
  item_type:      ComplianceItemType;
  scope?:         ComplianceScope;
  name:           string;
  short_name?:    string;
  description?:   string;
  issuing_body?:  string;
  jurisdiction?:  string[];
  industry_tags?: string[];
  company_id?:    string;
  effective_date?: string;
  review_date?:   string;
  status?:        ComplianceStatus;
}

// ── Compliance dimension ──────────────────────────────────────────────────────

export interface ComplianceDimType {
  id:             string;
  name:           string;
  category:       ComplianceDimCategory;
  scope:          string;
  system_defined: boolean;
}

export interface ComplianceDimension {
  id:                  string;
  compliance_item_id:  string;
  dim_type_id:         string;
  type_name?:          string;
  type_category?:      ComplianceDimCategory;
  label:               string;
  summary?:            string | null;
  tags:                string[];
  visibility:          string;
  sensitive:           boolean;
  sort_order:          number;
  valid_from:          string;
  valid_to?:           string | null;
  updated_at:          string;
}

// ── Compliance impact ─────────────────────────────────────────────────────────

export interface ComplianceImpact {
  id:                  string;
  compliance_item_id:  string;
  company_id:          string;
  dim_node_id?:        string | null;
  dim_node_label?:     string | null;
  dim_category?:       string | null;
  impact_level:        ImpactLevel;
  impact_type:         string[];
  gap_description?:    string | null;
  gap_status:          GapStatus;
  current_state?:      string | null;
  target_state?:       string | null;
  remediation_plan?:   string | null;
  due_date?:           string | null;
  evidence_notes?:     string | null;
  last_assessed?:      string | null;
  created_at:          string;
  updated_at:          string;
}

export interface ComplianceImpactCreate {
  compliance_item_id:  string;
  company_id:          string;
  dim_node_id?:        string;
  impact_level:        ImpactLevel;
  impact_type:         string[];
  gap_description?:    string;
  gap_status?:         GapStatus;
  current_state?:      string;
  target_state?:       string;
  remediation_plan?:   string;
  due_date?:           string;
  evidence_notes?:     string;
}

// ── Compliance document ───────────────────────────────────────────────────────

export interface ComplianceDocument {
  id:                  string;
  compliance_item_id:  string;
  doc_type:            DocType;
  title:               string;
  filename?:           string | null;
  mime_type?:          string | null;
  file_size_bytes?:    number | null;
  source_url?:         string | null;
  ai_summary?:         string | null;
  ai_processed:        boolean;
  version?:            string | null;
  effective_date?:     string | null;
  created_at:          string;
  updated_at:          string;
}

// ── UI helpers ────────────────────────────────────────────────────────────────

export const IMPACT_LEVELS: Record<ImpactLevel, { label: string; color: string; bg: string; badge: string }> = {
  critical: { label: 'Critical', color: '#7f1d1d', bg: '#fef2f2', badge: '#fecaca' },
  high:     { label: 'High',     color: '#991b1b', bg: '#fff1f2', badge: '#fecdd3' },
  medium:   { label: 'Medium',   color: '#92400e', bg: '#fffbeb', badge: '#fde68a' },
  low:      { label: 'Low',      color: '#14532d', bg: '#f0fdf4', badge: '#bbf7d0' },
  none:     { label: 'None',     color: '#475569', bg: '#f8fafc', badge: '#e2e8f0' },
};

export const GAP_STATUS_META: Record<GapStatus, { label: string; color: string }> = {
  open:           { label: 'Open',          color: 'text-rose-700 dark:text-rose-300' },
  in_progress:    { label: 'In Progress',   color: 'text-amber-700 dark:text-amber-300' },
  closed:         { label: 'Closed',        color: 'text-emerald-700 dark:text-emerald-300' },
  accepted:       { label: 'Risk Accepted', color: 'text-slate-700 dark:text-slate-300' },
  not_applicable: { label: 'N/A',           color: 'text-slate-400 dark:text-slate-500' },
};

export const DIM_CATEGORY_META: Record<ComplianceDimCategory, { label: string; color: string; bg: string }> = {
  scope:       { label: 'Scope',       color: '#1d4ed8', bg: '#eff6ff' },
  requirement: { label: 'Requirement', color: '#7e22ce', bg: '#faf5ff' },
  control:     { label: 'Control',     color: '#0e7490', bg: '#ecfeff' },
  deadline:    { label: 'Deadline',    color: '#c2410c', bg: '#fff7ed' },
  penalty:     { label: 'Penalty',     color: '#be123c', bg: '#fff1f2' },
  audit:       { label: 'Audit',       color: '#15803d', bg: '#f0fdf4' },
  impact:      { label: 'Impact',      color: '#b45309', bg: '#fffbeb' },
  custom:      { label: 'Custom',      color: '#475569', bg: '#f8fafc' },
};

export const ITEM_TYPE_META: Record<ComplianceItemType, { label: string; icon: string; color: string; bg: string }> = {
  regulation: { label: 'Regulation', icon: '⚖️', color: '#1d4ed8', bg: '#eff6ff' },
  policy:     { label: 'Policy',     icon: '📋', color: '#7e22ce', bg: '#faf5ff' },
};
