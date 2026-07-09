/**
 * API-Driven Action UAT — Business Logic Verification
 *
 * Hits tavro_api directly with two REAL ZITADEL-authenticated tenants
 * (see tests/setup/global-setup.ts, which provisions two real orgs + real
 * human users via the ZITADEL Management API, and tests/setup/auth.setup.ts,
 * which logs each of them in through the actual hosted-UI login form —
 * exactly like a human would).
 *
 * tavro_api itself has no JWT verification of its own: every router reads
 * `x-tenant-id` straight off the request header (see
 * tavro_api/api/dependencies.py::require_tenant and the per-router
 * `_tenant(request)` helpers), trusting whatever the frontend already
 * resolved from the user's real ZITADEL org claim. That's exactly what
 * these tests probe: given two genuinely different, genuinely
 * authenticated tenants, does the REST layer keep their data apart?
 *
 * Four concerns, one file:
 *   1. Tenant/company isolation (incl. the "global record" sharing design,
 *      and several confirmed cross-tenant read/write gaps — see the
 *      @critical-tagged and Security boundary sections below)
 *   2. Payload format validation (extra="forbid" schemas, required fields,
 *      invalid UUIDs, empty-body contracts)
 *   3. Business logic (self-reference checks, link/unlink semantics)
 *   4. MCP tool surface (tests/utils/mcpTestClient.ts) — mcp_server/server.py's
 *      streamable-http JSON-RPC endpoint, a separate code path from
 *      tavro_api's REST routes with its own (mostly stronger) auth model
 *
 * Prerequisites:
 *   1. Full docker compose stack running (ZITADEL + tavro_api + tavro_app + risk-mcp-server)
 *   2. `npx playwright install chromium` (real hosted-UI login needs a browser)
 *
 * Run:  npm run test:api
 */

import { test, expect } from '@playwright/test';
import { authFilePath } from './setup/global-setup';
import {
  openTenantSession,
  type TenantSession,
  authHeaders,
  createCompany,
  getCompany,
  listCompanies,
  updateCompany,
  deleteCompany,
  createEntity,
  listEntities,
  getEntity,
  updateEntity,
  deleteEntity,
  entityIdField,
  type EntityKind,
  linkApplicationToProcess,
  unlinkApplicationFromProcess,
  createAgent,
  listAgents,
  getAgent,
  updateAgent,
  deleteAgent,
  createUseCase,
  listUseCases,
  getUseCase,
  updateUseCase,
  deleteUseCase,
  linkAgentToUseCase,
  unlinkAgentFromUseCase,
  createAiModel,
  listAiModels,
  getAiModel,
  updateAiModel,
  deleteAiModel,
  linkAgentToAiModel,
  unlinkAgentFromAiModel,
} from './utils/tenantClient';
import { openMcpSession, callMcpTool, type McpSession } from './utils/mcpTestClient';

const API_BASE_URL = process.env.E2E_API_URL || 'http://localhost:8000';

let tenantA: TenantSession;
let tenantB: TenantSession;
let mcpA: McpSession;
let mcpB: McpSession;

test.beforeAll(async ({ browser }) => {
  tenantA = await openTenantSession(browser, authFilePath('tenantA'));
  tenantB = await openTenantSession(browser, authFilePath('tenantB'));
  mcpA = await openMcpSession(tenantA.request, tenantA);
  mcpB = await openMcpSession(tenantB.request, tenantB);
});

test.afterAll(async () => {
  await tenantA?.context.close();
  await tenantB?.context.close();
});

// ═════════════════════════════════════════════════════════════════════════
// 1. TENANT / COMPANY ISOLATION
// ═════════════════════════════════════════════════════════════════════════

// ── Companies — tenant isolation ───────────────────────────────────────────

test.describe('Companies — tenant isolation', () => {
  let companyAId: string;

  test.beforeAll(async () => {
    const res = await createCompany(tenantA, { name: `UAT Tenant-A Co ${Date.now()}` });
    expect(res.status(), `Expected 201 creating company for tenant A. Body: ${await res.text()}`).toBe(201);
    companyAId = (await res.json()).id;
    expect(companyAId, 'Created company must return an id').toBeTruthy();
  });

  test('[GET/PATCH /companies] owning tenant can list, get, update and delete its own company', async () => {
    const list = await listCompanies(tenantA);
    expect(list.status()).toBe(200);
    const ids = (await list.json()).items.map((c: any) => c.id);
    expect(ids, 'Tenant A should see its own company in its list').toContain(companyAId);

    const got = await getCompany(tenantA, companyAId);
    expect(got.status()).toBe(200);

    const updated = await updateCompany(tenantA, companyAId, { industry: 'Finance' });
    expect(updated.status()).toBe(200);
    expect((await updated.json()).industry).toBe('Finance');
  });

  test('[GET /companies] a different (real) tenant cannot see the company in its list', async () => {
    const list = await listCompanies(tenantB);
    expect(list.status()).toBe(200);
    const ids = (await list.json()).items.map((c: any) => c.id);
    expect(ids, "Tenant B must not see Tenant A's company").not.toContain(companyAId);
  });

  test('[GET /companies/{id}] a different (real) tenant gets 404 fetching the company by id', async () => {
    const res = await getCompany(tenantB, companyAId);
    expect(res.status(), 'Cross-tenant GET must not leak the record').toBe(404);
  });

  test('[PATCH /companies/{id}] a different (real) tenant cannot update the company', async () => {
    const res = await updateCompany(tenantB, companyAId, { industry: 'Should Not Apply' });
    expect(res.status(), 'Cross-tenant PATCH must be rejected').toBe(404);
  });

  test('[DELETE /companies/{id}] a different (real) tenant cannot delete the company', async () => {
    const res = await deleteCompany(tenantB, companyAId);
    expect(res.status(), 'Cross-tenant DELETE must be rejected').toBe(404);

    // Confirm it's still there for the rightful owner.
    const stillThere = await getCompany(tenantA, companyAId);
    expect(stillThere.status()).toBe(200);
  });
});

// ── Applications / Processes / Integrations — company + tenant isolation ──
//
// All three resources share the same router pattern in
// tavro_api/api/routers/business_relations.py: list endpoints filter by
// `company_id`, but the SQL predicate is
//   (x.company_id = :filter_company_id OR x.company_id IS NULL OR ...)
// which means a record created *without* a company_id (a "global" record)
// is returned for every company's filtered list within the tenant.
// Tenant-level scoping is separately enforced via `x.tenant_id = :tenant_id`.

const ENTITY_KINDS: EntityKind[] = ['applications', 'processes', 'integrations'];

