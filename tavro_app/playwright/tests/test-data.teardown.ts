/**
 * Deletes every "E2E ..." fixture/test record currently sitting in the
 * backend — Agents, AI Models, Use Cases, Applications, Processes,
 * Integrations, and Company Blueprints — by listing each catalog and
 * matching on name prefix, not by reading a stored list of IDs. There's no
 * ID file to go stale: this always reflects whatever is actually in the
 * database right now, whether it came from this session, a previous one,
 * or a run that was interrupted partway through.
 *
 * Run manually via `npm run test:e2e:cleanup` (playwright.cleanup.config.ts)
 * whenever you want to clear out accumulated test records — deliberately
 * not automatic. Deletion goes straight through the REST API rather than
 * the UI, since deleting isn't part of the UI/UX behavior under test.
 */

import { test as teardown } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = path.join(__dirname, '../.auth/user.json');
const BASE = process.env.E2E_API_URL || process.env.E2E_BASE_URL || 'http://localhost:9000';
const V1 = `${BASE}/api/v1`;
const PREFIX = 'E2E ';

teardown.use({ storageState: AUTH_FILE });

interface Sweep {
  label: string;
  listPath: string;
  itemsKey: 'data' | 'items' | null;
  idField: string;
  nameField: string;
  deletePathFor: (id: string) => string;
}

const SWEEPS: Sweep[] = [
  { label: 'agents', listPath: '/agents/?record_range=1-500', itemsKey: 'data', idField: 'agent_id', nameField: 'agent_name', deletePathFor: (id) => `/agents/${encodeURIComponent(id)}` },
  { label: 'ai models', listPath: '/ai-models/?record_range=1-500', itemsKey: 'items', idField: 'ai_model_id', nameField: 'model_name', deletePathFor: (id) => `/ai-models/${encodeURIComponent(id)}` },
  { label: 'use cases', listPath: '/use-cases/?record_range=1-500', itemsKey: 'data', idField: 'ai_use_case_id', nameField: 'name', deletePathFor: (id) => `/use-cases/${encodeURIComponent(id)}` },
  { label: 'applications', listPath: '/applications?offset=0&limit=500', itemsKey: 'items', idField: 'business_application_id', nameField: 'application_name', deletePathFor: (id) => `/applications/${encodeURIComponent(id)}` },
  { label: 'processes', listPath: '/processes?offset=0&limit=500', itemsKey: 'items', idField: 'business_process_id', nameField: 'process_name', deletePathFor: (id) => `/processes/${encodeURIComponent(id)}` },
  { label: 'integrations', listPath: '/integrations?offset=0&limit=500', itemsKey: 'items', idField: 'integration_id', nameField: 'integration_name', deletePathFor: (id) => `/integrations/${encodeURIComponent(id)}` },
  { label: 'companies (blueprints)', listPath: '/companies?offset=0&limit=500', itemsKey: 'items', idField: 'id', nameField: 'name', deletePathFor: (id) => `/companies/${encodeURIComponent(id)}` },
];

teardown('sweep-delete all E2E-prefixed test records', async ({ page }) => {
  await page.goto('/');

  const token = await page.evaluate(() => localStorage.getItem('tavro_access_token'));
  const tenantId = await page.evaluate(() => localStorage.getItem('tavro_tenant_id'));
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  if (tenantId) headers['x-tenant-id'] = tenantId;

  let totalDeleted = 0;

  for (const sweep of SWEEPS) {
    const res = await page.request.get(`${V1}${sweep.listPath}`, { headers });
    if (!res.ok()) {
      console.warn(`[cleanup] failed to list ${sweep.label}: HTTP ${res.status()}`);
      continue;
    }
    const body = await res.json();
    const items: any[] = Array.isArray(body) ? body : (sweep.itemsKey ? body[sweep.itemsKey] ?? [] : []);
    const matches = items.filter((it) => String(it[sweep.nameField] ?? '').startsWith(PREFIX));

    console.log(`[cleanup] ${sweep.label}: ${matches.length} of ${items.length} match "${PREFIX}"`);
    for (const item of matches) {
      const delRes = await page.request.delete(`${V1}${sweep.deletePathFor(item[sweep.idField])}`, { headers });
      if (delRes.ok() || delRes.status() === 404) {
        totalDeleted++;
      } else {
        console.warn(`[cleanup] failed to delete ${sweep.label} "${item[sweep.nameField]}" (${item[sweep.idField]}): HTTP ${delRes.status()}`);
      }
    }
  }

  console.log(`[cleanup] done — ${totalDeleted} record(s) deleted.`);
});
