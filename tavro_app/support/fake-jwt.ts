/**
 * Generates fake JWTs for Playwright auth setup.
 * Structurally valid (header.payload.signature) but not cryptographically signed.
 * Satisfies the app's auth check (tavro_auth flag + JWT exp claim) without
 * requiring a live Zitadel instance.
 */

function base64url(str: string): string {
  return Buffer.from(str)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

export function makeFakeJwt(payload: Record<string, unknown>): string {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify(payload));
  return `${header}.${body}.playwright-fake-sig`;
}

export function makeTavroTokens(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 3_600;

  const base = {
    sub: 'test-user-playwright',
    iss: 'https://test.zitadel.tavro.ai',
    aud: ['tavro-portal'],
    exp,
    iat: now,
    email: 'playwright@tavro.ai',
    name: 'Playwright Tester',
    given_name: 'Playwright',
    family_name: 'Tester',
    ...overrides,
  };

  return {
    accessToken: makeFakeJwt(base),
    idToken: makeFakeJwt(base),
  };
}