for (const kind of ENTITY_KINDS) {
  test.describe(`${kind} — company isolation within a real tenant`, () => {
    let companyOneId: string;
    let companyTwoId: string;

    test.beforeAll(async () => {
      const c1 = await createCompany(tenantA, { name: `UAT ${kind} Co1 ${Date.now()}` });
      const c2 = await createCompany(tenantA, { name: `UAT ${kind} Co2 ${Date.now()}` });
      expect(c1.status()).toBe(201);
      expect(c2.status()).toBe(201);
      companyOneId = (await c1.json()).id;
      companyTwoId = (await c2.json()).id;
    });

    test(`[POST/GET /${kind}] a ${kind} record scoped to company one is not visible when filtering by company two`, async () => {
      const created = await createEntity(tenantA, kind, { companyId: companyOneId });
      expect(created.status(), `Expected 201 creating ${kind}. Body: ${await created.text()}`).toBe(201);
      const createdId = (await created.json())[entityIdField(kind)];
      expect(createdId, `Created ${kind} must return an id`).toBeTruthy();

      const filteredByOwner = await listEntities(tenantA, kind, companyOneId);
      expect(filteredByOwner.status()).toBe(200);
      const ownerIds = (await filteredByOwner.json()).items.map((r: any) => r[entityIdField(kind)]);
      expect(ownerIds, `Owning company must see its own ${kind} record`).toContain(createdId);

      const filteredByOther = await listEntities(tenantA, kind, companyTwoId);
      expect(filteredByOther.status()).toBe(200);
      const otherIds = (await filteredByOther.json()).items.map((r: any) => r[entityIdField(kind)]);
      expect(otherIds, "Company two must not see company one's " + kind + " record").not.toContain(createdId);
    });

    test(`[POST/GET /${kind}] a ${kind} record created without a company_id ("global record") is intentionally shared across every company in the tenant`, async () => {
      // Confirmed with the team: a record with no company_id is a
      // deliberate shared/catalog entry, not a bug — it's meant to appear
      // regardless of which company_id a caller filters by, as long as
      // they're in the same tenant. tavro_api's `_is_global_company_value()`
      // helper (agents.py / business_relations.py) exists specifically to
      // recognize and preserve this behavior.
      const created = await createEntity(tenantA, kind); // no companyId -> company_id stays NULL
      expect(created.status(), `Expected 201 creating global ${kind}. Body: ${await created.text()}`).toBe(201);
      const createdId = (await created.json())[entityIdField(kind)];
      expect(createdId).toBeTruthy();

      for (const companyId of [companyOneId, companyTwoId]) {
        const filtered = await listEntities(tenantA, kind, companyId);
        expect(filtered.status()).toBe(200);
        const ids = (await filtered.json()).items.map((r: any) => r[entityIdField(kind)]);
        expect(ids, `A global ${kind} record must be visible from every company within its own tenant`).toContain(createdId);
      }
    });
  });

  test.describe(`${kind} — cross-tenant isolation (real tenants)`, () => {
    test(`[POST/GET /${kind}] a ${kind} record created under Tenant A is invisible to Tenant B`, async () => {
      const companyRes = await createCompany(tenantA, { name: `UAT ${kind} tenant-a co ${Date.now()}` });
      expect(companyRes.status()).toBe(201);
      const companyId = (await companyRes.json()).id;

      const created = await createEntity(tenantA, kind, { companyId });
      expect(created.status()).toBe(201);
      const createdId = (await created.json())[entityIdField(kind)];

      const listAsB = await listEntities(tenantB, kind);
      expect(listAsB.status()).toBe(200);
      const idsAsB = (await listAsB.json()).items.map((r: any) => r[entityIdField(kind)]);
      expect(idsAsB, `Tenant B must not see Tenant A's ${kind} record`).not.toContain(createdId);

      const getAsB = await getEntity(tenantB, kind, createdId);
      expect(getAsB.status(), `Cross-tenant GET of a ${kind} record must not leak it`).toBe(404);
    });

    test(`[POST/GET /${kind}] a global (no company_id) ${kind} record created under Tenant A still respects the tenant boundary for Tenant B`, async () => {
      // Global records are intentionally shared across companies *within*
      // a tenant (see the describe block above), but that sharing must
      // stop at the tenant boundary — the query's tenant_id predicate is a
      // separate AND-ed condition from the company_id OR-fallback.
      const created = await createEntity(tenantA, kind); // no companyId -> company_id stays NULL
      expect(created.status()).toBe(201);
      const createdId = (await created.json())[entityIdField(kind)];

      const listAsB = await listEntities(tenantB, kind);
      expect(listAsB.status()).toBe(200);
      const idsAsB = (await listAsB.json()).items.map((r: any) => r[entityIdField(kind)]);
      expect(idsAsB, `Tenant B must not see Tenant A's global ${kind} record`).not.toContain(createdId);
    });
  });
}

// ── Agents — tenant isolation ────────────────────────────────────────────────
//
// Unlike use-cases/ai-models below, agents.py requires x-tenant-id via
// _require_tenant() and correctly filters update/delete by tenant_id — this
// is the "control group" showing isolation done right, for contrast.

test.describe('Agents — tenant isolation', () => {
  let agentAId: string;

  test.beforeAll(async () => {
    const res = await createAgent(tenantA, { name: `UAT Tenant-A Agent ${Date.now()}` });
    expect(res.status(), `Expected 201 creating agent. Body: ${await res.text()}`).toBe(201);
    agentAId = (await res.json()).agent_id;
    expect(agentAId).toBeTruthy();
  });

  test('[GET/PUT /agents] owning tenant can list, get and update its own agent', async () => {
    const list = await listAgents(tenantA);
    expect(list.status()).toBe(200);
    const ids = (await list.json()).data.map((a: any) => a.agent_id);
    expect(ids, 'Tenant A should see its own agent in its list').toContain(agentAId);

    const got = await getAgent(tenantA, agentAId);
    expect(got.status()).toBe(200);

    const updated = await updateAgent(tenantA, agentAId, { agent_name: `UAT Tenant-A Agent updated ${Date.now()}` });
    expect(updated.status()).toBe(200);
  });

  test('[GET /agents] a different tenant does not see the agent in its catalog list', async () => {
    const list = await listAgents(tenantB);
    const ids = (await list.json()).data.map((a: any) => a.agent_id);
    expect(ids, "Tenant B must not see Tenant A's agent").not.toContain(agentAId);
  });

  test('[PUT/DELETE /agents/{id}] a different tenant cannot update or delete the agent (correctly tenant-scoped)', async () => {
    const updated = await updateAgent(tenantB, agentAId, { agent_name: 'Should Not Apply' });
    expect(updated.status(), 'Cross-tenant PUT must be rejected').toBe(404);

    const deleted = await deleteAgent(tenantB, agentAId);
    expect(deleted.status(), 'Cross-tenant DELETE must be rejected').toBe(404);

    const stillThere = await getAgent(tenantA, agentAId);
    expect(stillThere.status()).toBe(200);
  });

  test('[GET /agents/{id}] a different tenant cannot read full agent details', async () => {
    const got = await getAgent(tenantB, agentAId);
    expect(got.status(), 'Cross-tenant GET must not leak the record').toBe(404);
  });
});

