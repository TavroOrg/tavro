import React, { useEffect, useState } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import { generatePKCE } from '../services/pkce';
import { loadAuthConfig } from '../services/authConfig';

/**
 * Login Page - ZITADEL OAuth 2.0 Authorization Code + PKCE flow.
 * This route immediately redirects to the hosted ZITADEL login page.
 */
const Login: React.FC = () => {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const redirectToZitadel = async () => {
            const isTimeoutRedirect = new URLSearchParams(window.location.search).get('reason') === 'timeout';
            const authConfig = await loadAuthConfig();
            const issuer = authConfig.zitadelIssuer;
            const clientId = authConfig.zitadelClientId;
            const redirectPath = authConfig.zitadelRedirectPath;
            const redirectUri = `${window.location.origin}${redirectPath}`;

            if (!issuer || !clientId) {
                setLoading(false);
                setError('ZITADEL login is not configured. Set VITE_ZITADEL_ISSUER and VITE_ZITADEL_CLIENT_ID.');
                return;
            }

            const staleKeys = [
                'tavro_auth',
                'tavro_access_token',
                'tavro_id_token',
                'tavro_raw_access_token',
                'tavro_mcp_access_token',
                'tavro_mcp_refresh_token',
                'tavro_pkce_verifier',
                'tavro_dcr_client_id',
                'tavro_auth_flow_origin',
                'tavro_oidc_provider',
                'tavro_oidc_issuer',
                'tavro_oidc_client_id',
                'tavro_auth_redirect_uri',
                'tavro_oidc_state',
                'tavro_tenant_id',
                'tavro_last_activity_at',
            ];
            staleKeys.forEach((key) => localStorage.removeItem(key));

            const { verifier, challenge } = await generatePKCE();
            const state = crypto.randomUUID();

            localStorage.setItem('tavro_pkce_verifier', verifier);
            localStorage.setItem('tavro_auth_flow_origin', 'login');
            localStorage.setItem('tavro_oidc_provider', 'zitadel');
            localStorage.setItem('tavro_oidc_issuer', issuer);
            localStorage.setItem('tavro_oidc_client_id', clientId);
            localStorage.setItem('tavro_auth_redirect_uri', redirectUri);
            localStorage.setItem('tavro_oidc_state', state);

            const authUrl = new URL(`${issuer}/oauth/v2/authorize`);
            authUrl.searchParams.set('client_id', clientId);
            authUrl.searchParams.set('response_type', 'code');
            authUrl.searchParams.set('redirect_uri', redirectUri);
            authUrl.searchParams.set('scope', authConfig.zitadelScope);
            authUrl.searchParams.set('code_challenge', challenge);
            authUrl.searchParams.set('code_challenge_method', 'S256');
            authUrl.searchParams.set('state', state);
            if (isTimeoutRedirect) {
                authUrl.searchParams.set('prompt', 'login');
            }

            window.location.href = authUrl.toString();
        };

        redirectToZitadel().catch((err: Error) => {
            console.error('[Login] ZITADEL redirect failed:', err);
            setLoading(false);
            setError(err.message || 'Unable to start ZITADEL login.');
        });
    }, []);

    return (
        <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4">
            <div className="w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center shadow-2xl">
                {loading ? (
                    <div className="flex flex-col items-center gap-4">
                        <Loader2 size={36} className="animate-spin text-blue-500" />
                        <p className="text-sm font-semibold text-slate-300">Redirecting to ZITADEL...</p>
                        {new URLSearchParams(window.location.search).get('reason') === 'timeout' && (
                            <p className="text-xs leading-5 text-slate-500">Your session expired due to inactivity. Please log in again.</p>
                        )}
                    </div>
                ) : (
                    <div className="flex flex-col items-center gap-4">
                        <AlertCircle size={36} className="text-red-400" />
                        <h1 className="text-lg font-bold text-white">Login configuration required</h1>
                        <p className="text-sm leading-6 text-slate-400">{error}</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Login;
