import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';

const AuthCallback: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
    const [message, setMessage] = useState('Completing authentication...');
    const [debugInfo, setDebugInfo] = useState<string>('');

    const exchangeAttempted = React.useRef(false);

    useEffect(() => {
        if (exchangeAttempted.current) return;
        exchangeAttempted.current = true;

        const params = new URLSearchParams(location.search);
        const hashParams = new URLSearchParams(location.hash.replace(/^#\/?/, ''));

        const token = params.get('token') || params.get('access_token') || hashParams.get('access_token');
        const code = params.get('code');
        const errorParam = params.get('error');

        if (errorParam) {
            const desc = params.get('error_description') || errorParam;
            console.error('[AuthCallback] OAuth error param:', errorParam, desc);
            setStatus('error');
            setMessage(`OAuth error: ${desc}`);
            setDebugInfo(`error=${errorParam}`);
            return;
        }

        if (token) {
            console.log('[AuthCallback] Got direct token, storing...');
            localStorage.setItem('tavro_access_token', token);
            localStorage.setItem('tavro_auth', 'true');
            setStatus('success');
            setMessage('Authentication successful! Redirecting...');
            const origin = localStorage.getItem('tavro_auth_flow_origin');
            localStorage.removeItem('tavro_auth_flow_origin');
            setTimeout(() => navigate(origin === 'login' ? '/' : '/settings'), 1500);
            return;
        }

        if (code) {
            const oidcProvider = localStorage.getItem('tavro_oidc_provider');
            const expectedState = localStorage.getItem('tavro_oidc_state');
            const returnedState = params.get('state');

            if (oidcProvider === 'zitadel') {
                if (expectedState && returnedState !== expectedState) {
                    setStatus('error');
                    setMessage('Authentication failed: state mismatch. Please sign in again.');
                    setDebugInfo(`expected_state=${expectedState}; returned_state=${returnedState || ''}`);
                    return;
                }

                const pkceVerifier = localStorage.getItem('tavro_pkce_verifier');
                const issuer = localStorage.getItem('tavro_oidc_issuer');
                const clientId = localStorage.getItem('tavro_oidc_client_id');
                const redirectUri = localStorage.getItem('tavro_auth_redirect_uri') || `${window.location.origin}/auth/callback`;

                if (!issuer || !clientId || !pkceVerifier) {
                    setStatus('error');
                    setMessage('ZITADEL login session is incomplete. Please sign in again.');
                    return;
                }

                const exchangeZitadelToken = async () => {
                    try {
                        const response = await fetch(`${issuer}/oauth/v2/token`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/x-www-form-urlencoded',
                                'Accept': 'application/json',
                            },
                            body: new URLSearchParams({
                                grant_type: 'authorization_code',
                                client_id: clientId,
                                code: code.trim(),
                                redirect_uri: redirectUri,
                                code_verifier: pkceVerifier,
                            }).toString(),
                        });

                        const rawText = await response.text();
                        let data: any = {};
                        try { data = JSON.parse(rawText); } catch { data = {}; }

                        if (!response.ok) {
                            throw new Error(`HTTP ${response.status} - ${data.error_description || data.error || rawText.substring(0, 250)}`);
                        }

                        if (!data.access_token) {
                            throw new Error('No access token in ZITADEL response.');
                        }

                        localStorage.setItem('tavro_access_token', data.access_token);
                        if (data.id_token) localStorage.setItem('tavro_id_token', data.id_token);
                        if (data.refresh_token) localStorage.setItem('tavro_mcp_refresh_token', data.refresh_token);
                        localStorage.removeItem('tavro_pkce_verifier');
                        localStorage.removeItem('tavro_oidc_state');
                        localStorage.setItem('tavro_auth', 'true');

                        setStatus('success');
                        setMessage('Authentication successful! Redirecting...');
                        const origin = localStorage.getItem('tavro_auth_flow_origin');
                        localStorage.removeItem('tavro_auth_flow_origin');
                        setTimeout(() => navigate(origin === 'login' ? '/' : '/settings'), 1500);
                    } catch (err: any) {
                        console.error('[AuthCallback] ZITADEL token exchange exception:', err);
                        setStatus('error');
                        setMessage(`Token exchange failed: ${err.message}`);
                        setDebugInfo(err.message);
                    }
                };

                exchangeZitadelToken();
                return;
            }

            const pkceVerifier = localStorage.getItem('tavro_pkce_verifier');
            const dcrClientId = localStorage.getItem('tavro_dcr_client_id');
            const mcpUrl = localStorage.getItem('tavro_mcp_url') || 'https://agent-cloud.tavro.ai/google/mcp';
            const redirectUri = localStorage.getItem('tavro_auth_redirect_uri') || `${window.location.origin}/google/auth/callback`;

            // Derive mcpBase: e.g. https://.../google/mcp -> https://.../google
            const mcpBase = mcpUrl.substring(0, mcpUrl.lastIndexOf('/'));
            const tokenEndpoint = `${mcpBase}/token`;

            console.log('[AuthCallback] Got code, exchanging via FastMCP...', {
                dcrClientId,
                hasPkce: !!pkceVerifier,
                mcpUrl,
                tokenEndpoint
            });

            if (!dcrClientId) {
                setStatus('error');
                setMessage('DCR Client ID missing from session. Please sign in again.');
                return;
            }

            const exchangeToken = async () => {
                try {
                    const response = await fetch(tokenEndpoint, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded',
                            'Accept': 'application/json',
                        },
                        body: new URLSearchParams({
                            grant_type: 'authorization_code',
                            client_id: dcrClientId,
                            code: code.trim(),
                            redirect_uri: redirectUri,
                            code_verifier: pkceVerifier || '',
                            tenant_id: localStorage.getItem('tavro_tenant_id') || '',
                        }).toString(),
                    });

                    console.log('[AuthCallback] Token response status:', response.status);
                    const rawText = await response.text();
                    let data: any = {};
                    try { data = JSON.parse(rawText); } catch { data = {}; }

                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status} - ${data.error_description || data.error || rawText.substring(0, 250)}`);
                    }

                    const primaryToken = data.access_token;

                    if (primaryToken) {
                        // Store as the dedicated MCP token — mcpClient reads this first
                        localStorage.setItem('tavro_mcp_access_token', primaryToken);
                        localStorage.setItem('tavro_access_token', primaryToken);
                        if (data.id_token) localStorage.setItem('tavro_id_token', data.id_token);
                        if (data.refresh_token) localStorage.setItem('tavro_mcp_refresh_token', data.refresh_token);
                        localStorage.removeItem('tavro_pkce_verifier');
                        localStorage.setItem('tavro_auth', 'true');

                        setStatus('success');
                        setMessage('Authentication successful! Redirecting...');
                        const origin = localStorage.getItem('tavro_auth_flow_origin');
                        localStorage.removeItem('tavro_auth_flow_origin');
                        setTimeout(() => navigate(origin === 'login' ? '/' : '/settings'), 1500);
                    } else {
                        throw new Error('No access token in response.');
                    }
                } catch (err: any) {
                    console.error('[AuthCallback] Token exchange exception:', err);
                    setStatus('error');
                    setMessage(`Token exchange failed: ${err.message}`);
                    setDebugInfo(err.message);
                }
            };

            exchangeToken();
            return;
        }

        setStatus('error');
        setMessage('No token or authorization code found in the callback URL.');
    }, [location, navigate]);

    return (
        <div className="flex h-screen w-full items-center justify-center bg-slate-50">
            <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm flex flex-col items-center max-w-md text-center gap-4">
                {status === 'loading' && <Loader2 size={48} className="animate-spin text-blue-500" />}
                {status === 'success' && <CheckCircle2 size={48} className="text-emerald-500" />}
                {status === 'error' && <AlertCircle size={48} className="text-red-500" />}
                <h2 className="text-xl font-bold text-slate-800 tracking-tight">
                    {status === 'loading' ? 'Authenticating' : status === 'success' ? 'Authorized' : 'Authentication Failed'}
                </h2>
                <p className="text-sm text-slate-500">{message}</p>
                {status === 'error' && debugInfo && (
                    <pre className="text-xs text-left bg-slate-100 rounded-lg p-3 w-full overflow-auto max-h-32 text-slate-600">{debugInfo}</pre>
                )}
                {status === 'error' && (
                    <div className="flex gap-3 mt-2">
                        <button onClick={() => navigate('/login')} className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg text-sm">Try Again</button>
                    </div>
                )}
            </div>
        </div>
    );
};
export default AuthCallback;