// ── AI Use Cases / AI Models — cross-tenant write access ───────────────────
//
// Verifies update_use_case/delete_use_case (use_cases.py) and
// update_ai_model/delete_ai_model (ai_models.py) reject writes from a
// tenant that doesn't own the record. Tagged @critical so they can be
// singled out with --grep @critical.

test.describe('AI Use Cases — cross-tenant write access', { tag: '@critical' }, () => {
  test('[PUT /use-cases/{id}] a different tenant cannot update a use case it does not own', async () => {
    const created = await createUseCase(tenantA, { title: `UAT victim use case ${Date.now()}` });
    expect(created.status()).toBe(201);
    const useCaseId = (await created.json()).use_case_id;

    try {
      const hijacked = await updateUseCase(tenantB, useCaseId, { title: 'HIJACKED BY TENANT B' });
      expect(hijacked.status(), 'Tenant B must not be able to update a use case it does not own').toBe(404);
    } finally {
      // The exploit renames the record away from the "UAT " prefix
      // global-teardown.ts matches on, so it must be cleaned up here
      // (as the rightful owner) regardless of whether the assertion above
      // passed or failed.
      await deleteUseCase(tenantA, useCaseId);
    }
  });

  test('[DELETE /use-cases/{id}] a different tenant cannot delete a use case it does not own', async () => {
    const created = await createUseCase(tenantA, { title: `UAT victim use case ${Date.now()}` });
    expect(created.status()).toBe(201);
    const useCaseId = (await created.json()).use_case_id;

    const deleted = await deleteUseCase(tenantB, useCaseId);
    expect(deleted.status(), 'Tenant B must not be able to delete a use case it does not own').toBe(404);
  });
});

test.describe('AI Models — cross-tenant write access', { tag: '@critical' }, () => {
  test('[PUT /ai-models/{id}] a different tenant cannot update an AI model it does not own', async () => {
    const created = await createAiModel(tenantA, { name: `UAT victim model ${Date.now()}` });
    expect(created.status()).toBe(201);
    const modelId = (await created.json()).ai_model_id;

    try {
      const hijacked = await updateAiModel(tenantB, modelId, { model_name: 'HIJACKED BY TENANT B' });
      expect(hijacked.status(), 'Tenant B must not be able to update an AI model it does not own').toBe(404);
    } finally {
      // Same reasoning as the use-case hijack test above: the exploit
      // renames the record away from the "UAT " prefix teardown matches on.
      await deleteAiModel(tenantA, modelId);
    }
  });

  test('[DELETE /ai-models/{id}] a different tenant cannot delete an AI model it does not own', async () => {
    const created = await createAiModel(tenantA, { name: `UAT victim model ${Date.now()}` });
    expect(created.status()).toBe(201);
    const modelId = (await created.json()).ai_model_id;

    const deleted = await deleteAiModel(tenantB, modelId);
    expect(deleted.status(), 'Tenant B must not be able to delete an AI model it does not own').toBe(404);
  });
});

// ── AI Use Cases / AI Models — missing x-tenant-id header ──────────────────
//
// use_cases.py and ai_models.py use the soft _tenant(request) helper, not
// agents.py's _require_tenant() — omitting x-tenant-id entirely doesn't
// 400, it silently skips the tenant_id WHERE clause on list.

test.describe('AI Use Cases / AI Models — missing tenant header must not leak across tenants', () => {
  test('[GET /use-cases] omitting x-tenant-id entirely must not return records across all tenants', async ({ request }) => {
    const markerA = await createUseCase(tenantA, { title: `UAT PROOF-usecase-tenantA-${Date.now()}` });
    const markerB = await createUseCase(tenantB, { title: `UAT PROOF-usecase-tenantB-${Date.now()}` });
    expect(markerA.status()).toBe(201);
    expect(markerB.status()).toBe(201);
    const idA = (await markerA.json()).use_case_id;
    const idB = (await markerB.json()).use_case_id;

    const res = await request.get(`${API_BASE_URL}/api/v1/use-cases`); // no headers at all
    expect(res.status()).toBe(200);
    const ids = (await res.json()).data.map((r: any) => r.ai_use_case_id);

    expect(
      ids,
      'A request with no x-tenant-id header must not return every tenant\'s use cases unfiltered',
    ).not.toEqual(expect.arrayContaining([idA, idB]));
  });

  test('[GET /ai-models] omitting x-tenant-id entirely must not return records across all tenants', async ({ request }) => {
    const markerA = await createAiModel(tenantA, { name: `UAT PROOF-model-tenantA-${Date.now()}` });
    const markerB = await createAiModel(tenantB, { name: `UAT PROOF-model-tenantB-${Date.now()}` });
    expect(markerA.status()).toBe(201);
    expect(markerB.status()).toBe(201);
    const idA = (await markerA.json()).ai_model_id;
    const idB = (await markerB.json()).ai_model_id;

    const res = await request.get(`${API_BASE_URL}/api/v1/ai-models`); // no headers at all
    expect(res.status()).toBe(200);
    const ids = (await res.json()).items.map((r: any) => r.ai_model_id);

    expect(
      ids,
      'A request with no x-tenant-id header must not return every tenant\'s AI models unfiltered',
    ).not.toEqual(expect.arrayContaining([idA, idB]));
  });
});

// ── Security boundary — tenant header trust ────────────────────────────────

test.describe('Security boundary — tenant header trust', () => {
  test('[GET /companies/{id}] a request with no Authorization/Bearer token must not get a real tenant\'s data merely by supplying its real x-tenant-id', async ({ request }) => {
    const created = await createCompany(tenantA, { name: `UAT victim co ${Date.now()}` });
    expect(created.status()).toBe(201);
    const companyId = (await created.json()).id;

    // A plain, unauthenticated request context — no cookies, no Bearer
    // token from Tenant A's real login session — carrying only the real
    // (guessed/known) ZITADEL org id as x-tenant-id.
    const res = await request.get(`${API_BASE_URL}/api/v1/companies/${companyId}`, {
      headers: { 'x-tenant-id': tenantA.tenantId },
    });

    expect(
      [401, 403],
      "Unauthenticated requests must not be able to read a real tenant's data by supplying its x-tenant-id header",
    ).toContain(res.status());
  });

  for (const kind of ENTITY_KINDS) {
    test(`[GET /${kind}] omitting x-tenant-id entirely must not return every tenant's records unfiltered`, async ({ request }) => {
      const markerA = await createEntity(tenantA, kind, { name: `UAT PROOF-${kind}-tenantA-${Date.now()}` });
      const markerB = await createEntity(tenantB, kind, { name: `UAT PROOF-${kind}-tenantB-${Date.now()}` });
      expect(markerA.status()).toBe(201);
      expect(markerB.status()).toBe(201);
      const idA = (await markerA.json())[entityIdField(kind)];
      const idB = (await markerB.json())[entityIdField(kind)];

      const res = await request.get(`${API_BASE_URL}/api/v1/${kind}`); // no headers at all
      expect(res.status()).toBe(200);
      const ids = (await res.json()).items.map((r: any) => r[entityIdField(kind)]);

      expect(
        ids,
        `A request with no x-tenant-id header must not return every tenant's ${kind} records unfiltered`,
      ).not.toEqual(expect.arrayContaining([idA, idB]));
    });
  }
});

