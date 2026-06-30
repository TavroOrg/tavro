export const meta = {
  name: 'update-user-guide',
  description: 'Read changed source files and new screenshots, then patch UserGuidePage.tsx',
  phases: [
    { title: 'Understand', detail: 'Read git diff and identify changed features' },
    { title: 'Analyse',    detail: 'Map changes to guide sections' },
    { title: 'Patch',      detail: 'Rewrite affected sections in UserGuidePage.tsx' },
    { title: 'Verify',     detail: 'Check patch for correctness and completeness' },
  ],
};

// ── Schemas ───────────────────────────────────────────────────────────────────

const DIFF_ANALYSIS_SCHEMA = {
  type: 'object',
  required: ['changed_features', 'new_screenshots', 'removed_features'],
  properties: {
    changed_features: {
      type: 'array',
      items: {
        type: 'object',
        required: ['feature_name', 'section_id', 'what_changed', 'files'],
        properties: {
          feature_name:  { type: 'string' },
          section_id:    { type: 'string', description: 'The TOC id in UserGuidePage.tsx this maps to, e.g. govern-compliance' },
          what_changed:  { type: 'string' },
          files:         { type: 'array', items: { type: 'string' } },
        },
      },
    },
    new_screenshots: {
      type: 'array',
      items: { type: 'string', description: 'Screenshot filename added to /assets/images/screenshots/' },
    },
    removed_features: {
      type: 'array',
      items: { type: 'string', description: 'Feature name that was removed or marked Coming Soon' },
    },
    summary: { type: 'string' },
  },
};

const PATCH_SCHEMA = {
  type: 'object',
  required: ['patches'],
  properties: {
    patches: {
      type: 'array',
      items: {
        type: 'object',
        required: ['section_id', 'old_content_snippet', 'new_content', 'reason'],
        properties: {
          section_id:          { type: 'string' },
          old_content_snippet: { type: 'string', description: 'Unique substring to locate the section (first ~120 chars)' },
          new_content:         { type: 'string', description: 'Full replacement JSX for the section' },
          reason:              { type: 'string' },
        },
      },
    },
    no_changes_needed: { type: 'boolean' },
  },
};

const VERIFY_SCHEMA = {
  type: 'object',
  required: ['approved', 'issues'],
  properties: {
    approved: { type: 'boolean' },
    issues:   { type: 'array', items: { type: 'string' } },
    summary:  { type: 'string' },
  },
};

// ── Phase 1: Understand ───────────────────────────────────────────────────────

phase('Understand');

const diffAnalysis = await agent(
  `You are analysing a git diff to understand what changed in the Tavro Agent BizOps frontend.

TASK: Read the git diff of the PR that just merged to main. Identify:
1. Which UI pages/features were added, changed, or removed
2. Which screenshots in /assets/images/ were added or modified
3. Map each change to the corresponding section id in UserGuidePage.tsx

TOC section ids to reference:
- nav-overview, nav-sidebar, three-panel
- home-dashboard, home-metrics, home-flow
- insights, insights-stages, insights-risk, insights-governance
- end-to-end-workflow, workflow-blueprint, workflow-spark, workflow-usecases,
  workflow-agents, workflow-roadmap, workflow-build, workflow-deploy, workflow-govern
- build-section, build-playground, build-evals
- govern-section, govern-risk, govern-compliance, govern-guardrails, govern-issues
- settings-overview, llm-setup, roadmap-settings, appearance-settings

Run: git diff HEAD~1 HEAD --name-only
Then: git diff HEAD~1 HEAD -- tavro_app/src/pages/ tavro_app/src/components/ tavro_app/public/assets/images/

Return structured analysis.`,
  { label: 'read-diff', phase: 'Understand', schema: DIFF_ANALYSIS_SCHEMA }
);

log(`Found ${diffAnalysis.changed_features.length} changed features, ${diffAnalysis.new_screenshots.length} new screenshots`);

