/**
 * artifactTemplates.ts
 *
 * Blueprint-aware document templates for structured project artifacts.
 *
 * Provides:
 *  - Standard governance review areas (applied to all artifacts)
 *  - Blueprint-derived extra review areas (when company context is available)
 *  - Required section lists for each artifact type
 *  - buildArtifactSystemInstruction() — the system-prompt block that is
 *    injected into the LLM context when artifact intent is detected
 */

import type { ArtifactType, DetectedArtifact } from './artifactDetector';
import type { BlueprintContext } from '../context/ChatContext';

// ── Review areas ──────────────────────────────────────────────────────────────
// These governance categories must appear in every Review Checklist section.
// Blueprint context can extend this list with industry- or domain-specific areas.

const STANDARD_REVIEW_AREAS = [
  'AI Risk Governance',
  'End User Computing (EUC)',
  'Operations',
  'Security',
  'Compliance and Regulatory',
  'Data Privacy',
  'Change Management',
];

function getReviewAreas(blueprint?: BlueprintContext | null): string[] {
  const areas = [...STANDARD_REVIEW_AREAS];
  if (!blueprint) return areas;

  const categories = new Set(blueprint.dimensions.map(d => d.category.toLowerCase()));
  if (categories.has('risk'))        areas.push('Enterprise Risk Management');
  if (categories.has('technology'))  areas.push('IT Infrastructure Review');
  if (categories.has('integration')) areas.push('Systems Integration Review');
  if (categories.has('process'))     areas.push('Business Process Impact');

  return [...new Set(areas)];
}

// ── Section definitions ───────────────────────────────────────────────────────

const SECTIONS: Record<ArtifactType, string[]> = {
  requirements_document: [
    'Executive Summary',
    'Business Context',
    'Problem Statement',
    'Objectives',
    'Functional Requirements',
    'Non-Functional Requirements',
    'Data Requirements',
    'Constraints and Assumptions',
    'Acceptance Criteria',
    'Review Checklist',
  ],
  technical_design_document: [
    'Executive Summary',
    'Platform Considerations',
    'Architecture Overview',
    'Components',
    'Tools and Integrations',
    'Security and Compliance',
    'Implementation Considerations',
    'Deployment and Operations',
  ],
  implementation_plan: [
    'Implementation Overview',
    'Implementation Phases',
    'Resource Requirements',
    'Timeline and Milestones',
    'Risk and Mitigation',
    'Dependencies',
    'Success Criteria',
  ],
  project_plan: [
    'Project Overview',
    'Scope and Objectives',
    'Workstreams',
    'Timeline',
    'Resource Plan',
    'Governance Structure',
    'Risk Register',
    'Communication Plan',
  ],
};

// ── Additional instructions per artifact type ─────────────────────────────────

