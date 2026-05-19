import { AgentData } from '../types/agent';

export type AgentRiskLevel = 'prohibited' | 'high' | 'medium' | 'low';

function asText(value: unknown): string {
  return String(value ?? '').toLowerCase().trim();
}

function extractTextBlobs(agent: AgentData): string[] {
  return [
    (agent as any).summary,
    (agent as any).risk_summary,
    (agent.risk_assessment as any)?.summary,
  ]
    .filter(Boolean)
    .map(v => String(v).toLowerCase());
}

function extractLabels(agent: AgentData): string[] {
  return [
    agent.risk_assessment?.blended_risk_classification,
    agent.risk_assessment?.regulatory_risk_classification,
    (agent as any).latest_risk_class,
    (agent as any).blended_risk_classification,
    (agent as any).risk_classification,
  ]
    .filter(Boolean)
    .map(asText);
}

export function getAgentRiskLevel(agent: AgentData): AgentRiskLevel {
  const labels = extractLabels(agent);
  const textBlobs = extractTextBlobs(agent);

  if (labels.some(v => v.includes('prohibited'))) return 'prohibited';
  if (labels.some(v => v.includes('high risk') || v === 'high' || v.includes('critical'))) return 'high';
  if (labels.some(v => v.includes('medium') || v.includes('moderate'))) return 'medium';
  if (labels.some(v => v.includes('other') || v.includes('low'))) return 'low';

  if (textBlobs.some(t => t.includes('risk classification:') && t.includes('prohibited'))) return 'prohibited';
  if (textBlobs.some(t => t.includes('risk classification:') && t.includes('high risk'))) return 'high';
  if (textBlobs.some(t => t.includes('risk classification:') && t.includes('medium'))) return 'medium';
  if (textBlobs.some(t => t.includes('risk classification:') && t.includes('other'))) return 'low';

  if (textBlobs.some(t => t.includes('designated as') && t.includes('prohibited'))) return 'prohibited';
  if (textBlobs.some(t => t.includes('designated as') && t.includes('high risk'))) return 'high';
  if (textBlobs.some(t => t.includes('designated as') && t.includes('medium'))) return 'medium';
  if (textBlobs.some(t => t.includes('designated as') && t.includes('other'))) return 'low';

  const isHighByApp = agent.application?.some(a => a.business_criticality?.includes('High') || a.emergency_tier?.includes('Critical'));
  const isMedByApp = agent.application?.some(a => a.business_criticality?.includes('Medium'));
  if (isHighByApp) return 'high';
  if (isMedByApp) return 'medium';

  return 'low';
}

export function hasResolvedAgentRisk(agent: AgentData): boolean {
  const labels = extractLabels(agent);
  if (labels.length > 0) return true;
  const textBlobs = extractTextBlobs(agent);
  return textBlobs.some(t => t.includes('risk classification:') || t.includes('designated as'));
}
