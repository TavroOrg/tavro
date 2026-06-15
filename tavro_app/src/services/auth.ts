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
    'tavro_tenant_id',
    'tavro_last_activity_at',
];

export const SESSION_TIMEOUT_MS =  30 * 60 * 1000;
export const LAST_ACTIVITY_KEY = 'tavro_last_activity_at';

export type SessionExpiredReason = 'expired' | 'inactive';

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

/**
 * Derives the tenant identifier from the current JWT and stores it in
 * localStorage as `tavro_tenant_id`. Called immediately after a successful
 * token exchange or silent refresh so every subsequent API call carries the
 * correct `x-tenant-id` header regardless of whether the MCP server returns
 * that header during its initialize handshake.
 *
 * Priority: Zitadel org claim → org_id → organization_id → sub (per-user
 * isolation fallback). Always overwrites so stale values from a previous
 * session or expired token are replaced.
 */
export function extractAndStoreTenantId(): void {
    const token =
        localStorage.getItem('tavro_access_token') ||
        localStorage.getItem('tavro_id_token');
    if (!token) return;
    const payload = parseJwtPayload(token);
    if (!payload) return;
    const tenantId =
        (payload['urn:zitadel:iam:org:id'] as string | undefined) ||
        (payload['org_id'] as string | undefined) ||
        (payload['organization_id'] as string | undefined) ||
        (payload['sub'] as string | undefined) ||
        null;
    if (tenantId) {
        localStorage.setItem('tavro_tenant_id', tenantId);
    }
}

/**
 * True only when the token has passed its actual exp claim with no grace period.
 * Used as the final arbiter for forced logout: if the token is in the 30s
 * pre-emptive window but not actually expired, we keep the user logged in and
 * let the API layer signal real failures rather than logging them out prematurely.
 */
export function isAccessTokenHardExpired(): boolean {
    const accessToken = localStorage.getItem('tavro_access_token');
    if (!accessToken) return true;

    const accessPayload = parseJwtPayload(accessToken);
    if (typeof accessPayload?.exp === 'number') {
        return Date.now() / 1000 >= (accessPayload.exp as number);
    }

    const idToken = localStorage.getItem('tavro_id_token');
    if (idToken) {
        const idPayload = parseJwtPayload(idToken);
        if (typeof idPayload?.exp === 'number') {
            return Date.now() / 1000 >= (idPayload.exp as number);
        }
    }

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
            // Keep the MCP token in sync so every API client gets the fresh token
            // without relying on each client to update it independently.
            localStorage.setItem('tavro_mcp_access_token', data.access_token);
            if (typeof data.id_token === 'string') localStorage.setItem('tavro_id_token', data.id_token);
            if (typeof data.refresh_token === 'string') localStorage.setItem('tavro_mcp_refresh_token', data.refresh_token);
            extractAndStoreTenantId();

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
        const token = localStorage.getItem('tavro_access_token');
        // Lazily populate tavro_tenant_id for sessions that pre-date the
        // extractAndStoreTenantId call in AuthCallback / refreshAccessToken.
        if (token && !localStorage.getItem('tavro_tenant_id')) {
            extractAndStoreTenantId();
        }
        return token;
    }
    const ok = await refreshAccessToken();
    return ok ? localStorage.getItem('tavro_access_token') : null;
}

/** Clear all auth state from localStorage. */
export function clearAuth(): void {
    AUTH_KEYS.forEach(k => localStorage.removeItem(k));
}

export function recordSessionActivity(timestamp = Date.now()): void {
    localStorage.setItem(LAST_ACTIVITY_KEY, String(timestamp));
    window.dispatchEvent(new CustomEvent('tavro:session_activity'));
}

export function getLastSessionActivity(): number {
    const value = Number(localStorage.getItem(LAST_ACTIVITY_KEY));
    return Number.isFinite(value) && value > 0 ? value : Date.now();
}

export function isSessionInactive(now = Date.now()): boolean {
    return now - getLastSessionActivity() >= SESSION_TIMEOUT_MS;
}

/**
 * Dispatch the app-wide session-expired event. Components that need to react
 * (e.g. UnauthorizedHandler in App.tsx) listen for this event.
 */
export function signalSessionExpired(reason: SessionExpiredReason = 'expired'): void {
    window.dispatchEvent(new CustomEvent('tavro:session_expired', { detail: { reason } }));
}