// ═════════════════════════════════════════════════════════════════════════
// 2. PAYLOAD FORMAT VERIFICATION
// ═════════════════════════════════════════════════════════════════════════

// ── Companies ───────────────────────────────────────────────────────────────

test.describe('Companies — payload format', () => {
  test('[POST /companies] ignores an unrecognized field on create instead of rejecting it', async () => {
    const res = await tenantA.request.post(`${API_BASE_URL}/api/v1/companies`, {
      headers: authHeaders(tenantA),
      data: { name: `UAT payload-format ${Date.now()}`, industry: 'y', region: 'US', not_a_real_field: 'boom' },
    });
    expect(res.status(), `Expected 201. Body: ${await res.text()}`).toBe(201);
    const body = await res.json();
    expect(body).not.toHaveProperty('not_a_real_field');
  });

  test('[POST /companies] rejects a create request missing required fields (name, industry) with 422', async () => {
    const res = await tenantA.request.post(`${API_BASE_URL}/api/v1/companies`, {
      headers: authHeaders(tenantA),
      data: { legal_entity: 'Acme LLC' },
    });
    expect(res.status()).toBe(422);
    const detail = (await res.json()).detail as string;
    expect(detail).toContain('name');
    expect(detail).toContain('industry');
  });

  test('[GET /companies/{id}] rejects an invalid UUID path parameter with 422, not 404', async () => {
    const res = await tenantA.request.get(`${API_BASE_URL}/api/v1/companies/not-a-uuid`, {
      headers: authHeaders(tenantA),
    });
    expect(res.status(), 'Path validation should reject malformed UUIDs before any lookup happens').toBe(422);
  });

  test('[PATCH /companies/{id}] rejects an empty PATCH body with 400 "No fields to update"', async () => {
    const created = await createCompany(tenantA);
    expect(created.status()).toBe(201);
    const companyId = (await created.json()).id;

    const res = await tenantA.request.patch(`${API_BASE_URL}/api/v1/companies/${companyId}`, {
      headers: authHeaders(tenantA),
      data: {},
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).detail).toContain('No fields to update');
  });

  test('[GET /companies] rejects a missing x-tenant-id header entirely with 400', async ({ request }) => {
    const res = await request.get(`${API_BASE_URL}/api/v1/companies`);
    expect(res.status()).toBe(400);
    expect((await res.json()).detail).toContain('tenant');
  });
});

// ── Applications / Processes / Integrations ─────────────────────────────────

test.describe('Applications — payload format', () => {
  test('[POST /applications] rejects an unknown field with 422', async () => {
    const res = await tenantA.request.post(`${API_BASE_URL}/api/v1/applications`, {
      headers: authHeaders(tenantA),
      data: { application_name: 'x', not_a_real_field: 'boom' },
    });
    expect(res.status()).toBe(422);
    expect((await res.json()).detail).toContain('not_a_real_field');
  });

  test('[POST /applications] rejects a wrongly-typed field (tags as a string, not a list) with 422', async () => {
    const res = await tenantA.request.post(`${API_BASE_URL}/api/v1/applications`, {
      headers: authHeaders(tenantA),
      data: { application_name: 'x', tags: 'should-be-a-list' },
    });
    expect(res.status()).toBe(422);
  });

  test('[POST /applications] accepts a fully empty body — every Application field is optional by contract', async () => {
    const res = await tenantA.request.post(`${API_BASE_URL}/api/v1/applications`, {
      headers: authHeaders(tenantA),
      data: {},
    });
    expect(res.status(), 'Application/ApplicationCreate declares every field Optional, so an empty body must be accepted').toBe(201);

    // Has no application_name, so global-teardown.ts's "UAT "-prefix match
    // can't find it — clean it up directly since we already have the id.
    const id = (await res.json()).business_application_id;
    await deleteEntity(tenantA, 'applications', id);
  });
});

test.describe('Processes — payload format', () => {
  test('[PATCH /processes/{id}] rejects an empty PATCH body with 400 "No editable fields provided for update"', async () => {
    const created = await createEntity(tenantA, 'processes');
    expect(created.status()).toBe(201);
    const processId = (await created.json()).business_process_id;

    const res = await tenantA.request.patch(`${API_BASE_URL}/api/v1/processes/${processId}`, {
      headers: authHeaders(tenantA),
      data: {},
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).detail).toContain('No editable fields provided for update');
  });

  test('[POST /processes] rejects an unknown field on create with 422', async () => {
    const res = await tenantA.request.post(`${API_BASE_URL}/api/v1/processes`, {
      headers: authHeaders(tenantA),
      data: { process_name: 'x', not_a_real_field: 'boom' },
    });
    expect(res.status()).toBe(422);
  });
});

// ── Agents ───────────────────────────────────────────────────────────────────

test.describe('Agents — payload format', () => {
  test('[POST /agents] rejects an empty agent_name with 422 (min_length=1)', async () => {
    const res = await tenantA.request.post(`${API_BASE_URL}/api/v1/agents`, {
      headers: authHeaders(tenantA),
      data: { agent_name: '', description: 'x', instruction: '' },
    });
    expect(res.status()).toBe(422);
    expect((await res.json()).detail).toContain('agent_name');
  });

  test('[POST /agents] rejects a create request missing the required instruction field with 422', async () => {
    const res = await tenantA.request.post(`${API_BASE_URL}/api/v1/agents`, {
      headers: authHeaders(tenantA),
      data: { agent_name: 'x', description: 'x' },
    });
    expect(res.status()).toBe(422);
    expect((await res.json()).detail).toContain('instruction');
  });

  test('[POST /agents] accepts an empty string for instruction — only agent_name/description enforce min_length', async () => {
    const res = await tenantA.request.post(`${API_BASE_URL}/api/v1/agents`, {
      headers: authHeaders(tenantA),
      data: { agent_name: `UAT agent payload-check ${Date.now()}`, description: 'x', instruction: '' },
    });
    expect(res.status(), `Expected 201. Body: ${await res.text()}`).toBe(201);
    const agentId = (await res.json()).agent_id;
    await tenantA.request.delete(`${API_BASE_URL}/api/v1/agents/${agentId}`, { headers: authHeaders(tenantA) });
  });
});

// ── AI Models ────────────────────────────────────────────────────────────────

