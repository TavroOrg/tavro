export interface SparkTargetNode {
  id: string;
  label: string;
  category: string;
  summary: string | null;
}

export interface SparkSimilarAgent {
  agent_id: string;
  agent_name: string | null;
}

export interface SparkIdea {
  idea_id: string;
  title: string;
  description: string;
  rationale: string;
  signal_type: 'gap_coverage' | 'risk_hotspot' | 'integration_surface' | 'compliance_gap' | 'strategic_gap';
  signal_label: string;
  target_dimensions: string[];
  target_nodes: SparkTargetNode[];
  complexity: 'Low' | 'Medium' | 'High';
  estimated_impact: 'Low' | 'Medium' | 'High';
  similar_agents: SparkSimilarAgent[];
  saved?: boolean;
}

export interface SparkConvertRequest {
  idea_id: string;
  company_id: string;
  title: string;
  description: string;
  rationale: string;
  target_dimensions: string[];
  signal_label?: string;
  complexity?: string;
  estimated_impact?: string;
}

export const SPARK_DIMENSIONS = [
  { key: 'process',      label: 'Processes'     },
  { key: 'application',  label: 'Applications'  },
  { key: 'risk',         label: 'Risks'         },
  { key: 'strategy',     label: 'Strategy'      },
  { key: 'finance',      label: 'Financials'    },
  { key: 'integration',  label: 'Integrations'  },
  { key: 'organisation', label: 'Organization'  },
] as const;

export const SIGNAL_META: Record<string, { label: string; color: string }> = {
  gap_coverage:       { label: 'Coverage Gap',        color: 'bg-blue-50 text-blue-700 border-blue-200' },
  risk_hotspot:       { label: 'Risk Hotspot',        color: 'bg-red-50 text-red-700 border-red-200' },
  integration_surface:{ label: 'Integration Surface', color: 'bg-violet-50 text-violet-700 border-violet-200' },
  compliance_gap:     { label: 'Compliance Gap',      color: 'bg-amber-50 text-amber-700 border-amber-200' },
  strategic_gap:      { label: 'Strategic Gap',       color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
};

export const COMPLEXITY_META: Record<string, string> = {
  Low:    'bg-emerald-50 text-emerald-700 border-emerald-200',
  Medium: 'bg-amber-50 text-amber-700 border-amber-200',
  High:   'bg-red-50 text-red-700 border-red-200',
};

export const IMPACT_META: Record<string, string> = {
  Low:    'bg-slate-50 text-slate-600 border-slate-200',
  Medium: 'bg-blue-50 text-blue-700 border-blue-200',
  High:   'bg-violet-50 text-violet-700 border-violet-200',
};