if (diffAnalysis.changed_features.length === 0 && diffAnalysis.new_screenshots.length === 0) {
  log('No user-facing changes detected. Guide is up to date.');
  return { no_changes_needed: true };
}

// ── Phase 2: Analyse ──────────────────────────────────────────────────────────

phase('Analyse');

const currentGuide = await agent(
  `Read the full file: tavro_app/src/pages/UserGuidePage.tsx
   Return its complete content as a string so it can be patched.`,
  { label: 'read-guide', phase: 'Analyse' }
);

const analyses = await parallel(
  diffAnalysis.changed_features.map(feature => () =>
    agent(
      `Analyse this feature change and determine exactly what needs updating in the user guide.

Feature: ${feature.feature_name}
Section ID: ${feature.section_id}
What changed: ${feature.what_changed}
Files changed: ${feature.files.join(', ')}
New screenshots available: ${diffAnalysis.new_screenshots.join(', ')}

Read the relevant page file(s) to understand the current UI:
${feature.files.map(f => `- ${f}`).join('\n')}

Then read the current guide section for "${feature.section_id}" in UserGuidePage.tsx.

Return: what specifically in the guide is now wrong/missing/outdated.`,
      { label: `analyse:${feature.section_id}`, phase: 'Analyse' }
    )
  )
);

// ── Phase 3: Patch ────────────────────────────────────────────────────────────

phase('Patch');

const patchPlan = await agent(
  `You are updating UserGuidePage.tsx based on UI changes.

CURRENT GUIDE (full file):
${currentGuide}

CHANGES NEEDED (one entry per feature):
${analyses.filter(Boolean).map((a, i) => `[${diffAnalysis.changed_features[i].section_id}]: ${a}`).join('\n\n')}

NEW SCREENSHOTS available at /assets/images/screenshots/:
${diffAnalysis.new_screenshots.join('\n')}

RULES:
- Only patch sections that are actually wrong or missing. Do not touch unrelated sections.
- Use <ScreenshotFrame src="/assets/images/screenshots/FILENAME.png" ... /> for new screenshots.
- Keep the same JSX component style (Step, Callout, UIButton, Badge, FlowDiagram, ScreenshotFrame, SectionHeading).
- For removed features, replace the section body with a Coming Soon badge: <Badge color="violet">Coming Soon</Badge>
- old_content_snippet must be a unique 80-120 char substring that appears exactly once in the file.
- new_content must be valid JSX (no TypeScript types, no import statements).

Return the patch list.`,
  { label: 'write-patches', phase: 'Patch', schema: PATCH_SCHEMA }
);

if (patchPlan.no_changes_needed) {
  log('Patch agent determined no guide changes are needed.');
  return { no_changes_needed: true };
}

log(`Generated ${patchPlan.patches.length} patch(es)`);

// ── Phase 4: Verify ───────────────────────────────────────────────────────────

phase('Verify');

const verification = await agent(
  `You are a technical reviewer verifying a user guide patch before it is applied.

PATCHES TO APPLY:
${JSON.stringify(patchPlan.patches, null, 2)}

CURRENT GUIDE:
${currentGuide}

Check each patch for:
1. old_content_snippet exists exactly once in the current guide (no duplicates, no missing)
2. new_content is valid JSX — balanced tags, no TypeScript syntax
3. The description accurately reflects the actual feature based on what changed
4. No section references features that were removed
5. Screenshot filenames in new_content match files in: ${diffAnalysis.new_screenshots.join(', ')}

Return approved: true only if ALL patches are safe to apply.`,
  { label: 'verify-patches', phase: 'Verify', schema: VERIFY_SCHEMA }
);

if (!verification.approved) {
  log(`Verification FAILED: ${verification.issues.join('; ')}`);
  return { approved: false, issues: verification.issues, patches: patchPlan.patches };
}

log('All patches verified. Ready to apply.');
return {
  approved: true,
  patches: patchPlan.patches,
  summary: diffAnalysis.summary,
};
