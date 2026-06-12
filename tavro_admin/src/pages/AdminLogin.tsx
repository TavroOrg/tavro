import React, { useEffect, useState } from 'react';
import { ShieldCheck, Loader2, AlertCircle } from 'lucide-react';
import { generatePKCE } from '../services/pkce';
import { loadAuthConfig } from '../services/authConfig';

const AdminLogin: React.FC = () => {
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const redirectToZitadel = async () => {
            const authConfig = await loadAuthConfig();
            const { zitadelIssuer: issuer, zitadelClientId: clientId, zitadelRedirectPath: redirectPath, zitadelScope: scope } = authConfig;
            const redirectUri = `${window.location.origin}${redirectPath}`;

            if (!issuer || !clientId) {
                setError('ZITADEL login is not configured. Set VITE_ZITADEL_ISSUER and VITE_ZITADEL_CLIENT_ID.');
                return;
            }

            const staleKeys = [
                'tavro_admin_pkce_verifier', 'tavro_admin_oidc_state',
                'tavro_admin_oidc_issuer', 'tavro_admin_oidc_client_id',
                'tavro_admin_auth_redirect_uri', 'tavro_admin_access_token',
                'tavro_admin_id_token', 'tavro_admin_refresh_token',
                'tavro_admin_tenant_id', 'tavro_admin_auth',
            ];
            staleKeys.forEach((k) => localStorage.removeItem(k));

            const { verifier, challenge } = await generatePKCE();
            const state = crypto.randomUUID();

            localStorage.setItem('tavro_admin_pkce_verifier', verifier);
            localStorage.setItem('tavro_admin_oidc_issuer', issuer);
            localStorage.setItem('tavro_admin_oidc_client_id', clientId);
            localStorage.setItem('tavro_admin_auth_redirect_uri', redirectUri);
            localStorage.setItem('tavro_admin_oidc_state', state);

            const authUrl = new URL(`${issuer}/oauth/v2/authorize`);
            authUrl.searchParams.set('client_id', clientId);
            authUrl.searchParams.set('response_type', 'code');
            authUrl.searchParams.set('redirect_uri', redirectUri);
            authUrl.searchParams.set('scope', scope);
            authUrl.searchParams.set('code_challenge', challenge);
            authUrl.searchParams.set('code_challenge_method', 'S256');
            authUrl.searchParams.set('state', state);

            window.location.href = authUrl.toString();
        };

        redirectToZitadel().catch((err: Error) => {
            setError(err.message || 'Unable to start ZITADEL login.');
        });
    }, []);

    return (
        <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4">
            <div className="w-full max-w-md">
                <div className="flex flex-col items-center mb-10">
                    <div className="p-4 bg-blue-600 rounded-2xl shadow-2xl shadow-blue-500/20 mb-4">
                        <ShieldCheck size={40} className="text-white" />
                    </div>
                    <h1 className="text-3xl font-bold text-white tracking-tight">Admin Portal</h1>
                    <p className="text-slate-500 font-medium mt-1">Tavro Platform Administration</p>
                </div>

                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl relative overflow-hidden">
                    <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500" />

                    {!error ? (
                        <div className="flex flex-col items-center gap-4 py-4">
                            <Loader2 size={36} className="animate-spin text-blue-500" />
                            <p className="text-sm font-semibold text-slate-300">Redirecting to ZITADEL...</p>
                            <p className="text-xs text-slate-500">You will be redirected to sign in.</p>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center gap-4 py-4">
                            <AlertCircle size={36} className="text-red-400" />
                            <h2 className="text-lg font-bold text-white">Login configuration required</h2>
                            <p className="text-sm text-slate-400 text-center leading-relaxed">{error}</p>
                        </div>
                    )}

                    <div className="mt-6 pt-5 border-t border-white/10 text-center text-xs text-slate-500">
                        Restricted access. Authorized personnel only.
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AdminLogin;
