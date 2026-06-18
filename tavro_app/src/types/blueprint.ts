// ── src/types/blueprint.ts ────────────────────────────────────────────────────

export type DimCategory =
  | 'profile' | 'strategy' | 'process' | 'application'
  | 'organisation' | 'risk' | 'finance' | 'integration'
  | 'custom';

export type VisibilityLevel = 'public' | 'internal' | 'restricted' | 'confidential';

export type RelType =
  | 'depends_on' | 'owned_by' | 'supports' | 'risks'
  | 'enables' | 'part_of' | 'governed_by' | 'replaced_by' | 'custom';

// ── Company ───────────────────────────────────────────────────────────────────

export interface Company {
  id: string;
  name: string;
  industry: string;
  region: string;
  legal_entity?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CompanyCreate {
  name: string;
  industry: string;
  region?: string;
  legal_entity?: string;
}

// ── Dimension Type ────────────────────────────────────────────────────────────

export interface DimType {
  id: string;
  name: string;
  category: DimCategory;
  value_schema?: Record<string, any> | null;
  system_defined: boolean;
  max_hops: number;
  created_at: string;
}

// ── Dimension Node ────────────────────────────────────────────────────────────

export interface DimNode {
  id: string;
  company_id: string;
  dim_type_id: string;
  dim_type_name?: string;
  category?: DimCategory;
  label: string;
  summary?: string | null;
  tags: string[];
  visibility: VisibilityLevel;
  sensitive: boolean;
  valid_from: string;
  valid_to?: string | null;
  updated_at: string;
}

export interface DimNodeCreate {
  company_id: string;
  dim_type_id: string;
  label: string;
  summary?: string;
  tags?: string[];
  visibility?: VisibilityLevel;
  sensitive?: boolean;
}

export interface DimNodeUpdate {
  label?: string;
  summary?: string;
  tags?: string[];
  visibility?: VisibilityLevel;
  sensitive?: boolean;
  dim_type_id?: string;
}

// ── Dimension Edge ────────────────────────────────────────────────────────────

export interface DimEdge {
  id: string;
  source_id: string;
  target_id: string;
  source_label?: string;
  target_label?: string;
  rel_type: RelType;
  weight: number;
  meta: Record<string, any>;
  valid_from: string;
  valid_to?: string | null;
}

export interface DimEdgeCreate {
  source_id: string;
  target_id: string;
  rel_type: RelType;
  weight?: number;
  meta?: Record<string, any>;
}

// ── Source Reference ──────────────────────────────────────────────────────────

export interface SourceRef {
  id: string;
  dim_node_id: string;
  system_name: string;
  external_id: string;
  mcp_tool: string;
  last_synced?: string | null;
  created_at: string;
}

export interface SourceRefDetail {
  source_ref: SourceRef;
  detail?: Record<string, any> | null;
  fetched_at: string;
  error?: string | null;
}

// ── Graph ─────────────────────────────────────────────────────────────────────

export interface GraphNode {
  id: string;
  label: string;
  type: DimCategory;
  group: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  rel_type: string;
  weight: number;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ── Attachment ────────────────────────────────────────────────────────────────

export interface DimNodeAttachment {
  id: string;
  node_id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  uploaded_at: string;
}

// ── API Page wrapper ──────────────────────────────────────────────────────────

export interface Page<T> {
  total: number;
  offset: number;
  limit: number;
  items: T[];
}

// ── UI helpers ────────────────────────────────────────────────────────────────

/** Colour palette keyed by dim category — matches existing Tavro blue/slate scheme */
export const CATEGORY_PALETTE: Record<DimCategory, {
  bg: string; stroke: string; text: string; badge: string; dot: string;
}> = {
  profile:      { bg: '#eff6ff', stroke: '#2563eb', text: '#1d4ed8', badge: '#bfdbfe', dot: '#2563eb' },
  strategy:     { bg: '#f0fdf4', stroke: '#16a34a', text: '#15803d', badge: '#bbf7d0', dot: '#16a34a' },
  organisation: { bg: '#ecfeff', stroke: '#0891b2', text: '#0e7490', badge: '#a5f3fc', dot: '#0891b2' },
  finance:      { bg: '#fffbeb', stroke: '#d97706', text: '#b45309', badge: '#fde68a', dot: '#d97706' },
  risk:         { bg: '#fff1f2', stroke: '#e11d48', text: '#be123c', badge: '#fecdd3', dot: '#e11d48' },
  application:  { bg: '#faf5ff', stroke: '#9333ea', text: '#7e22ce', badge: '#e9d5ff', dot: '#9333ea' },
  process:      { bg: '#fff7ed', stroke: '#ea580c', text: '#c2410c', badge: '#fed7aa', dot: '#ea580c' },
  integration:  { bg: '#f0f9ff', stroke: '#0284c7', text: '#0369a1', badge: '#bae6fd', dot: '#0284c7' },
  custom:       { bg: '#fafaf9', stroke: '#78716c', text: '#57534e', badge: '#e7e5e4', dot: '#78716c' },
};

export const CATEGORY_LABELS: Record<DimCategory, string> = {
  profile: 'Profile', strategy: 'Strategy', organisation: 'Organization',
  finance: 'Financials', risk: 'Risks', application: 'Applications',
  process: 'Processes', integration: 'Integrations', custom: 'Custom',
};
