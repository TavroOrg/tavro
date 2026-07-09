import type { APIResponse, Browser, BrowserContext, Page, APIRequestContext } from '@playwright/test';
import { randomUUID } from 'crypto';

const API_BASE_URL = process.env.E2E_API_URL || 'http://localhost:8000';
const APP_BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:9000';

// ── Tenant session ───────────────────────────────────────────────────────────
//
// A real, authenticated ZITADEL session for one of the provisioned UAT
// tenants (see tests/setup/global-setup.ts + tests/setup/auth.setup.ts).
// `token`/`tenantId` are read from the same localStorage keys tavro_app
// itself uses (tavro_access_token / tavro_tenant_id), so every request made
// with this session is indistinguishable from a real logged-in user.

export type TenantSession = {
  context: BrowserContext;
  page: Page;
  request: APIRequestContext;
  token: string;
  tenantId: string;
};

export async function openTenantSession(browser: Browser, storageStatePath: string): Promise<TenantSession> {
  const context = await browser.newContext({ storageState: storageStatePath });
  const page = await context.newPage();
  await page.goto(APP_BASE_URL);

  const token = await page.evaluate(() => localStorage.getItem('tavro_access_token'));
  const tenantId = await page.evaluate(() => localStorage.getItem('tavro_tenant_id'));
  if (!token || !tenantId) {
    throw new Error(
      `Saved session at ${storageStatePath} has no stored access token / tenant id. ` +
      'Re-run the auth.setup.ts setup project.',
    );
  }

  return { context, page, request: page.request, token, tenantId };
}

export function authHeaders(session: TenantSession, extra: Record<string, string> = {}): Record<string, string> {
  return {
    Authorization: `Bearer ${session.token}`,
    'x-tenant-id': session.tenantId,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...extra,
  };
}

// ── Companies ───────────────────────────────────────────────────────────────

export async function createCompany(
  session: TenantSession,
  overrides: Partial<{ name: string; industry: string; region: string; legal_entity: string }> = {},
): Promise<APIResponse> {
  return session.request.post(`${API_BASE_URL}/api/v1/companies`, {
    headers: authHeaders(session),
    data: {
      name: overrides.name ?? `UAT Company ${randomUUID()}`,
      industry: overrides.industry ?? 'Technology',
      region: overrides.region ?? 'US',
      legal_entity: overrides.legal_entity ?? null,
    },
  });
}

export function getCompany(session: TenantSession, companyId: string): Promise<APIResponse> {
  return session.request.get(`${API_BASE_URL}/api/v1/companies/${companyId}`, { headers: authHeaders(session) });
}

export function listCompanies(session: TenantSession): Promise<APIResponse> {
  // A generous limit: without it the default page size (50) can cut off a
  // just-created record once a tenant has accumulated enough companies
  // across local test runs, since companies.py orders by name, not
  // creation time. tests/setup/global-teardown.ts cleans up everything this
  // suite creates after each run, but this keeps individual tests robust
  // even if teardown didn't run (e.g. a previous run was killed mid-suite).
  return session.request.get(`${API_BASE_URL}/api/v1/companies`, { headers: authHeaders(session), params: { limit: 1000 } });
}

export function updateCompany(session: TenantSession, companyId: string, data: Record<string, unknown>): Promise<APIResponse> {
  return session.request.patch(`${API_BASE_URL}/api/v1/companies/${companyId}`, { headers: authHeaders(session), data });
}

export function deleteCompany(session: TenantSession, companyId: string): Promise<APIResponse> {
  return session.request.delete(`${API_BASE_URL}/api/v1/companies/${companyId}`, { headers: authHeaders(session) });
}

// ── Business entities (applications / processes / integrations) ────────────
// All three routers in tavro_api/api/routers/business_relations.py share the
// same shape: POST accepts an optional `company_id` query param (omit it and
// the record's company_id stays NULL — the "global record" case), and list
// endpoints accept `company_id` to filter.

export type EntityKind = 'applications' | 'processes' | 'integrations';

const NAME_FIELD: Record<EntityKind, string> = {
  applications: 'application_name',
  processes: 'process_name',
  integrations: 'integration_name',
};

const ID_FIELD: Record<EntityKind, string> = {
  applications: 'business_application_id',
  processes: 'business_process_id',
  integrations: 'integration_id',
};

export function entityIdField(kind: EntityKind): string {
  return ID_FIELD[kind];
}

