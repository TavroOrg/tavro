import { Page } from '@playwright/test';
import { makeTavroTokens } from '../support/fake-jwt';

const FAKE_ZITADEL_CONFIG = {
  zitadelIssuer: 'https://test.zitadel.tavro.ai',
  zitadelClientId: 'demo-client',
  zitadelRedirectPath: '/auth/callback',
  zitadelScope: 'openid profile email',
};

/**
 * Stubs the runtime config fetch so the app resolves its Zitadel settings
 * immediately without hitting the real endpoint. Call this before loginToTavro()
 * in any demo or test that uses fake-JWT auth.
 */
export async function stubRuntimeConfig(page: Page): Promise<void> {
  await page.route('**/runtime/tavro-runtime-config.json', (route) =>
    route.fulfill({ json: FAKE_ZITADEL_CONFIG }),
  );
}

/**
 * Seeds fake Zitadel tokens into localStorage so the app's PrivateRoute
 * treats the session as valid. Works for both tests (via auth.setup.ts)
 * and demo scripts running against a local dev server.
 *
 * For demos against a real backend with real data, generate a persistent
 * storage state once with a real login and pass it via storageState in
 * playwright.demo.config.ts instead of calling this function.
 */
export async function loginToTavro(page: Page): Promise<void> {
  const { accessToken, idToken } = makeTavroTokens();

  // addInitScript runs before any page JavaScript on every navigation.
  // This avoids the race where page.evaluate() would land on the Zitadel
  // redirect URL (cross-origin) and hit a localStorage SecurityError.
  await page.addInitScript(
    ({ accessToken, idToken }) => {
      localStorage.setItem('tavro_auth', 'true');
      localStorage.setItem('tavro_access_token', accessToken);
      localStorage.setItem('tavro_id_token', idToken);
      localStorage.setItem('tavro_raw_access_token', accessToken);
      localStorage.setItem('tavro_oidc_provider', 'zitadel');
      localStorage.setItem('tavro_oidc_issuer', 'https://test.zitadel.tavro.ai');
    },
    { accessToken, idToken },
  );

  await page.goto('/');
}

export async function clearAuth(page: Page): Promise<void> {
  await page.evaluate(() => {
    [
      'tavro_auth',
      'tavro_access_token',
      'tavro_id_token',
      'tavro_raw_access_token',
      'tavro_oidc_provider',
      'tavro_oidc_issuer',
    ].forEach((k) => localStorage.removeItem(k));
  });
}