function additionalInstructions(
  artifact: DetectedArtifact,
  blueprint?: BlueprintContext | null,
): string[] {
  const ctx = blueprint
    ? `Company: ${blueprint.companyName} | Industry: ${blueprint.industry} | Region: ${blueprint.region}.`
    : '';

  const shared = [
    ctx,
    'Do NOT write a preamble (e.g. "Here is...") or postamble (e.g. "I hope this helps") inside the artifact.',
    'ASCII only — no emojis or special Unicode symbols.',
  ];

  switch (artifact.type) {
    case 'requirements_document':
      return [
        ...shared,
        'Functional requirements must be numbered FR-001, FR-002, ...',
        'Non-functional requirements must cover performance, availability, scalability, and security.',
        'The Review Checklist section must be a markdown table with columns: Review Area | Status | Owner | Notes.',
        'Populate the Review Area column with every item from the review areas list.',
      ];

    case 'technical_design_document':
      return [
        ...shared,
        ...(artifact.includesComparison
          ? [
              'Include a "Platform Comparison and Recommendation" section with a structured table (Platform | Strengths | Limitations | Cost | Recommendation Score) and a clear recommended option with rationale.',
            ]
          : []),
        'Architecture Overview must include a textual description of the component diagram.',
        'Security and Compliance must address: authentication, authorisation, data encryption (at rest and in transit), audit logging, and governance controls.',
      ];

    case 'implementation_plan':
      return [
        ...shared,
        ...(artifact.includesApproval
          ? ['This is a FINAL APPROVED plan — include sign-off status, approver names (placeholders), and a version history table.']
          : ['Mark this document clearly as DRAFT at the top. Note sections pending approval.']),
        'Implementation Phases must include phase name, description, key activities, and duration.',
      ];

    case 'project_plan':
      return [
        ...shared,
        'Timeline section must break delivery into phases with start/end week numbers.',
        'Resource Plan must list roles, responsibilities, and estimated effort (person-days).',
        'Risk Register must include risk description, likelihood, impact, and mitigation action.',
      ];
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build the system-prompt block that is injected into the LLM context when
 * structured artifact intent is detected in the user message.
 *
 * Returned string is appended to the existing system prompt — it instructs the
 * LLM to generate each artifact wrapped in boundary markers so the client can
 * parse and export them as individual PDFs.
 */
export function buildArtifactSystemInstruction(
  artifacts: DetectedArtifact[],
  blueprint?: BlueprintContext | null,
): string {
  if (artifacts.length === 0) return '';

  const reviewAreas = getReviewAreas(blueprint);
  const reviewAreaList = reviewAreas.map(a => `  - ${a}`).join('\n');

  const artifactBlocks = artifacts
    .map(artifact => {
      const sections = [...SECTIONS[artifact.type]];
      // Inject Platform Comparison section if signalled
      if (artifact.type === 'technical_design_document' && artifact.includesComparison) {
        const insertAt = sections.indexOf('Security and Compliance');
        if (insertAt !== -1) {
          sections.splice(insertAt, 0, 'Platform Comparison and Recommendation');
        } else {
          sections.push('Platform Comparison and Recommendation');
        }
      }

      const sectionList = sections.map(s => `  - ${s}`).join('\n');
      const instructions = additionalInstructions(artifact, blueprint)
        .filter(Boolean)
        .map(i => `  - ${i}`)
        .join('\n');

      return `### ${artifact.label}
Artifact boundary type: ${artifact.type}
Required sections (use ## headings):
${sectionList}
Review areas (for Review Checklist tables):
${reviewAreaList}
Specific instructions:
${instructions}`;
    })
    .join('\n\n');

  const boundaryFormat = artifacts.length > 1
    ? `When the user requests multiple documents, wrap EACH document separately:

<!-- BEGIN_ARTIFACT:[type] -->
# Document Title
[full document content]
<!-- END_ARTIFACT -->

Available type values: ${artifacts.map(a => a.type).join(', ')}`
    : `Wrap the document as follows:

<!-- BEGIN_ARTIFACT:${artifacts[0].type} -->
# Document Title
[full document content]
<!-- END_ARTIFACT -->`;

  return `
## Structured Artifact Generation

The user has requested ${artifacts.length > 1 ? `${artifacts.length} structured project documents` : 'a structured project document'}. Generate each one completely and professionally.

### Output format rules
1. Each artifact starts with a # heading: "# [Document Label] - [Subject/Agent Name]"
2. Use ## for top-level sections, ### for subsections.
3. Review Checklist sections must be markdown tables (columns: Review Area | Status | Owner | Notes).
4. Do NOT start any artifact with "Here is", "Sure,", "I'll generate", or any acknowledgement.
5. Do NOT end any artifact with "I hope this helps", "Let me know", or any closing remark.
6. Use clean, professional enterprise-governance language.
7. ASCII only — no emoji or Unicode symbols outside the Latin-1 range.

${boundaryFormat}

### Artifact specifications
${artifactBlocks}`;
}
