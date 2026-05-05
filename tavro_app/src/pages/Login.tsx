import React, { useState } from 'react';
import { Layers, ArrowRight, Loader2, AlertCircle } from 'lucide-react';
import { generatePKCE } from '../services/pkce';

/**
 * Login Page — FastMCP OAuth 2.0 Authorization Code + PKCE flow.
 *
 * Flow:
 *  1. Generate PKCE verifier + challenge
 *  2. POST /cognito/register  → FastMCP issues a dcrClientId it recognises
 *  3. GET  /cognito/authorize → FastMCP proxies the Cognito login UI
 *  4. Cognito redirects back with ?code=...
 *  5. AuthCallback POSTs code to /cognito/token → receives FastMCP HS256 token
 *  6. HS256 token is accepted by /cognito/mcp via MultiAuth jwt_verifier
 */
const Login: React.FC = () => {
    // ── State ─────────────────────────────────────────────────────────────
    const [customMcpUrl, setCustomMcpUrl] = useState('https://agent-cloud.tavro.ai/google/mcp');
    const [tenantId, setTenantId] = useState('tavro_59edff5c0f');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [step, setStep] = useState<string>('');

    // Derive mcpBase: e.g. https://.../google/mcp -> https://.../google
    const mcpBase = customMcpUrl.substring(0, customMcpUrl.lastIndexOf('/'));
    
    // Static redirect URI for Google
    const redirectUri = `${window.location.origin}/google/auth/callback`;

    const handleConnect = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        if (!customMcpUrl.startsWith('http')) {
            setError('Please enter a valid MCP URL (starting with http/https)');
            return;
        }

        setLoading(true);

        try {
            // ── Clear stale session ───────────────────────────────────────
            setStep('Clearing previous session…');
            const staleKeys = [
                'tavro_auth', 'tavro_access_token', 'tavro_id_token', 'tavro_raw_access_token',
                'tavro_mcp_refresh_token', 'tavro_pkce_verifier', 'tavro_dcr_client_id',
                'tavro_auth_flow_origin'
            ];
            staleKeys.forEach(k => localStorage.removeItem(k));

            // Store for reference / MCP calls after login
            localStorage.setItem('tavro_mcp_url', customMcpUrl);
            localStorage.setItem('tavro_tenant_id', tenantId.trim());
            localStorage.setItem('tavro_auth_redirect_uri', redirectUri);

            // ── Step 1: PKCE ──────────────────────────────────────────────
            setStep('Generating PKCE challenge…');
            const { verifier, challenge } = await generatePKCE();
            localStorage.setItem('tavro_pkce_verifier', verifier);
            localStorage.setItem('tavro_auth_flow_origin', 'login');

            // ── Step 2: DCR — register with FastMCP ───────────────────────
            setStep('Registering with MCP server…');
            const regRes = await fetch(`${mcpBase}/register?tenant_id=${tenantId.trim()}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    redirect_uris: [redirectUri],
                    client_name: 'Agent Biz Ops React Client',
                    grant_types: ['authorization_code', 'refresh_token'],
                    response_types: ['code'],
                    token_endpoint_auth_method: 'none',
                    scope: 'openid',
                    tenant_id: tenantId.trim(),
                }),
            });

            if (!regRes.ok) {
                const errText = await regRes.text();
                throw new Error(`DCR failed (${regRes.status}): ${errText.substring(0, 200)}`);
            }

            const regData = await regRes.json();
            const dcrClientId = regData.client_id;
            localStorage.setItem('tavro_dcr_client_id', dcrClientId);

            // ── Step 3: Redirect to FastMCP's authorize endpoint ──────────
            setStep('Redirecting to MCP authorization…');
            const authUrl = new URL(`${mcpBase}/authorize`);
            authUrl.searchParams.set('client_id', dcrClientId); 
            authUrl.searchParams.set('response_type', 'code');
            authUrl.searchParams.set('redirect_uri', redirectUri);
            authUrl.searchParams.set('scope', 'openid');
            authUrl.searchParams.set('code_challenge', challenge);
            authUrl.searchParams.set('code_challenge_method', 'S256');
            authUrl.searchParams.set('tenant_id', tenantId.trim());

            window.location.href = authUrl.toString();

        } catch (err: any) {
            console.error('[Login] Error:', err);
            setLoading(false);
            setStep('');
            setError(err.message || 'Connection failed. Check the console for details.');
        }
    };

    return (
        <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4">
            <div className="w-full max-w-md animate-fade-in">
                {/* Logo Section */}
                <div className="flex flex-col items-center mb-10">
                    <div className="p-4 bg-blue-600 rounded-2xl shadow-2xl shadow-blue-500/20 mb-4">
                        <Layers size={40} className="text-white" />
                    </div>
                    <h1 className="text-3xl font-bold text-white tracking-tight">Agent Biz Ops</h1>
                    <p className="text-slate-500 font-medium mt-1">Enterprise Agentic Operations</p>
                </div>

                {/* Main Login Card */}
                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl relative overflow-hidden">
                    {/* Background glow */}
                    <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500" />
                    
                    <div className="mb-8">
                        <h2 className="text-xl font-bold text-white mb-2">Connect to MCP</h2>
                        <p className="text-slate-400 text-sm leading-relaxed">
                            Enter your FastMCP server URL to initiate the secure OAuth connection.
                        </p>
                    </div>

                    <form onSubmit={handleConnect} className="space-y-6">
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">
                                MCP Server Endpoint
                            </label>
                            <input
                                type="text"
                                value={customMcpUrl}
                                onChange={(e) => setCustomMcpUrl(e.target.value)}
                                placeholder="https://..."
                                className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl px-4 py-3.5 text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none font-mono"
                                disabled={loading}
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">
                                Tenant ID
                            </label>
                            <input
                                type="text"
                                value={tenantId}
                                onChange={(e) => setTenantId(e.target.value)}
                                placeholder="e.g. tavro_59edff5c0f"
                                className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl px-4 py-3.5 text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none font-mono"
                                disabled={loading}
                            />
                        </div>

                        {error && (
                            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex gap-3 items-start animate-shake">
                                <AlertCircle className="text-red-500 shrink-0 mt-0.5" size={18} />
                                <p className="text-xs font-medium text-red-200 leading-normal">{error}</p>
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 text-white font-bold py-4 rounded-xl shadow-lg shadow-blue-500/10 transition-all flex items-center justify-center gap-2 group overflow-hidden relative"
                        >
                            {loading ? (
                                <Loader2 size={20} className="animate-spin text-white/50" />
                            ) : (
                                <>
                                    <span>Initiate Connection</span>
                                    <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                                </>
                            )}
                        </button>

                        {loading && (
                            <div className="flex flex-col items-center gap-3 py-2">
                                <div className="flex gap-1">
                                    <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                                    <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                                    <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce"></div>
                                </div>
                                <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">{step}</p>
                            </div>
                        )}
                    </form>
                    <div className="mt-6 pt-5 border-t border-white/10 text-center text-xs text-slate-500">
                        Agent Biz Ops is built on the FastMCP framework. FastMCP handles secure authentication flows, including OAuth with Google and Cognito. When you click the button above, you are redirected to FastMCP to verify your enterprise identity.
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Login;
