import React, { useState } from 'react';
import { ShieldCheck, ArrowRight, Loader2, AlertCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const ADMIN_EMAIL    = 'admin@tavro.ai';
const ADMIN_PASSWORD = 'tavro_admin_2024';

const AdminLogin: React.FC = () => {
    const [email,    setEmail]    = useState('');
    const [password, setPassword] = useState('');
    const [loading,  setLoading]  = useState(false);
    const [error,    setError]    = useState<string | null>(null);
    const navigate = useNavigate();

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setLoading(true);
        await new Promise(r => setTimeout(r, 600));
        if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
            localStorage.setItem('tavro_admin_auth', 'true');
            navigate('/');
        } else {
            setError('Invalid credentials. Please try again.');
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4">
            <div className="w-full max-w-md animate-fade-in">
                <div className="flex flex-col items-center mb-10">
                    <div className="p-4 bg-blue-600 rounded-2xl shadow-2xl shadow-blue-500/20 mb-4">
                        <ShieldCheck size={40} className="text-white" />
                    </div>
                    <h1 className="text-3xl font-bold text-white tracking-tight">Admin Portal</h1>
                    <p className="text-slate-500 font-medium mt-1">Tavro Platform Administration</p>
                </div>

                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl relative overflow-hidden">
                    <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500" />

                    <div className="mb-8">
                        <h2 className="text-xl font-bold text-white mb-2">Sign in</h2>
                        <p className="text-slate-400 text-sm leading-relaxed">
                            Enter your admin credentials to access the management portal.
                        </p>
                    </div>

                    <form onSubmit={handleLogin} className="space-y-6">
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Email</label>
                            <input
                                type="email"
                                value={email}
                                onChange={e => setEmail(e.target.value)}
                                placeholder="admin@tavro.ai"
                                className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl px-4 py-3.5 text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none"
                                disabled={loading}
                                required
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Password</label>
                            <input
                                type="password"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                placeholder="••••••••"
                                className="w-full bg-slate-950 border border-slate-800 text-white rounded-xl px-4 py-3.5 text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none"
                                disabled={loading}
                                required
                            />
                        </div>

                        {error && (
                            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex gap-3 items-start">
                                <AlertCircle className="text-red-500 shrink-0 mt-0.5" size={18} />
                                <p className="text-xs font-medium text-red-200 leading-normal">{error}</p>
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 text-white font-bold py-4 rounded-xl shadow-lg shadow-blue-500/10 transition-all flex items-center justify-center gap-2 group"
                        >
                            {loading ? (
                                <Loader2 size={20} className="animate-spin text-white/50" />
                            ) : (
                                <>
                                    <span>Sign In</span>
                                    <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                                </>
                            )}
                        </button>
                    </form>

                    <div className="mt-6 pt-5 border-t border-white/10 text-center text-xs text-slate-500">
                        Restricted access. Authorized personnel only.
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AdminLogin;
