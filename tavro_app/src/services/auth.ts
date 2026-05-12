/**
 * Centralised Zitadel session management.
 *
 * Responsibilities:
 *  - decode access-token JWTs to check expiry without a network call
 *  - silently refresh via the Zitadel token endpoint (requires offline_access scope)
 *  - signal session expiry to the rest of the app via 'tavro:session_expired'
 *  - provide getValidToken() so API clients always have a live token
 */

const AUTH_KEYS = [
    'tavro_auth',
    'tavro_access_token',
    'tavro_id_token',
    'tavro_mcp_access_token',
    'tavro_raw_access_token',
    'tavro_mcp_refresh_token',
    'tavro_pkce_verifier',
    'tavro_auth_flow_origin',
    'tavro_dcr_client_id',
    'tavro_oidc_provider',
    'tavro_oidc_issuer',
    'tavro_oidc_client_id',
    'tavro_auth_redirect_uri',
    'tavro_oidc_state',
];

function parseJwtPayload(token: string): Record<string, unknown> | null {
    try {
        const part = token.split('.')[1];
        if (!part) return null;
        const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
        return JSON.parse(json);
    } catch {
        return null;
    }
}

/**
 * True when the session is definitively expired.
 *
 * Zitadel issues opaque (reference) bearer tokens when accessTokenType is
 * OIDC_TOKEN_TYPE_BEARER — those can't be decoded. In that case we fall back
 * to the id_token, which OIDC always issues as a signed JWT with an exp claim.
 * If neither is parseable we assume valid and let the API layer signal expiry
 * via tavro:session_expired.
 */
export function isAccessTokenExpired(): boolean {
    const accessToken = localStorage.getItem('tavro_access_token');
    if (!accessToken) return true;

    // JWT access token (OIDC_TOKEN_TYPE_JWT) — decode directly.
    const accessPayload = parseJwtPayload(accessToken);
    if (typeof accessPayload?.exp === 'number') {
        return Date.now() / 1000 >= (accessPayload.exp as number) - 30;
    }

    // Opaque access token — use id_token exp as session proxy.
    const idToken = localStorage.getItem('tavro_id_token');
    if (idToken) {
        const idPayload = parseJwtPayload(idToken);
        if (typeof idPayload?.exp === 'number') {
            return Date.now() / 1000 >= (idPayload.exp as number) - 30;
        }
    }

    // Cannot determine expiry — assume valid; API layer will catch real rejections.
    return false;
}

/** True when tavro_auth is set AND the access token is still live. */
export function isAuthenticated(): boolean {
    return localStorage.getItem('tavro_auth') === 'true' && !isAccessTokenExpired();
}

// Coalesces concurrent refresh calls into a single request.
let _refreshPromise: Promise<boolean> | null = null;

/**
 * Attempts a silent token refresh using the stored refresh token.
 * Returns true on success, false if no refresh token or Zitadel rejects it.
 *
 * Requires the `offline_access` scope to have been requested at login so that
 * Zitadel issues a refresh token.
 */
export async function refreshAccessToken(): Promise<boolean> {
    if (_refreshPromise) return _refreshPromise;

    _refreshPromise = (async (): Promise<boolean> => {
        const refreshToken = localStorage.getItem('tavro_mcp_refresh_token');
        const issuer = localStorage.getItem('tavro_oidc_issuer');
        const clientId = localStorage.getItem('tavro_oidc_client_id');

        if (!refreshToken || !issuer || !clientId) return false;

        try {
            const res = await fetch(`${issuer}/oauth/v2/token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    grant_type: 'refresh_token',
                    client_id: clientId,
                    refresh_token: refreshToken,
                }).toString(),
            });

            if (!res.ok) return false;

            const data: Record<string, unknown> = await res.json();
            if (typeof data.access_token !== 'string') return false;

            localStorage.setItem('tavro_access_token', data.access_token);
            if (typeof data.id_token === 'string') localStorage.setItem('tavro_id_token', data.id_token);
            if (typeof data.refresh_token === 'string') localStorage.setItem('tavro_mcp_refresh_token', data.refresh_token);

            return true;
        } catch {
            return false;
        } finally {
            _refreshPromise = null;
        }
    })();

    return _refreshPromise;
}

/**
 * Returns a valid access token, refreshing silently if the current one is
 * expired. Returns null when the session is definitively expired.
 */
export async function getValidToken(): Promise<string | null> {
    if (!isAccessTokenExpired()) {
        return localStorage.getItem('tavro_access_token');
    }
    const ok = await refreshAccessToken();
    return ok ? localStorage.getItem('tavro_access_token') : null;
}

/** Clear all auth state from localStorage. */
export function clearAuth(): void {
    AUTH_KEYS.forEach(k => localStorage.removeItem(k));
}

/**
 * Dispatch the app-wide session-expired event. Components that need to react
 * (e.g. UnauthorizedHandler in App.tsx) listen for this event.
 */
export function signalSessionExpired(): void {
    window.dispatchEvent(new CustomEvent('tavro:session_expired'));
}