export async function createEntity(
  session: TenantSession,
  kind: EntityKind,
  opts: { name?: string; companyId?: string } = {},
): Promise<APIResponse> {
  const name = opts.name ?? `UAT ${kind} ${randomUUID()}`;
  return session.request.post(`${API_BASE_URL}/api/v1/${kind}`, {
    headers: authHeaders(session),
    params: opts.companyId ? { company_id: opts.companyId } : undefined,
    data: { [NAME_FIELD[kind]]: name },
  });
}

export function listEntities(session: TenantSession, kind: EntityKind, companyId?: string): Promise<APIResponse> {
  // limit: 500 is the max these routers allow (Query(50, ge=1, le=500)) —
  // see the listCompanies comment above for why a generous limit matters.
  return session.request.get(`${API_BASE_URL}/api/v1/${kind}`, {
    headers: authHeaders(session),
    params: { limit: 500, ...(companyId ? { company_id: companyId } : {}) },
  });
}

export function getEntity(session: TenantSession, kind: EntityKind, id: string): Promise<APIResponse> {
  return session.request.get(`${API_BASE_URL}/api/v1/${kind}/${id}`, { headers: authHeaders(session) });
}

export function deleteEntity(session: TenantSession, kind: EntityKind, id: string): Promise<APIResponse> {
  return session.request.delete(`${API_BASE_URL}/api/v1/${kind}/${id}`, { headers: authHeaders(session) });
}

export function updateEntity(
  session: TenantSession,
  kind: EntityKind,
  id: string,
  data: Record<string, unknown>,
): Promise<APIResponse> {
  return session.request.patch(`${API_BASE_URL}/api/v1/${kind}/${id}`, { headers: authHeaders(session), data });
}

// ── Process <-> Application linking ─────────────────────────────────────────

export function linkApplicationToProcess(
  session: TenantSession,
  processId: string,
  applicationId: string,
): Promise<APIResponse> {
  return session.request.post(`${API_BASE_URL}/api/v1/processes/${processId}/applications`, {
    headers: authHeaders(session),
    data: { business_application_id: applicationId },
  });
}

export function unlinkApplicationFromProcess(
  session: TenantSession,
  processId: string,
  applicationId: string,
): Promise<APIResponse> {
  return session.request.delete(`${API_BASE_URL}/api/v1/processes/${processId}/applications/${applicationId}`, {
    headers: authHeaders(session),
  });
}

// ── Agents ───────────────────────────────────────────────────────────────────
// agents.py is the strictest of the three "rich" resources below: tenant is
// required (400 if x-tenant-id is missing) and list responses are wrapped
// as { data: [...] } with id field agent_id throughout (create/get/list all
// agree, unlike use-cases below).

export async function createAgent(
  session: TenantSession,
  opts: { name?: string; companyId?: string } = {},
): Promise<APIResponse> {
  const name = opts.name ?? `UAT agent ${randomUUID()}`;
  return session.request.post(`${API_BASE_URL}/api/v1/agents`, {
    headers: authHeaders(session),
    params: opts.companyId ? { company_id: opts.companyId } : undefined,
    data: { agent_name: name, description: 'UAT test agent', instruction: '' },
  });
}

export function listAgents(session: TenantSession, companyId?: string): Promise<APIResponse> {
  return session.request.get(`${API_BASE_URL}/api/v1/agents`, {
    headers: authHeaders(session),
    params: { record_range: '1-500', ...(companyId ? { company_id: companyId } : {}) },
  });
}

export function getAgent(session: TenantSession, agentId: string): Promise<APIResponse> {
  return session.request.get(`${API_BASE_URL}/api/v1/agents/${agentId}`, { headers: authHeaders(session) });
}

export function updateAgent(session: TenantSession, agentId: string, data: Record<string, unknown>): Promise<APIResponse> {
  return session.request.put(`${API_BASE_URL}/api/v1/agents/${agentId}`, { headers: authHeaders(session), data });
}

export function deleteAgent(session: TenantSession, agentId: string): Promise<APIResponse> {
  return session.request.delete(`${API_BASE_URL}/api/v1/agents/${agentId}`, { headers: authHeaders(session) });
}

// ── AI Use Cases ─────────────────────────────────────────────────────────────
// use_cases.py does NOT require x-tenant-id (omitting it silently skips
// tenant filtering) and — unlike every other resource tested so far —
// update_use_case/delete_use_case apply NO tenant_id filter at all. Also
// note the id/name field naming is inconsistent between create and
// read: POST returns {use_case_id, message}; GET/list items use
// ai_use_case_id and name (not title).

