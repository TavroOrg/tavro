import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Plug, Terminal, Settings } from 'lucide-react';
import travoLogo from '../assets/travo_logo.png';

const QUICK_LINKS = [
    {
        label: 'Connectors',
        desc: 'Manage platform integrations and API keys',
        icon: Plug,
        to: '/connectors',
    },
    {
        label: 'Container Logs',
        desc: 'View real-time logs from all running Docker containers',
        icon: Terminal,
        to: '/container-logs',
    },
    {
        label: 'Settings',
        desc: 'Configure LLM providers and portal appearance',
        icon: Settings,
        to: '/settings',
    },
];

export default function AdminHomePage() {
    const navigate = useNavigate();

    return (
        <div className="flex-1 flex items-center justify-center overflow-auto p-10">
            <div className="w-full max-w-5xl space-y-8 animate-fade-in">

                {/* Hero */}
                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-10 flex items-center gap-8">
                    <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 shrink-0">
                        <img src={travoLogo} alt="Tavro" className="w-[64px] h-[64px] object-contain" />
                    </div>
                    <div>
                        <h1 className="text-4xl font-bold text-slate-800 dark:text-white leading-tight">
                            Welcome to <span className="text-blue-600">Tavro Admin Portal</span>
                        </h1>
                        <p className="text-slate-500 dark:text-slate-400 mt-2 text-base">
                            Manage connectors, monitor containers, and configure your Tavro platform.
                        </p>
                    </div>
                </div>

                {/* Quick links */}
                <div className="grid grid-cols-3 gap-5">
                    {QUICK_LINKS.map(({ label, desc, icon: Icon, to }) => (
                        <button
                            key={to}
                            onClick={() => navigate(to)}
                            className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-7 text-left hover:border-blue-300 dark:hover:border-blue-600 hover:shadow-md transition-all group"
                        >
                            <div className="w-14 h-14 rounded-xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center mb-4 group-hover:bg-blue-100 dark:group-hover:bg-blue-900/40 transition-colors">
                                <Icon size={26} className="text-blue-600 dark:text-blue-400" />
                            </div>
                            <p className="font-semibold text-slate-800 dark:text-white text-base">{label}</p>
                            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{desc}</p>
                        </button>
                    ))}
                </div>

            </div>
        </div>
    );
}
