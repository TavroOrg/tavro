import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Provisions two real ZITADEL tenants (orgs + active human users) once
 * before the suite runs, via the ZITADEL Management API — using the same
 * admin PAT the stack already generates for iam/configure-zitadel-app.mjs
 * (a machine user PAT with IAM_OWNER rights, written to a docker volume
 * mounted into the zitadel-configure-app container at
 * /zitadel/bootstrap/admin.pat).
 *
 * Endpoint behavior below was verified by hand against this stack's ZITADEL
 * v4.13 instance before being encoded here:
 *  - POST /management/v1/users/human          leaves the user in
 *    USER_STATE_INITIAL with no usable password (ZITADEL expects an
 *    initialization-code flow, which needs SMTP we don't have locally).
 *  - POST /management/v1/users/human/_import  is the "already verified"
 *    import path — it activates the user immediately with the given
 *    password, no init code required. This is the one we want.
 *  - GET /management/v1/orgs/{id}             404s for real, active orgs on
 *    this ZITADEL version — existence checks go through the v2 API instead
 *    (POST /v2/organizations/_search, GET /v2/users/{id}), which behaves
 *    correctly.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const AUTH_DIR = path.join(__dirname, '../../.auth');
export const TENANTS_FILE = path.join(AUTH_DIR, 'tenants.json');

export type ProvisionedTenant = {
  orgId: string;
  orgName: string;
  userId: string;
  username: string;
  password: string;
};

export type ProvisionedTenants = {
  tenantA: ProvisionedTenant;
  tenantB: ProvisionedTenant;
};

export function authFilePath(tenantKey: keyof ProvisionedTenants): string {
  return path.join(AUTH_DIR, `${tenantKey}.json`);
}

// ── ZITADEL Management API client ───────────────────────────────────────────

const ZITADEL_API_URL = (process.env.ZITADEL_API_URL || 'http://localhost:8080').replace(/\/$/, '');
const BOOTSTRAP_CONTAINER = process.env.ZITADEL_BOOTSTRAP_CONTAINER || 'tavro-zitadel-configure-app-1';

let cachedToken: string | null = null;

function readAdminToken(): string {
  if (cachedToken) return cachedToken;
  const out = execFileSync(
    'docker',
    ['exec', BOOTSTRAP_CONTAINER, 'cat', '/zitadel/bootstrap/admin.pat'],
    { encoding: 'utf8' },
  ).trim();
  if (!out) {
    throw new Error(
      `Could not read ZITADEL admin PAT from container "${BOOTSTRAP_CONTAINER}" at /zitadel/bootstrap/admin.pat. ` +
      'Is the docker compose stack running? Override the container name with ZITADEL_BOOTSTRAP_CONTAINER.',
    );
  }
  cachedToken = out;
  return out;
}

async function mgmt(mgmtPath: string, opts: { method?: string; orgId?: string; body?: unknown } = {}): Promise<any> {
  const token = readAdminToken();
  const res = await fetch(`${ZITADEL_API_URL}${mgmtPath}`, {
    method: opts.method || 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(opts.orgId ? { 'x-zitadel-orgid': opts.orgId } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  return { status: res.status, data };
}

async function orgExists(orgId: string): Promise<boolean> {
  const { status, data } = await mgmt('/v2/organizations/_search', {
    method: 'POST',
    body: { queries: [{ idQuery: { id: orgId } }] },
  });
  if (status !== 200) return false;
  const org = data.result?.[0];
  return !!org && org.state === 'ORGANIZATION_STATE_ACTIVE';
}

async function userExists(orgId: string, userId: string): Promise<boolean> {
  const { status, data } = await mgmt(`/v2/users/${userId}`, { orgId });
  return status === 200 && data.user?.state === 'USER_STATE_ACTIVE';
}

async function createOrg(name: string): Promise<string> {
  const { status, data } = await mgmt('/management/v1/orgs', { method: 'POST', body: { name } });
  if (status !== 200 || !data.id) {
    throw new Error(`Failed to create ZITADEL org "${name}": ${status} ${JSON.stringify(data)}`);
  }
  return data.id as string;
}

async function importActiveHumanUser(
  orgId: string,
  opts: { userName: string; firstName: string; lastName: string; password: string },
): Promise<string> {
  const { status, data } = await mgmt('/management/v1/users/human/_import', {
    method: 'POST',
    orgId,
    body: {
      userName: opts.userName,
      profile: { firstName: opts.firstName, lastName: opts.lastName, displayName: `${opts.firstName} ${opts.lastName}` },
      email: { email: opts.userName, isEmailVerified: true },
      password: opts.password,
      passwordChangeRequired: false,
    },
  });
  if (status !== 200 || !data.userId) {
    throw new Error(`Failed to import ZITADEL human user "${opts.userName}" into org ${orgId}: ${status} ${JSON.stringify(data)}`);
  }
  return data.userId as string;
}

// ── Tenant provisioning ──────────────────────────────────────────────────────

const TENANT_DEFS: Array<{ key: keyof ProvisionedTenants; orgName: string; username: string; firstName: string; lastName: string }> = [
  { key: 'tenantA', orgName: 'Tavro UAT Tenant A', username: 'uat-tenant-a@uat.tavro.local', firstName: 'UAT', lastName: 'TenantA' },
  { key: 'tenantB', orgName: 'Tavro UAT Tenant B', username: 'uat-tenant-b@uat.tavro.local', firstName: 'UAT', lastName: 'TenantB' },
];

// Fixed so re-runs can reuse the same ZITADEL org/user across sessions
// instead of accumulating a new pair every time the suite runs.
const TENANT_PASSWORD = 'UatTenant#2026Secure!';

function loadCache(): Partial<ProvisionedTenants> {
  if (!fs.existsSync(TENANTS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(TENANTS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

async function ensureTenant(
  cached: ProvisionedTenant | undefined,
  def: (typeof TENANT_DEFS)[number],
): Promise<ProvisionedTenant> {
  if (cached) {
    const orgOk = await orgExists(cached.orgId);
    const userOk = orgOk && (await userExists(cached.orgId, cached.userId));
    if (orgOk && userOk) {
      console.log(`[provision] Reusing existing ZITADEL org "${cached.orgName}" (${cached.orgId})`);
      return cached;
    }
  }

  console.log(`[provision] Creating ZITADEL org "${def.orgName}"...`);
  const orgId = await createOrg(def.orgName);
  const userId = await importActiveHumanUser(orgId, {
    userName: def.username,
    firstName: def.firstName,
    lastName: def.lastName,
    password: TENANT_PASSWORD,
  });
  console.log(`[provision] Created org ${orgId} with active user ${userId} (${def.username})`);

  return { orgId, orgName: def.orgName, userId, username: def.username, password: TENANT_PASSWORD };
}

// ── "Bring your own tenants" mode ───────────────────────────────────────────
//
// For environments where auto-provisioning is undesirable or impossible
// (most notably: production — handing this suite an IAM_OWNER-level
// ZITADEL_ADMIN_PAT able to create/delete arbitrary orgs is a lot of blast
// radius for a test script) set these four env vars to the credentials of
// two REAL, DEDICATED, non-customer test accounts you created yourself.
// When set, ZITADEL provisioning is skipped entirely — no admin PAT is
// read, no org is created or touched via the Management API. The suite
// still performs real writes/deletes under these two accounts as part of
// what it verifies (that's the point of the isolation tests), so only
// point this at throwaway accounts, never real customer orgs.
function loadByoTenants(): ProvisionedTenants | null {
  const usernameA = process.env.TENANT_A_USERNAME;
  const passwordA = process.env.TENANT_A_PASSWORD;
  const usernameB = process.env.TENANT_B_USERNAME;
  const passwordB = process.env.TENANT_B_PASSWORD;
  if (!usernameA || !passwordA || !usernameB || !passwordB) return null;

  // orgId/userId aren't read anywhere outside this file's own reuse-check
  // logic (which BYO mode skips), so placeholders are fine here.
  return {
    tenantA: { orgId: 'external', orgName: process.env.TENANT_A_ORG_NAME || 'External Tenant A', userId: 'external', username: usernameA, password: passwordA },
    tenantB: { orgId: 'external', orgName: process.env.TENANT_B_ORG_NAME || 'External Tenant B', userId: 'external', username: usernameB, password: passwordB },
  };
}

export default async function globalSetup(): Promise<void> {
  const byo = loadByoTenants();
  if (byo) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
    fs.writeFileSync(TENANTS_FILE, JSON.stringify(byo, null, 2));
    console.log(`[provision] Using externally-provided tenant credentials (TENANT_A_USERNAME / TENANT_B_USERNAME set) -> ${TENANTS_FILE}`);
    console.log('[provision] No ZITADEL Management API calls made — no org was created, checked, or modified.');
    return;
  }

  const cache = loadCache();
  const result = {} as ProvisionedTenants;

  for (const def of TENANT_DEFS) {
    result[def.key] = await ensureTenant(cache[def.key], def);
  }

  fs.mkdirSync(AUTH_DIR, { recursive: true });
  fs.writeFileSync(TENANTS_FILE, JSON.stringify(result, null, 2));
  console.log(`[provision] Tenant fixtures ready -> ${TENANTS_FILE}`);
}
