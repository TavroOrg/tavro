import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { Plug, Settings, ChevronLeft, ChevronRight, LogOut, ShieldCheck, Layers } from 'lucide-react';

const navItems = [
    { to: '/connectors', icon: Plug,     label: 'Connectors' },
    { to: '/settings',   icon: Settings, label: 'Settings' },
];

const AdminLayout: React.FC = () => {
    const [collapsed, setCollapsed] = useState(false);
    const navigate = useNavigate();

    const handleLogout = () => {
        localStorage.removeItem('tavro_admin_auth');
        navigate('/login');
    };

    return (
        <div className="min-h-screen bg-slate-100 dark:bg-slate-950 flex transition-colors">
            {/* Sidebar */}
            <aside
                className={`${collapsed ? 'w-[72px]' : 'w-64'} bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col transition-all duration-300 shrink-0`}
            >
                {/* Brand */}
                <div className="h-16 flex items-center px-4 border-b border-slate-200 dark:border-slate-800 gap-3 overflow-hidden">
                    <div className="p-1.5 bg-blue-600 rounded-lg shrink-0">
                        <ShieldCheck size={18} className="text-white" />
                    </div>
                    {!collapsed && (
                        <div className="min-w-0">
                            <p className="text-slate-800 dark:text-white font-bold text-sm leading-none truncate">Admin Portal</p>
                            <p className="text-slate-400 dark:text-slate-500 text-xs mt-0.5">Tavro Platform</p>
                        </div>
                    )}
                </div>

                {/* Nav */}
                <nav className="flex-1 py-4 px-3 space-y-1">
                    {navItems.map(({ to, icon: Icon, label }) => (
                        <NavLink
                            key={to}
                            to={to}
                            className={({ isActive }) =>
                                `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all border ${isActive
                                    ? 'bg-blue-50 dark:bg-blue-600/20 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-500/20'
                                    : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-white border-transparent'
                                }`
                            }
                        >
                            <Icon size={18} className="shrink-0" />
                            {!collapsed && <span>{label}</span>}
                        </NavLink>
                    ))}
                </nav>

                {/* Footer */}
                <div className="p-3 border-t border-slate-200 dark:border-slate-800 space-y-1">
                    <button
                        onClick={() => setCollapsed(!collapsed)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-white text-sm font-medium transition-all"
                    >
                        {collapsed ? <ChevronRight size={18} className="shrink-0" /> : <ChevronLeft size={18} className="shrink-0" />}
                        {!collapsed && <span>Collapse</span>}
                    </button>
                    <button
                        onClick={handleLogout}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-500 dark:text-slate-400 hover:bg-red-50 dark:hover:bg-red-500/10 hover:text-red-500 dark:hover:text-red-400 text-sm font-medium transition-all"
                    >
                        <LogOut size={18} className="shrink-0" />
                        {!collapsed && <span>Sign Out</span>}
                    </button>
                </div>
            </aside>

            {/* Main */}
            <main className="flex-1 flex flex-col overflow-hidden">
                {/* Top bar */}
                <header className="h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-6 shrink-0">
                    <div className="flex items-center gap-2">
                        <Layers size={16} className="text-blue-500" />
                        <span className="text-slate-400 dark:text-slate-400 text-sm">Tavro</span>
                        <span className="text-slate-300 dark:text-slate-600 mx-1">/</span>
                        <span className="text-slate-800 dark:text-white text-sm font-medium">Admin</span>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold select-none">
                            A
                        </div>
                        <div className="text-right hidden sm:block">
                            <p className="text-slate-800 dark:text-white text-sm font-medium leading-none">Admin</p>
                            <p className="text-slate-400 dark:text-slate-500 text-xs mt-0.5">admin@tavro.ai</p>
                        </div>
                    </div>
                </header>

                {/* Page content */}
                <div className="flex-1 overflow-auto p-6">
                    <Outlet />
                </div>
            </main>
        </div>
    );
};

export default AdminLayout;
