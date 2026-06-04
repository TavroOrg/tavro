/**
 * artifactDetector.ts
 *
 * Intent-based artifact detection using semantic signal scoring.
 * Determines which structured project artifacts (requirements documents,
 * technical design documents, implementation plans, project plans) a user
 * is requesting — without relying on exact phrase or keyword matching.
 *
 * Detection works by combining multiple independent semantic signals.
 * No single word or phrase determines an artifact type; several domain
 * signals must align before an artifact is included in the result.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type ArtifactType =
  | 'requirements_document'
  | 'technical_design_document'
  | 'implementation_plan'
  | 'project_plan';

export interface DetectedArtifact {
  type: ArtifactType;
  /** Human-readable document title used as PDF title and heading. */
  label: string;
  /** True when the user's message implies a platform/tool comparison. */
  includesComparison?: boolean;
  /** True when the user's message implies a finalised or approved version. */
  includesApproval?: boolean;
}

// ── Semantic signal library ───────────────────────────────────────────────────
//
// Each pattern captures a *conceptual domain*, not a fixed phrase.
// Word-boundary anchors (\b) prevent partial-word matches.
// Patterns use \w* on stems to handle inflections (create/creates/creating).

const S = {
  // User intends to produce, receive, or request a deliverable.
  produce: /\b(show|generat|creat|writ|produc|give|provid|draft|prepar|make|build|get|deliver|want|need)\w*\b/i,

  // Structured document, plan, or artefact vocabulary.
  artifact: /\b(document|report|plan|spec(?:ification)?|design|proposal|outline|overview|template|guide|artifact|deliverable)\b/i,

  // Requirements and business-analysis domain signals.
  // These are specific enough that any match is meaningful context.
  reqDomain: /\b(requirement|functional|non.?functional|acceptance.?criter|business.?case|objective|scope\b|constraint|assumption|stakeholder|problem.?statement|executive.?summar)\b/i,

  // Technical design and architecture vocabulary.
  // Covers "technical design", "architecture", "system design", "solution design", "tech spec".
  techDoc: /\b(technical\s+design|architect(?:ure|ural)?|system\s+design|solution\s+design|tech(?:nical)?\s+spec(?:ification)?|design\s+document|technical\s+document)\b/i,

  // Named platform or product signals — implies technical decision-making context.
  platforms: /\b(copilot\s+studio|azure\s+(?:ai|openai|foundry)|ai\s+(?:foundry|studio)|microsoft\s+(?:azure|copilot|fabric)|power\s+(?:platform|automate)|power\s+apps?|openai|aws\s+bedrock|vertex\s+ai|google\s+cloud)\b/i,

  // Comparison, evaluation, or recommendation signals.
  compare: /\b(compar\w*|recommend\w*|vs\.?|versus|option|alternative|evaluat\w*|analys\w*)\b/i,

  // Implementation plan compound signals — two-word domain terms.
  // Requires an explicit "X plan" form to avoid triggering on generic "deploy" mentions.
  implPlan: /\b(implementation\s+plan|deployment\s+plan|rollout\s+plan|migration\s+plan|release\s+plan|launch\s+plan|execution\s+plan|go.?live\s+plan|delivery\s+plan)\b/i,

  // Project management compound signals.
  projPlan: /\b(project\s+(?:plan|schedule|timeline|roadmap)|programme?\s+plan|deployment\s+(?:schedule|roadmap|timeline))\b/i,

  // Finalisation / approval qualifiers.
  approved: /\b(approv\w*|final\s+(?:approved?|version|plan)|sign.?off|ratif\w*|authoris\w*|authoriz\w*)\b/i,
} as const;

function m(text: string, sig: RegExp): boolean { return sig.test(text); }

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Analyse a user message and return the list of structured project artifacts
 * being requested. Returns [] when no artifact intent is detected.
 *
 * Rules (applied independently — multiple artifacts can be returned):
 *
 * Requirements Document — any requirements/business-analysis domain signal.
 * Technical Design Doc  — explicit tech-design vocabulary OR named platforms
 *                         combined with artifact/comparison/produce signals.
 * Implementation Plan   — explicit "X plan" implementation compound phrase.
 * Project Plan          — explicit project-management compound phrase.
 */
export function detectArtifacts(userMessage: string): DetectedArtifact[] {
  const t = userMessage;

  // Fast exit: the message must at minimum express produce intent or contain
  // artifact vocabulary before any artifact-specific checks are run.
  if (!m(t, S.produce) && !m(t, S.artifact)) return [];

  const result: DetectedArtifact[] = [];

  // ── Requirements Document ─────────────────────────────────────────────────
  if (m(t, S.reqDomain)) {
    result.push({ type: 'requirements_document', label: 'Requirements Document' });
  }

  // ── Technical Design Document ─────────────────────────────────────────────
  // Either explicit tech-design vocabulary alone, OR platform names combined
  // with a document/comparison/produce signal (implies a platform comparison TDD).
  const hasTechDoc =
    m(t, S.techDoc) ||
    (m(t, S.platforms) && (m(t, S.compare) || m(t, S.artifact) || m(t, S.produce)));
  if (hasTechDoc) {
    result.push({
      type: 'technical_design_document',
      label: 'Technical Design Document',
      includesComparison: m(t, S.compare) || m(t, S.platforms),
    });
  }

  // ── Implementation Plan ───────────────────────────────────────────────────
  if (m(t, S.implPlan)) {
    const isApproved = m(t, S.approved);
    result.push({
      type: 'implementation_plan',
      label: isApproved ? 'Final Approved Implementation Plan' : 'Implementation Plan Draft',
      includesApproval: isApproved,
    });
  }

  // ── Project Plan ──────────────────────────────────────────────────────────
  if (m(t, S.projPlan)) {
    result.push({ type: 'project_plan', label: 'Project Plan' });
  }

  return result;
}

/** Returns true when any structured artifact intent is detected in the message. */
export function hasArtifactIntent(userMessage: string): boolean {
  return detectArtifacts(userMessage).length > 0;
}