test.describe('AI Models — payload format', () => {
  test('[POST /ai-models] rejects an unknown field with 422', async () => {
    const res = await tenantA.request.post(`${API_BASE_URL}/api/v1/ai-models`, {
      headers: authHeaders(tenantA),
      data: { not_a_real_field: 'boom' },
    });
    expect(res.status()).toBe(422);
    expect((await res.json()).detail).toContain('not_a_real_field');
  });

  test('[POST /ai-models] accepts a fully empty body — every AI Model field is optional by contract', async () => {
    const res = await tenantA.request.post(`${API_BASE_URL}/api/v1/ai-models`, {
      headers: authHeaders(tenantA),
      data: {},
    });
    expect(res.status(), `Expected 201. Body: ${await res.text()}`).toBe(201);
    // No model_name, so global-teardown.ts's "UAT "-prefix match can't find
    // it — clean it up directly since we already have the id.
    const id = (await res.json()).ai_model_id;
    await tenantA.request.delete(`${API_BASE_URL}/api/v1/ai-models/${id}`, { headers: authHeaders(tenantA) });
  });
});

// ── AI Use Cases ─────────────────────────────────────────────────────────────

test.describe('AI Use Cases — payload format', () => {
  test('[POST/GET /use-cases] accepts an unrecognized priority value verbatim instead of rejecting it', async () => {
    const res = await tenantA.request.post(`${API_BASE_URL}/api/v1/use-cases`, {
      headers: authHeaders(tenantA),
      data: {
        title: `UAT garbage-priority ${Date.now()}`,
        description: 'x',
        business_problem_statement: 'x',
        expected_benefits: 'x',
        priority: 'not-a-real-priority-value',
      },
    });
    expect(res.status(), `Expected 201 (current lenient behavior). Body: ${await res.text()}`).toBe(201);
    const body = await res.json();

    const got = await tenantA.request.get(`${API_BASE_URL}/api/v1/use-cases/${body.use_case_id}`, { headers: authHeaders(tenantA) });
    const storedPriority = (await got.json()).data[0].priority;
    expect(storedPriority, 'Garbage priority values are stored verbatim, not normalized or rejected').toBe('not-a-real-priority-value');

    await deleteUseCase(tenantA, body.use_case_id);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 3. BUSINESS LOGIC
// ═════════════════════════════════════════════════════════════════════════

test.describe('Processes — parent_process_id business rules', () => {
  let processId: string;

  test.beforeAll(async () => {
    const created = await createEntity(tenantA, 'processes');
    expect(created.status()).toBe(201);
    processId = (await created.json()).business_process_id;
  });

  test('[PATCH /processes/{id}] a process cannot be set as its own parent', async () => {
    const res = await updateEntity(tenantA, 'processes', processId, { parent_process_id: processId });
    expect(res.status()).toBe(400);
    expect((await res.json()).detail).toContain('cannot reference itself');
  });

  test("[PATCH /processes/{id}] setting parent_process_id to a process that doesn't exist is rejected", async () => {
    const res = await updateEntity(tenantA, 'processes', processId, { parent_process_id: '00000000000000000000000000000000' });
    expect(res.status()).toBe(400);
    expect((await res.json()).detail).toContain('does not exist');
  });

  test('[PATCH/GET /processes/{id}] a valid parent_process_id is accepted and reflected back on read', async () => {
    const parent = await createEntity(tenantA, 'processes');
    expect(parent.status()).toBe(201);
    const parentId = (await parent.json()).business_process_id;

    const res = await updateEntity(tenantA, 'processes', processId, { parent_process_id: parentId });
    expect(res.status()).toBe(200);
    expect((await res.json()).parent_process_id).toBe(parentId);

    const got = await getEntity(tenantA, 'processes', processId);
    expect((await got.json()).parent_process_id).toBe(parentId);
  });
});

test.describe('Application <-> Process linking', () => {
  test('[POST/DELETE /processes/{id}/applications] linking an application to a process makes it appear in related_applications; unlinking removes it', async () => {
    const processRes = await createEntity(tenantA, 'processes');
    expect(processRes.status()).toBe(201);
    const processId = (await processRes.json()).business_process_id;

    const appRes = await createEntity(tenantA, 'applications');
    expect(appRes.status()).toBe(201);
    const applicationId = (await appRes.json()).business_application_id;

    const linkRes = await linkApplicationToProcess(tenantA, processId, applicationId);
    expect(linkRes.status(), `Expected 200 linking. Body: ${await linkRes.text()}`).toBe(200);

    const afterLink = await getEntity(tenantA, 'processes', processId);
    expect(afterLink.status()).toBe(200);
    const linkedIds = (await afterLink.json()).related_applications.map((a: any) => a.business_application_id);
    expect(linkedIds, 'Linked application must appear in the process\'s related_applications').toContain(applicationId);

    const unlinkRes = await unlinkApplicationFromProcess(tenantA, processId, applicationId);
    expect(unlinkRes.status()).toBe(200);
    expect((await unlinkRes.json()).rows_deleted).toBeGreaterThan(0);

    const afterUnlink = await getEntity(tenantA, 'processes', processId);
    const remainingIds = (await afterUnlink.json()).related_applications.map((a: any) => a.business_application_id);
    expect(remainingIds, 'Unlinked application must be removed from related_applications').not.toContain(applicationId);
  });

  test('[POST /processes/{id}/applications] linking a non-existent application to a real process returns 404', async () => {
    const processRes = await createEntity(tenantA, 'processes');
    const processId = (await processRes.json()).business_process_id;

    const res = await linkApplicationToProcess(tenantA, processId, '00000000000000000000000000000000');
    expect(res.status()).toBe(404);
  });

  test('[POST /processes/{id}/applications] linking a real application to a non-existent process returns 404', async () => {
    const appRes = await createEntity(tenantA, 'applications');
    const applicationId = (await appRes.json()).business_application_id;

    const res = await linkApplicationToProcess(tenantA, '00000000000000000000000000000000', applicationId);
    expect(res.status()).toBe(404);
  });

  test('[DELETE /processes/{id}/applications/{id}] unlinking a pair that was never linked is idempotent — 200 with rows_deleted: 0, not 404', async () => {
    const processRes = await createEntity(tenantA, 'processes');
    const processId = (await processRes.json()).business_process_id;
    const appRes = await createEntity(tenantA, 'applications');
    const applicationId = (await appRes.json()).business_application_id;

    const res = await unlinkApplicationFromProcess(tenantA, processId, applicationId);
    expect(res.status()).toBe(200);
    expect((await res.json()).rows_deleted).toBe(0);
  });
});

// ── Agent <-> Use Case linking ───────────────────────────────────────────────
//
// use_cases.py's link/unlink pair is deliberately idempotent in BOTH
// directions: re-linking an already-linked pair returns 200 "Relationship
// already exists" (not 409), and unlinking a pair that was never linked
// returns 200 "Relationship not found" (not 404). Contrast with AI Models
// below, whose unlink returns a real 404 for the same "nothing to remove"
// case — the two routers made different, inconsistent design choices for
// what should be the same kind of operation.

test.describe('Agent <-> Use Case linking', () => {
  test('[POST /use-cases/{id}/agents] linking is idempotent: re-linking the same pair does not error or duplicate', async () => {
    const agentRes = await createAgent(tenantA);
    const agentId = (await agentRes.json()).agent_id;
    const ucRes = await createUseCase(tenantA);
    const useCaseId = (await ucRes.json()).use_case_id;

    const first = await linkAgentToUseCase(tenantA, useCaseId, agentId);
    expect(first.status()).toBe(200);
    expect((await first.json()).associated_count).toBe(1);

    const second = await linkAgentToUseCase(tenantA, useCaseId, agentId);
    expect(second.status(), 'Re-linking an already-linked pair should not error').toBe(200);
    expect((await second.json()).associated_count, 'associated_count must not double-count a duplicate link').toBe(1);

    await deleteAgent(tenantA, agentId);
    await deleteUseCase(tenantA, useCaseId);
  });

  test('[DELETE /use-cases/{id}/agents/{id}] unlinking a pair that was never linked is idempotent — 200 "Relationship not found", not 404', async () => {
    const agentRes = await createAgent(tenantA);
    const agentId = (await agentRes.json()).agent_id;
    const ucRes = await createUseCase(tenantA);
    const useCaseId = (await ucRes.json()).use_case_id;

    const res = await unlinkAgentFromUseCase(tenantA, useCaseId, agentId);
    expect(res.status()).toBe(200);
    expect((await res.json()).associated_count).toBe(0);

    await deleteAgent(tenantA, agentId);
    await deleteUseCase(tenantA, useCaseId);
  });
});

// ── Agent <-> AI Model linking ───────────────────────────────────────────────

test.describe('Agent <-> AI Model linking', () => {
  test('[POST/DELETE /ai-models/{id}/agents/{id}] linking then unlinking removes the association', async () => {
    const agentRes = await createAgent(tenantA);
    const agentId = (await agentRes.json()).agent_id;
    const modelRes = await createAiModel(tenantA);
    const modelId = (await modelRes.json()).ai_model_id;

    const linked = await linkAgentToAiModel(tenantA, modelId, agentId);
    expect(linked.status(), `Expected 200 linking. Body: ${await linked.text()}`).toBe(200);

    const unlinked = await unlinkAgentFromAiModel(tenantA, modelId, agentId);
    expect(unlinked.status()).toBe(200);
    expect((await unlinked.json()).rows_deleted).toBe(1);

    await deleteAgent(tenantA, agentId);
    await deleteAiModel(tenantA, modelId);
  });

  test('[DELETE /ai-models/{id}/agents/{id}] unlinking a pair that was never linked returns 404 — unlike the use-case unlink above, this router treats it as an error', async () => {
    const agentRes = await createAgent(tenantA);
    const agentId = (await agentRes.json()).agent_id;
    const modelRes = await createAiModel(tenantA);
    const modelId = (await modelRes.json()).ai_model_id;

    const res = await unlinkAgentFromAiModel(tenantA, modelId, agentId);
    expect(res.status(), 'ai_models.py\'s unlink_agent raises 404 when rowcount is 0').toBe(404);

    await deleteAgent(tenantA, agentId);
    await deleteAiModel(tenantA, modelId);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 4. MCP TOOL SURFACE
// ═════════════════════════════════════════════════════════════════════════
//
// mcp_server/server.py exposes a separate JSON-RPC "streamable-http" MCP
// endpoint (POST /zitadel/mcp) that AI agents/chat clients call — a
// genuinely different code path from tavro_api's REST routes tested above.
// Its ~46 tools call a class called AgentMetadataExporter directly (not
// tavro_api's routers, for most resources) and derive tenant_id from the
// caller's real ZITADEL access token, verified either via signed-JWT check
// or a live ZITADEL userinfo round-trip (mcp_server/zitadel_provider.py) —
// there is no equivalent of tavro_api's "trust whatever x-tenant-id header
// shows up" gap here; a fabricated token cannot get through.
//
// Company tools proxy straight through to tavro_api's own REST routes
// (confirmed by reading AgentMetadataExporter.create_company/get_company/
// update_company, which just do requests.post/get/patch against tavro_api),
// so they inherit whatever isolation REST already has — these tests exist
// to confirm the MCP "front door" doesn't introduce a NEW gap for company
// data, not to re-litigate REST's own behavior.
//
// Agent tools have their own SQL in AgentMetadataExporter.get_agent_card
// (tavro_library/agent_library.py) with a real, but not currently
// reproducible-in-this-suite, tenant-scoping gap: if a caller's token
// doesn't resolve to any tenant_id at all (no recognized ZITADEL org claim),
// the tenant WHERE clause is dropped entirely rather than treated as
// "no access" — every tenant's agents become visible. Both of this suite's
// provisioned tenant users have a resolvable tenant_id (confirmed live), so
// that specific gap isn't exercised by the tests below; it's noted here as
// a known architectural risk for anyone extending this coverage with a
// ZITADEL identity that has no org membership.

test.describe('MCP tools — Companies — tenant isolation', () => {
  let companyId: string;

  test.beforeAll(async () => {
    const res = await callMcpTool(mcpA, 'create_company', {
      name: `UAT mcp company ${Date.now()}`,
      industry: 'Technology',
      region: 'US',
      legal_entity: 'N/A',
    });
    expect(res.isError || !!res.data?.error, `create_company failed: ${JSON.stringify(res.data)}`).toBe(false);
    companyId = res.data.company_id;
    expect(companyId, 'create_company must return a company_id').toBeTruthy();
  });

  test('[MCP: list_companies, get_company] the owning tenant can list and get the company it created via MCP', async () => {
    const listRes = await callMcpTool(mcpA, 'list_companies', {});
    expect(listRes.isError).toBe(false);
    const ids = listRes.data.items.map((c: any) => c.id);
    expect(ids, "Tenant A's MCP company list must include the company it just created").toContain(companyId);

    const getRes = await callMcpTool(mcpA, 'get_company', { company_id: companyId });
    expect(getRes.isError).toBe(false);
    expect(getRes.data.company_id).toBe(companyId);
  });

  test('[MCP: list_companies] a different tenant does not see the company in its MCP company list', async () => {
    const listRes = await callMcpTool(mcpB, 'list_companies', {});
    expect(listRes.isError).toBe(false);
    const ids = listRes.data.items.map((c: any) => c.id);
    expect(ids, "Tenant B's MCP company list must not include Tenant A's company").not.toContain(companyId);
  });

  test('[MCP: get_company] a different tenant cannot fetch the company by id through MCP', async () => {
    const res = await callMcpTool(mcpB, 'get_company', { company_id: companyId });
    // The MCP call itself succeeds (isError: false at the protocol level) —
    // AgentMetadataExporter.get_company proxies to tavro_api, catches the
    // resulting 404, and reports it as a tool-level business error instead
    // of raising, so the JSON-RPC envelope looks "successful" even though
    // access was correctly denied.
    expect(res.isError).toBe(false);
    expect(res.data.error, `Expected a VALIDATION_ERROR wrapping a 404. Got: ${JSON.stringify(res.data)}`).toBe('VALIDATION_ERROR');
    expect(res.data.details).toContain('404');
  });
});

test.describe('MCP tools — Agents — tenant isolation', () => {
  let agentId: string;
  let agentName: string;
  let companyId: string;

  test.beforeAll(async () => {
    const companyRes = await callMcpTool(mcpA, 'create_company', {
      name: `UAT mcp agent-test co ${Date.now()}`,
      industry: 'Technology',
      region: 'US',
      legal_entity: 'N/A',
    });
    expect(companyRes.isError || !!companyRes.data?.error, `create_company failed: ${JSON.stringify(companyRes.data)}`).toBe(false);
    companyId = companyRes.data.company_id;

    agentName = `UAT mcp agent ${Date.now()}`;
    const agentRes = await callMcpTool(mcpA, 'create_agent', {
      agent_name: agentName,
      description: 'UAT test agent created via MCP',
      // Unlike REST (tested in "Agents — payload format" above, which
      // accepts an empty instruction), this MCP tool does a truthy check
      // internally and rejects "" with "agent_name, description,
      // instruction are required" — so a non-empty value is required here.
      instruction: 'UAT test instruction',
      company_id: companyId,
    });
    expect(
      agentRes.isError || !!agentRes.data?.error,
      `create_agent failed: ${JSON.stringify(agentRes.data)}`,
    ).toBe(false);
    agentId = agentRes.data.agent_id;
    expect(agentId).toBeTruthy();
  });

  test('[MCP: get_agent_catalog] the owning tenant sees the agent it created via MCP in its own catalog', async () => {
    const res = await callMcpTool(mcpA, 'get_agent_catalog', {
      start_record: 1,
      record_range: '1-500',
      company_id: companyId,
    });
    expect(res.isError).toBe(false);
    const names = res.data.data.map((a: any) => a.agent_name);
    expect(names, "Tenant A's MCP agent catalog must include the agent it just created").toContain(agentName);
  });

  test('[MCP: get_agent_catalog] a different tenant does not see the agent in its MCP agent catalog', async () => {
    const res = await callMcpTool(mcpB, 'get_agent_catalog', {
      start_record: 1,
      record_range: '1-500',
      company_id: companyId, // AgentMetadataExporter scopes by the caller's own token-derived tenant_id regardless of this value
    });
    expect(res.isError).toBe(false);
    const names = res.data.data.map((a: any) => a.agent_name);
    expect(names, "Tenant B's MCP agent catalog must not include Tenant A's agent").not.toContain(agentName);
  });
});

// ── MCP tools — Applications / Processes / Integrations / AI Use Cases ─────
//
// Same pattern as Companies/Agents above: these proxy straight through to
// tavro_api's own REST routes, so the "get" tools' cross-tenant errors come
// back as a business-level {"error": ..., "details": "...404..."} payload
// rather than a protocol-level failure — hence checking res.data.error /
// res.data.details rather than res.isError.

test.describe('MCP tools — Applications — tenant isolation', () => {
  let companyId: string;
  let applicationId: string;
  let applicationName: string;

  test.beforeAll(async () => {
    const companyRes = await callMcpTool(mcpA, 'create_company', {
      name: `UAT mcp app-test co ${Date.now()}`,
      industry: 'Technology',
      region: 'US',
      legal_entity: 'N/A',
    });
    expect(companyRes.isError || !!companyRes.data?.error, `create_company failed: ${JSON.stringify(companyRes.data)}`).toBe(false);
    companyId = companyRes.data.company_id;

    applicationName = `UAT mcp application ${Date.now()}`;
    const appRes = await callMcpTool(mcpA, 'create_application', { application_name: applicationName, company_id: companyId });
    expect(appRes.isError || !!appRes.data?.error, `create_application failed: ${JSON.stringify(appRes.data)}`).toBe(false);
    applicationId = appRes.data.business_application_id;
    expect(applicationId).toBeTruthy();
  });

  test('[MCP: get_application_catalog, get_application] the owning tenant sees the application it created via MCP', async () => {
    const catalogRes = await callMcpTool(mcpA, 'get_application_catalog', { company_id: companyId });
    expect(catalogRes.isError).toBe(false);
    const names = catalogRes.data.data.map((a: any) => a.application_name);
    expect(names, "Tenant A's MCP application catalog must include the application it just created").toContain(applicationName);

    const getRes = await callMcpTool(mcpA, 'get_application', { application_id: applicationId, company_id: companyId });
    expect(getRes.isError).toBe(false);
    expect(getRes.data.application_name).toBe(applicationName);
  });

  test('[MCP: get_application_catalog] a different tenant does not see the application in its MCP application catalog', async () => {
    const res = await callMcpTool(mcpB, 'get_application_catalog', { company_id: companyId });
    expect(res.isError).toBe(false);
    const names = res.data.data.map((a: any) => a.application_name);
    expect(names, "Tenant B's MCP application catalog must not include Tenant A's application").not.toContain(applicationName);
  });

  test('[MCP: get_application] a different tenant cannot fetch the application by id through MCP', async () => {
    const res = await callMcpTool(mcpB, 'get_application', { application_id: applicationId, company_id: companyId });
    expect(res.isError).toBe(false);
    expect(res.data.error, `Expected an error wrapping a 404. Got: ${JSON.stringify(res.data)}`).toBeTruthy();
    expect(res.data.details).toContain('404');
  });
});

test.describe('MCP tools — Processes — tenant isolation', () => {
  let companyId: string;
  let processId: string;
  let processName: string;

  test.beforeAll(async () => {
    const companyRes = await callMcpTool(mcpA, 'create_company', {
      name: `UAT mcp process-test co ${Date.now()}`,
      industry: 'Technology',
      region: 'US',
      legal_entity: 'N/A',
    });
    expect(companyRes.isError || !!companyRes.data?.error, `create_company failed: ${JSON.stringify(companyRes.data)}`).toBe(false);
    companyId = companyRes.data.company_id;

    processName = `UAT mcp process ${Date.now()}`;
    const processRes = await callMcpTool(mcpA, 'create_process', { process_name: processName, company_id: companyId });
    expect(processRes.isError || !!processRes.data?.error, `create_process failed: ${JSON.stringify(processRes.data)}`).toBe(false);
    processId = processRes.data.business_process_id;
    expect(processId).toBeTruthy();
  });

  test('[MCP: get_process_catalog, get_process] the owning tenant sees the process it created via MCP', async () => {
    const catalogRes = await callMcpTool(mcpA, 'get_process_catalog', { company_id: companyId });
    expect(catalogRes.isError).toBe(false);
    const names = catalogRes.data.data.map((p: any) => p.process_name);
    expect(names, "Tenant A's MCP process catalog must include the process it just created").toContain(processName);

    const getRes = await callMcpTool(mcpA, 'get_process', { process_id: processId, company_id: companyId });
    expect(getRes.isError).toBe(false);
    expect(getRes.data.process_name).toBe(processName);
  });

  test('[MCP: get_process_catalog] a different tenant does not see the process in its MCP process catalog', async () => {
    const res = await callMcpTool(mcpB, 'get_process_catalog', { company_id: companyId });
    expect(res.isError).toBe(false);
    const names = res.data.data.map((p: any) => p.process_name);
    expect(names, "Tenant B's MCP process catalog must not include Tenant A's process").not.toContain(processName);
  });

  test('[MCP: get_process] a different tenant cannot fetch the process by id through MCP', async () => {
    const res = await callMcpTool(mcpB, 'get_process', { process_id: processId, company_id: companyId });
    expect(res.isError).toBe(false);
    expect(res.data.error, `Expected an error wrapping a 404. Got: ${JSON.stringify(res.data)}`).toBeTruthy();
    expect(res.data.details).toContain('404');
  });
});

test.describe('MCP tools — Integrations — tenant isolation', () => {
  let companyId: string;
  let integrationId: string;
  let integrationName: string;

  test.beforeAll(async () => {
    const companyRes = await callMcpTool(mcpA, 'create_company', {
      name: `UAT mcp integration-test co ${Date.now()}`,
      industry: 'Technology',
      region: 'US',
      legal_entity: 'N/A',
    });
    expect(companyRes.isError || !!companyRes.data?.error, `create_company failed: ${JSON.stringify(companyRes.data)}`).toBe(false);
    companyId = companyRes.data.company_id;

    integrationName = `UAT mcp integration ${Date.now()}`;
    const integrationRes = await callMcpTool(mcpA, 'create_integration', { integration_name: integrationName, company_id: companyId });
    expect(integrationRes.isError || !!integrationRes.data?.error, `create_integration failed: ${JSON.stringify(integrationRes.data)}`).toBe(false);
    integrationId = integrationRes.data.integration_id;
    expect(integrationId).toBeTruthy();
  });

  test('[MCP: list_integrations, get_integration] the owning tenant sees the integration it created via MCP', async () => {
    const listRes = await callMcpTool(mcpA, 'list_integrations', { company_id: companyId });
    expect(listRes.isError).toBe(false);
    const names = listRes.data.items.map((i: any) => i.integration_name);
    expect(names, "Tenant A's MCP integration list must include the integration it just created").toContain(integrationName);

    const getRes = await callMcpTool(mcpA, 'get_integration', { integration_id: integrationId, company_id: companyId });
    expect(getRes.isError).toBe(false);
    expect(getRes.data.integration_name).toBe(integrationName);
  });

  test('[MCP: list_integrations] a different tenant does not see the integration in its MCP integration list', async () => {
    const res = await callMcpTool(mcpB, 'list_integrations', { company_id: companyId });
    expect(res.isError).toBe(false);
    const names = res.data.items.map((i: any) => i.integration_name);
    expect(names, "Tenant B's MCP integration list must not include Tenant A's integration").not.toContain(integrationName);
  });

  test('[MCP: get_integration] a different tenant cannot fetch the integration by id through MCP', async () => {
    const res = await callMcpTool(mcpB, 'get_integration', { integration_id: integrationId, company_id: companyId });
    expect(res.isError).toBe(false);
    expect(res.data.error, `Expected an error wrapping a 404. Got: ${JSON.stringify(res.data)}`).toBeTruthy();
    expect(res.data.details).toContain('404');
  });
});

test.describe('MCP tools — AI Use Cases — tenant isolation', () => {
  let companyId: string;
  let useCaseId: string;
  let useCaseTitle: string;

  test.beforeAll(async () => {
    const companyRes = await callMcpTool(mcpA, 'create_company', {
      name: `UAT mcp usecase-test co ${Date.now()}`,
      industry: 'Technology',
      region: 'US',
      legal_entity: 'N/A',
    });
    expect(companyRes.isError || !!companyRes.data?.error, `create_company failed: ${JSON.stringify(companyRes.data)}`).toBe(false);
    companyId = companyRes.data.company_id;

    useCaseTitle = `UAT mcp use case ${Date.now()}`;
    const ucRes = await callMcpTool(mcpA, 'create_ai_use_case', {
      title: useCaseTitle,
      description: 'UAT test use case created via MCP',
      business_problem_statement: 'x',
      expected_benefits: 'x',
      priority: '3',
      company_id: companyId,
    });
    expect(ucRes.isError || !!ucRes.data?.error, `create_ai_use_case failed: ${JSON.stringify(ucRes.data)}`).toBe(false);
    useCaseId = ucRes.data.use_case_id;
    expect(useCaseId).toBeTruthy();
  });

  test('[MCP: get_ai_use_case] the owning tenant sees the use case it created via MCP', async () => {
    const catalogRes = await callMcpTool(mcpA, 'get_ai_use_case', { company_id: companyId });
    expect(catalogRes.isError).toBe(false);
    const names = catalogRes.data.data.map((u: any) => u.name);
    expect(names, "Tenant A's MCP use case catalog must include the use case it just created").toContain(useCaseTitle);
  });

  test('[MCP: get_ai_use_case] a different tenant does not see the use case in its MCP use case catalog', async () => {
    const res = await callMcpTool(mcpB, 'get_ai_use_case', { company_id: companyId });
    expect(res.isError).toBe(false);
    const names = res.data.data.map((u: any) => u.name);
    expect(names, "Tenant B's MCP use case catalog must not include Tenant A's use case").not.toContain(useCaseTitle);
  });

  test('[MCP: get_ai_use_case] a different tenant cannot fetch the use case by id through MCP', async () => {
    const res = await callMcpTool(mcpB, 'get_ai_use_case', { use_case_id: useCaseId, company_id: companyId });
    expect(res.isError).toBe(false);
    expect(res.data.error, `Expected an error wrapping a 404. Got: ${JSON.stringify(res.data)}`).toBeTruthy();
    expect(res.data.details).toContain('404');
  });
});

// ── Companies — duplicate creation (runs LAST — see comment) ───────────────
//
// twin.company has a UNIQUE index on (lower(name), lower(region), tenant_id)
// (sql/tavro_setup_all.sql). Running this earlier in a prior run left the
// SQLAlchemy async connection pool in a state where several unrelated
// subsequent requests (verified via `docker logs tavro-api`) also failed —
// so it's placed last in the file so its blast radius can't affect any
// other test's result.
test.describe('Companies — duplicate creation (run last, see comment above)', () => {
  test('[POST /companies] creating a duplicate company (same name+region within a tenant) is rejected with 409 Conflict', async () => {
    const name = `UAT dup-check ${Date.now()}`;
    const first = await createCompany(tenantA, { name, industry: 'Technology', region: 'US' });
    expect(first.status()).toBe(201);

    const second = await createCompany(tenantA, { name, industry: 'Technology', region: 'US' });
    expect(second.status(), 'Duplicate company creation must return 409 Conflict').toBe(409);
  });
});
