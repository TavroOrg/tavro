import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Loader2, CheckCircle2, AlertCircle, ShieldOff } from 'lucide-react';

const AuthCallback: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const [status, setStatus] = useState<'loading' | 'success' | 'denied' | 'error'>('loading');
    const [message, setMessage] = useState('Completing authentication...');
    const [debugInfo, setDebugInfo] = useState('');
    const attempted = useRef(false);

    const decodeJwt = (token: string | undefined | null): Record<string, any> | null => {
        try {
            if (!token) return null;
            const part = token.split('.')[1];
            if (!part) return null;
            return JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
        } catch { return null; }
    };

    const extractTenantId = (payload: Record<string, any> | null): string | null => {
        if (!payload) return null;
        // ZITADEL v2+ may return resourceowner as a nested object
        const ro = payload['urn:zitadel:iam:user:resourceowner'];
        if (ro && typeof ro === 'object' && typeof ro.id === 'string' && ro.id.trim()) {
            return ro.id.trim();
        }
        const candidates = [
            'urn:zitadel:iam:user:resourceowner:id',
            'urn:zitadel:iam:org:id', 'urn:zitadel:iam:org:org_id',
            'org_id', 'orgId', 'org', 'tenant_id', 'tenant',
        ];
        for (const k of candidates) {
            const v = payload[k];
            if (typeof v === 'string' && v.trim()) return v.trim();
        }
        return null;
    };

    useEffect(() => {
        if (attempted.current) return;
        attempted.current = true;

        const params = new URLSearchParams(location.search);
        const errorParam = params.get('error');
        const code = params.get('code');

        if (errorParam) {
            setStatus('error');
            setMessage(`OAuth error: ${params.get('error_description') || errorParam}`);
            return;
        }

        if (!code) {
            setStatus('error');
            setMessage('No authorization code in callback URL.');
            return;
        }

        const expectedState = localStorage.getItem('tavro_admin_oidc_state');
        const returnedState = params.get('state');
        if (expectedState && returnedState !== expectedState) {
            setStatus('error');
            setMessage('Authentication failed: state mismatch. Please sign in again.');
            return;
        }

        const issuer = localStorage.getItem('tavro_admin_oidc_issuer');
        const clientId = localStorage.getItem('tavro_admin_oidc_client_id');
        const pkceVerifier = localStorage.getItem('tavro_admin_pkce_verifier');
        const redirectUri = localStorage.getItem('tavro_admin_auth_redirect_uri') || `${window.location.origin}/auth/callback`;

        if (!issuer || !clientId || !pkceVerifier) {
            setStatus('error');
            setMessage('Login session is incomplete. Please sign in again.');
            return;
        }

        const exchange = async () => {
            const response = await fetch(`${issuer}/oauth/v2/token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
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
            try { data = JSON.parse(rawText); } catch { /* */ }

            if (!response.ok) {
                throw new Error(`HTTP ${response.status} — ${data.error_description || data.error || rawText.slice(0, 250)}`);
            }
            if (!data.access_token) throw new Error('No access token in response.');

            // Extract tenant_id from id_token immediately — it's always a JWT so can be decoded.
            // Store early so it's available even before /me responds.
            const idPayload = decodeJwt(data.id_token);
            console.debug('[AdminAuth] id_token payload:', idPayload);
            const earlyTenantId = extractTenantId(idPayload);
            if (earlyTenantId) localStorage.setItem('tavro_admin_tenant_id', earlyTenantId);

            // Verify role via backend — calls ZITADEL userinfo endpoint,
            // which reliably returns roles regardless of token type (opaque or JWT).
            setMessage('Verifying access...');
            const meResp = await fetch('/api/v1/admin/me', {
                headers: { Authorization: `Bearer ${data.access_token}` },
            });
            if (meResp.status === 403) {
                setStatus('denied');
                setMessage('Your account does not have the portal_admin role. Contact your administrator to request access.');
                return;
            }
            if (!meResp.ok) {
                throw new Error(`Role verification failed: HTTP ${meResp.status}`);
            }
            const me = await meResp.json();

            localStorage.setItem('tavro_admin_access_token', data.access_token);
            if (data.id_token) localStorage.setItem('tavro_admin_id_token', data.id_token);
            if (data.refresh_token) localStorage.setItem('tavro_admin_refresh_token', data.refresh_token);

            // me.tenant_id (from userinfo) takes precedence over id_token extraction
            if (me.tenant_id) {
                localStorage.setItem('tavro_admin_tenant_id', me.tenant_id);
            }
            // else: earlyTenantId (set above) is already in localStorage as fallback
            console.debug('[AdminAuth] tenant_id resolved:', localStorage.getItem('tavro_admin_tenant_id'));

            localStorage.removeItem('tavro_admin_pkce_verifier');
            localStorage.removeItem('tavro_admin_oidc_state');
            localStorage.setItem('tavro_admin_auth', 'true');

            setStatus('success');
            setMessage('Authentication successful! Redirecting...');
            setTimeout(() => navigate('/'), 1200);
        };

        exchange().catch((err: Error) => {
            setStatus('error');
            setMessage(`Token exchange failed: ${err.message}`);
            setDebugInfo(err.message);
        });
    }, [location, navigate]);

    return (
        <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4">
            <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-10 shadow-2xl flex flex-col items-center gap-5 text-center relative overflow-hidden">
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500" />

                {status === 'loading' && <Loader2 size={48} className="animate-spin text-blue-500" />}
                {status === 'success' && <CheckCircle2 size={48} className="text-emerald-500" />}
                {status === 'denied' && <ShieldOff size={48} className="text-yellow-400" />}
                {status === 'error' && <AlertCircle size={48} className="text-red-500" />}

                <h2 className="text-xl font-bold text-white">
                    {status === 'loading' ? 'Authenticating' :
                     status === 'success' ? 'Access Granted' :
                     status === 'denied' ? 'Access Denied' : 'Authentication Failed'}
                </h2>
                <p className="text-sm text-slate-400 leading-relaxed">{message}</p>

                {debugInfo && (
                    <pre className="text-xs text-left bg-slate-950 rounded-lg p-3 w-full overflow-auto max-h-28 text-slate-500">{debugInfo}</pre>
                )}

                {(status === 'error' || status === 'denied') && (
                    <button
                        onClick={() => navigate('/login')}
                        className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl text-sm transition-colors"
                    >
                        Back to Login
                    </button>
                )}
            </div>
        </div>
    );
};

export default AuthCallback;
