import fs from 'fs';
import { authFilePath, type ProvisionedTenants } from './global-setup';

/**
 * Deletes everything the suite created for both tenants (every company,
 * application, process and integration whose name starts with "UAT " —
 * the prefix every test helper in tests/utils/tenantClient.ts uses). Runs
 * once after the whole suite finishes so repeated local runs don't pile up
 * hundreds of rows under the same two real ZITADEL-backed tenants, which
 * previously caused list-endpoint pagination (default limit 50) to cut off
 * newly created records and make otherwise-passing tests flaky.
 *
 * Reads tokens directly out of the storageState files auth.setup.ts wrote
 * (plain JSON — cookies + localStorage) so it can run without a browser.
 */

const API_BASE_URL = process.env.E2E_API_URL || 'http://localhost:8000';
const UAT_PREFIX = 'UAT ';

function readSessionFromStorageState(path: string): { token: string; tenantId: string } {
  const state = JSON.parse(fs.readFileSync(path, 'utf8'));
  const localStorage: Array<{ name: string; value: string }> =
    state.origins?.find((o: any) => !o.origin.includes(':8080'))?.localStorage ?? [];
  const get = (key: string) => localStorage.find((e) => e.name === key)?.value;
  const token = get('tavro_access_token');
  const tenantId = get('tavro_tenant_id');
  if (!token || !tenantId) {
    throw new Error(`Could not read tavro_access_token / tavro_tenant_id from ${path}`);
  }
  return { token, tenantId };
}

function headersFor(session: { token: string; tenantId: string }) {
  return {
    Authorization: `Bearer ${session.token}`,
    'x-tenant-id': session.tenantId,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

async function deleteUatCompanies(session: { token: string; tenantId: string }): Promise<number> {
  const res = await fetch(`${API_BASE_URL}/api/v1/companies?limit=1000`, { headers: headersFor(session) });
  if (!res.ok) return 0;
  const { items } = await res.json();
  const targets = items.filter((c: any) => (c.name || '').startsWith(UAT_PREFIX));
  for (const c of targets) {
    await fetch(`${API_BASE_URL}/api/v1/companies/${c.id}`, { method: 'DELETE', headers: headersFor(session) });
  }
  return targets.length;
}

const ENTITY_KINDS = ['applications', 'processes', 'integrations'] as const;
const ID_FIELD: Record<(typeof ENTITY_KINDS)[number], string> = {
  applications: 'business_application_id',
  processes: 'business_process_id',
  integrations: 'integration_id',
};
const NAME_FIELD: Record<(typeof ENTITY_KINDS)[number], string> = {
  applications: 'application_name',
  processes: 'process_name',
  integrations: 'integration_name',
};

async function deleteUatEntities(session: { token: string; tenantId: string }): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const kind of ENTITY_KINDS) {
    // 500 is the max these routers allow (Query(50, ge=1, le=500)) — 1000
    // 422s here, unlike /companies which allows up to 1000.
    const res = await fetch(`${API_BASE_URL}/api/v1/${kind}?limit=500`, { headers: headersFor(session) });
    if (!res.ok) {
      console.warn(`[teardown] GET /${kind} failed with ${res.status}: ${await res.text()}`);
      counts[kind] = 0;
      continue;
    }
    const { items } = await res.json();
    const nameField = NAME_FIELD[kind];
    const idField = ID_FIELD[kind];
    const targets = items.filter((r: any) => (r[nameField] || '').startsWith(UAT_PREFIX));
    for (const r of targets) {
      await fetch(`${API_BASE_URL}/api/v1/${kind}/${r[idField]}`, { method: 'DELETE', headers: headersFor(session) });
    }
    counts[kind] = targets.length;
  }
  return counts;
}

// agents/use-cases/ai-models don't share business_relations.py's uniform
// shape: list responses use different wrapper keys ("data" vs "items") and
// id/name field names differ per resource (and, for use-cases, even between
// the create response and the list/get response — see tenantClient.ts).
type RichKind = 'agents' | 'use-cases' | 'ai-models';
const RICH_LIST_KEY: Record<RichKind, 'items' | 'data'> = {
  agents: 'data',
  'use-cases': 'data',
  'ai-models': 'items',
};
const RICH_ID_FIELD: Record<RichKind, string> = {
  agents: 'agent_id',
  'use-cases': 'ai_use_case_id',
  'ai-models': 'ai_model_id',
};
const RICH_NAME_FIELD: Record<RichKind, string> = {
  agents: 'agent_name',
  'use-cases': 'name',
  'ai-models': 'model_name',
};
const RICH_KINDS: RichKind[] = ['agents', 'use-cases', 'ai-models'];

async function deleteUatRichEntities(session: { token: string; tenantId: string }): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const kind of RICH_KINDS) {
    const res = await fetch(`${API_BASE_URL}/api/v1/${kind}?limit=500`, { headers: headersFor(session) });
    if (!res.ok) {
      console.warn(`[teardown] GET /${kind} failed with ${res.status}: ${await res.text()}`);
      counts[kind] = 0;
      continue;
    }
    const body = await res.json();
    const items: any[] = body[RICH_LIST_KEY[kind]] ?? [];
    const nameField = RICH_NAME_FIELD[kind];
    const idField = RICH_ID_FIELD[kind];
    const targets = items.filter((r) => (r[nameField] || '').startsWith(UAT_PREFIX));
    for (const r of targets) {
      await fetch(`${API_BASE_URL}/api/v1/${kind}/${r[idField]}`, { method: 'DELETE', headers: headersFor(session) });
    }
    counts[kind] = targets.length;
  }
  return counts;
}

export default async function globalTeardown(): Promise<void> {
  for (const key of ['tenantA', 'tenantB'] as (keyof ProvisionedTenants)[]) {
    const path = authFilePath(key);
    if (!fs.existsSync(path)) continue;

    const session = readSessionFromStorageState(path);
    const companiesDeleted = await deleteUatCompanies(session);
    const entityCounts = await deleteUatEntities(session);
    const richCounts = await deleteUatRichEntities(session);
    console.log(
      `[teardown:${key}] Deleted ${companiesDeleted} companies, ` +
      Object.entries({ ...entityCounts, ...richCounts }).map(([k, v]) => `${v} ${k}`).join(', '),
    );
  }
}
