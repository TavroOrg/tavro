export const meta = {
  name: 'update-user-guide',
  description: 'Understand changed code then directly edit UserGuidePage.tsx',
  phases: [
    { title: 'Understand', detail: 'Read git diff and changed source files to know exactly what changed' },
    { title: 'Document',   detail: 'Directly edit UserGuidePage.tsx with the new documentation' },
  ],
};

const UNDERSTAND_SCHEMA = {
  type: 'object',
  required: ['changed_features', 'removed_features', 'summary'],
  properties: {
    changed_features: {
      type: 'array',
      items: {
        type: 'object',
        required: ['feature_name', 'section_id', 'route', 'what_changed', 'ui_elements', 'files'],
        properties: {
          feature_name: { type: 'string' },
          section_id:   { type: 'string', description: 'TOC id in UserGuidePage.tsx' },
          route:        { type: 'string' },
          what_changed: { type: 'string' },
          ui_elements:  { type: 'array', items: { type: 'string' } },
          files:        { type: 'array', items: { type: 'string' } },
        },
      },
    },
    removed_features: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
};

const DOCUMENT_SCHEMA = {
  type: 'object',
  required: ['edited', 'section_id'],
  properties: {
    edited:        { type: 'boolean', description: 'true if the file was edited, false if already up to date' },
    section_id:    { type: 'string' },
    change_summary:{ type: 'string' },
  },
};

// ── Phase 1: Understand ───────────────────────────────────────────────────────

phase('Understand');

const understanding = await agent(
  `You are analysing a merged PR to understand what UI changed.

STEP 1 — Get the diff:
  Run: git diff HEAD~1 HEAD --name-only
  Then: git diff HEAD~1 HEAD -- tavro_app/src/pages/ tavro_app/src/components/

STEP 2 — Filter to UI-only files:
  Only consider files under tavro_app/src/pages/ or tavro_app/src/components/.
  Ignore: package.json, .yml, .md, api files, backend files, test files.
  If no UI files changed, return changed_features: [] immediately.

STEP 3 — For each changed UI file, READ it to understand the change deeply:
  Read the actual source file — understand what UI elements were added or changed.
  Extract the visible UI elements (labels, buttons, cards, icons).

STEP 4 — Map to section_id and route:
  Route mapping:
  - HomePage.tsx → /
  - CatalogPage.tsx → /catalog
  - CompliancePage.tsx or AuditPage.tsx → /compliance
  - SparkPage.tsx → /spark
  - UseCasePage.tsx → /use-cases
  - BlueprintPage.tsx → /blueprint
  - RoadmapPage.tsx → /roadmap
  - GuardrailsPage.tsx → /guardrails
  - SettingsPage.tsx → /settings

  TOC section ids:
  - home-dashboard, home-metrics, home-flow
  - nav-overview, nav-sidebar, three-panel
  - govern-section, govern-risk, govern-compliance, govern-guardrails, govern-issues
  - build-section, build-playground, build-evals
  - insights, insights-stages, insights-risk, insights-governance
  - settings-overview, llm-setup, roadmap-settings, appearance-settings

Return a detailed understanding of what changed including exact UI element names.`,
  { label: 'understand', phase: 'Understand', schema: UNDERSTAND_SCHEMA }
);

log(`Understood ${understanding.changed_features.length} changed UI feature(s)`);

if (understanding.changed_features.length === 0) {
  log('No UI changes — nothing to document.');
  return { no_changes_needed: true };
}

// ── Phase 2: Document ─────────────────────────────────────────────────────────
// Each agent directly edits UserGuidePage.tsx using the Edit tool.
// No patch JSON — the file is modified in place with correct encoding.

phase('Document');

const results = await pipeline(
  understanding.changed_features,
  feature => agent(
    `You are documenting a UI feature by directly editing the Tavro user guide.

FEATURE: ${feature.feature_name}
SECTION ID: ${feature.section_id}
WHAT CHANGED: ${feature.what_changed}
UI ELEMENTS: ${feature.ui_elements.join(', ')}

FILE TO EDIT: tavro_app/src/pages/UserGuidePage.tsx

STEP 1 — Read ONLY the relevant section of the guide:
  Run: grep -n "${feature.section_id}" tavro_app/src/pages/UserGuidePage.tsx
  Then Read the file at those line numbers (read ~60 lines around the match).

STEP 2 — Decide: does the guide need updating?
  - If it already accurately describes the UI elements → return edited: false
  - If it is missing or outdated → proceed to Step 3

STEP 3 — Directly edit tavro_app/src/pages/UserGuidePage.tsx:
  Use the Edit tool to insert or update the documentation for this feature.

  RULES for the edit:
  - Use valid JSX only — use the existing Step, Callout, UIButton, Badge, SectionHeading components
  - No TypeScript types, no import statements
  - Match the indentation style of the surrounding code exactly
  - For removed features: use <Badge color="violet">Coming Soon</Badge>
  - Keep the edit focused — only change the section relevant to this feature

STEP 4 — Return the result:
  Return edited: true with a brief change_summary if you made an edit.
  Return edited: false if no change was needed.`,
    { label: `document:${feature.section_id}`, phase: 'Document', schema: DOCUMENT_SCHEMA }
  )
);

const edited = results.filter(Boolean).filter(r => r.edited);
log(`Done — ${edited.length} section(s) updated in UserGuidePage.tsx.`);

return {
  approved: true,
  edited_sections: edited.map(r => r.section_id),
  summary: understanding.summary,
};