export async function createUseCase(
  session: TenantSession,
  opts: { title?: string; companyId?: string } = {},
): Promise<APIResponse> {
  const title = opts.title ?? `UAT use-case ${randomUUID()}`;
  return session.request.post(`${API_BASE_URL}/api/v1/use-cases`, {
    headers: authHeaders(session),
    params: opts.companyId ? { company_id: opts.companyId } : undefined,
    data: {
      title,
      description: 'UAT test use case',
      business_problem_statement: 'x',
      expected_benefits: 'x',
      priority: '3',
    },
  });
}

export function listUseCases(session: TenantSession, companyId?: string): Promise<APIResponse> {
  return session.request.get(`${API_BASE_URL}/api/v1/use-cases`, {
    headers: authHeaders(session),
    params: companyId ? { company_id: companyId } : undefined,
  });
}

export function getUseCase(session: TenantSession, useCaseId: string): Promise<APIResponse> {
  return session.request.get(`${API_BASE_URL}/api/v1/use-cases/${useCaseId}`, { headers: authHeaders(session) });
}

export function updateUseCase(session: TenantSession, useCaseId: string, data: Record<string, unknown>): Promise<APIResponse> {
  // PUT replaces the whole record server-side — always send the required
  // fields, letting overrides win, so a partial `data` doesn't 422.
  return session.request.put(`${API_BASE_URL}/api/v1/use-cases/${useCaseId}`, {
    headers: authHeaders(session),
    data: {
      title: 'UAT updated use case',
      description: 'x',
      business_problem_statement: 'x',
      expected_benefits: 'x',
      priority: '3',
      ...data,
    },
  });
}

export function deleteUseCase(session: TenantSession, useCaseId: string): Promise<APIResponse> {
  return session.request.delete(`${API_BASE_URL}/api/v1/use-cases/${useCaseId}`, { headers: authHeaders(session) });
}

export function linkAgentToUseCase(session: TenantSession, useCaseId: string, agentId: string): Promise<APIResponse> {
  return session.request.post(`${API_BASE_URL}/api/v1/use-cases/${useCaseId}/agents`, {
    headers: authHeaders(session),
    data: { agent_id: agentId },
  });
}

export function unlinkAgentFromUseCase(session: TenantSession, useCaseId: string, agentId: string): Promise<APIResponse> {
  return session.request.delete(`${API_BASE_URL}/api/v1/use-cases/${useCaseId}/agents/${agentId}`, {
    headers: authHeaders(session),
  });
}

// ── AI Models ────────────────────────────────────────────────────────────────
// ai_models.py: every field is Optional (empty body is a valid create), but
// unlike agents/use-cases it declares extra="forbid" on AiModelCreate. Like
// use-cases, x-tenant-id is not required, and update_ai_model/delete_ai_model
// apply NO tenant_id filter at all.

export async function createAiModel(
  session: TenantSession,
  opts: { name?: string; companyId?: string } = {},
): Promise<APIResponse> {
  const name = opts.name ?? `UAT ai-model ${randomUUID()}`;
  return session.request.post(`${API_BASE_URL}/api/v1/ai-models`, {
    headers: authHeaders(session),
    params: opts.companyId ? { company_id: opts.companyId } : undefined,
    data: { model_name: name },
  });
}

export function listAiModels(session: TenantSession, companyId?: string): Promise<APIResponse> {
  return session.request.get(`${API_BASE_URL}/api/v1/ai-models`, {
    headers: authHeaders(session),
    params: { limit: 500, ...(companyId ? { company_id: companyId } : {}) },
  });
}

export function getAiModel(session: TenantSession, modelId: string): Promise<APIResponse> {
  return session.request.get(`${API_BASE_URL}/api/v1/ai-models/${modelId}`, { headers: authHeaders(session) });
}

export function updateAiModel(session: TenantSession, modelId: string, data: Record<string, unknown>): Promise<APIResponse> {
  return session.request.put(`${API_BASE_URL}/api/v1/ai-models/${modelId}`, { headers: authHeaders(session), data });
}

export function deleteAiModel(session: TenantSession, modelId: string): Promise<APIResponse> {
  return session.request.delete(`${API_BASE_URL}/api/v1/ai-models/${modelId}`, { headers: authHeaders(session) });
}

export function linkAgentToAiModel(session: TenantSession, modelId: string, agentId: string): Promise<APIResponse> {
  return session.request.post(`${API_BASE_URL}/api/v1/ai-models/${modelId}/agents`, {
    headers: authHeaders(session),
    data: { agent_id: agentId },
  });
}

export function unlinkAgentFromAiModel(session: TenantSession, modelId: string, agentId: string): Promise<APIResponse> {
  return session.request.delete(`${API_BASE_URL}/api/v1/ai-models/${modelId}/agents/${agentId}`, {
    headers: authHeaders(session),
  });
}
