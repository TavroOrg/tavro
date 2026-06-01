import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    BookOpen, ChevronRight, ChevronDown, Search, X,
    Info, Lightbulb, AlertTriangle,
    Bot, ClipboardList, AppWindow, Workflow, Plug, Zap,
    BarChart2, Network, Scale, ShieldCheck, FlaskConical,
    Settings, MessageCircle,
    ArrowRight, CheckCircle2,
    Home, Play, LayoutGrid, List, Plus, Link2,
    ShieldAlert, Unlink2, PlusCircle, Settings2, MessageSquare,
    ClipboardCheck, Loader2, Send, Paperclip,
    Building2, Globe, RefreshCw, Hash, Layers
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────
interface TocSection {
    id: string;
    label: string;
    icon?: React.ReactNode;
    children?: { id: string; label: string }[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const Callout: React.FC<{
    type: 'info' | 'warning' | 'tip';
    title?: string;
    children: React.ReactNode;
}> = ({ type, title, children }) => {
    const styles = {
        info:    { wrap: 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800',    icon: <Info size={15} className="text-blue-500 flex-shrink-0 mt-0.5" />,    titleColor: 'text-blue-700 dark:text-blue-300',    text: 'text-blue-800 dark:text-blue-200' },
        warning: { wrap: 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800', icon: <AlertTriangle size={15} className="text-amber-500 flex-shrink-0 mt-0.5" />, titleColor: 'text-amber-700 dark:text-amber-300', text: 'text-amber-800 dark:text-amber-200' },
        tip:     { wrap: 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800', icon: <Lightbulb size={15} className="text-emerald-500 flex-shrink-0 mt-0.5" />, titleColor: 'text-emerald-700 dark:text-emerald-300', text: 'text-emerald-800 dark:text-emerald-200' },
    };
    const s = styles[type];
    return (
        <div className={`flex gap-3 rounded-xl border px-4 py-3.5 my-4 ${s.wrap}`}>
            {s.icon}
            <div className="min-w-0">
                {title && <p className={`text-xs font-bold uppercase tracking-wider mb-1 ${s.titleColor}`}>{title}</p>}
                <div className={`text-sm leading-relaxed ${s.text}`}>{children}</div>
            </div>
        </div>
    );
};

const InlineCode: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <code className="px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-blue-700 dark:text-blue-300 text-[13px] font-mono border border-slate-200 dark:border-slate-700">{children}</code>
);

const SectionHeading: React.FC<{ id: string; level?: 1 | 2 | 3; children: React.ReactNode; icon?: React.ReactNode }> = ({ id, level = 2, children, icon }) => {
    if (level === 2) return (
        <h2 id={id} className="flex items-center gap-2.5 text-xl font-bold text-slate-900 dark:text-slate-100 mt-12 mb-4 pt-8 border-t border-slate-100 dark:border-slate-800 scroll-mt-6">
            {icon && <span className="text-blue-500 dark:text-blue-400 flex-shrink-0">{icon}</span>}
            {children}
        </h2>
    );
    return (
        <h3 id={id} className="text-base font-semibold text-slate-800 dark:text-slate-200 mt-7 mb-3 scroll-mt-6">{children}</h3>
    );
};

const Badge: React.FC<{ color?: 'blue' | 'green' | 'amber' | 'red' | 'violet' | 'slate' | 'rose'; children: React.ReactNode }> = ({ color = 'blue', children }) => {
    const c = { blue: 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-700', green: 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-700', amber: 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-700', red: 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-red-200 dark:border-red-700', violet: 'bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-700', slate: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600', rose: 'bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-700' };
    return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${c[color]}`}>{children}</span>;
};

const Step: React.FC<{ n: number; title?: string; children: React.ReactNode }> = ({ n, title, children }) => (
    <div className="flex gap-4 mb-5">
        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center mt-0.5">{n}</div>
        <div className="flex-1 text-sm text-slate-700 dark:text-slate-300 leading-relaxed pt-0.5">
            {title && <strong className="text-slate-900 dark:text-slate-100 block mb-0.5">{title}</strong>}
            {children}
        </div>
    </div>
);

const UIButton: React.FC<{ color?: 'blue' | 'violet' | 'red' | 'slate' | 'rose'; icon?: React.ReactNode; children: React.ReactNode }> = ({ color = 'blue', icon, children }) => {
    const c = { blue: 'bg-blue-600 text-white', violet: 'bg-violet-600 text-white', red: 'bg-red-50 border border-red-300 text-red-700', rose: 'bg-rose-600 text-white', slate: 'bg-white border border-slate-300 text-slate-700 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-300' };
    return (
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold ${c[color]}`}>
            {icon}<span>{children}</span>
        </span>
    );
};

// ─── Screen Mockups ───────────────────────────────────────────────────────────

const ScreenFrame: React.FC<{ title: string; subtitle?: string; children: React.ReactNode }> = ({ title, subtitle, children }) => (
    <div className="my-6 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-lg">
        <div className="bg-slate-100 dark:bg-slate-800 px-4 py-2.5 border-b border-slate-200 dark:border-slate-700 flex items-center gap-3">
            <div className="flex gap-1.5">
                <span className="w-3 h-3 rounded-full bg-red-400" />
                <span className="w-3 h-3 rounded-full bg-amber-400" />
                <span className="w-3 h-3 rounded-full bg-emerald-400" />
            </div>
            <div className="flex-1 text-center">
                <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">{title}</span>
            </div>
            {subtitle && <span className="text-[10px] text-slate-400 font-medium">{subtitle}</span>}
        </div>
        <div className="bg-slate-50 dark:bg-slate-900">{children}</div>
    </div>
);

// Mockup: App Layout
const LayoutMockup: React.FC = () => (
    <ScreenFrame title="tavro.ai — Agent BizOps">
        <div className="flex h-48 text-[10px]">
            {/* Left rail */}
            <div className="w-28 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-700 flex flex-col p-2 gap-1 flex-shrink-0">
                <div className="flex items-center gap-1.5 px-1 py-1.5 mb-1 border-b border-slate-100 dark:border-slate-800">
                    <div className="w-5 h-5 rounded bg-blue-600 flex-shrink-0" />
                    <span className="font-bold text-slate-800 dark:text-slate-200 text-[9px]">Tavro BizOps</span>
                </div>
                {[{ icon: <Home size={10} />, label: 'Home' }, { icon: <ClipboardList size={10} />, label: 'AI Use Cases', active: true }, { icon: <Bot size={10} />, label: 'Agents' }, { icon: <Network size={10} />, label: 'Blueprint' }, { icon: <Scale size={10} />, label: 'Compliance' }, { icon: <ShieldCheck size={10} />, label: 'Audit Center' }].map(item => (
                    <div key={item.label} className={`flex items-center gap-1.5 px-2 py-1 rounded-md ${item.active ? 'bg-blue-50 text-blue-700' : 'text-slate-500 dark:text-slate-400'}`}>
                        {item.icon}<span>{item.label}</span>
                    </div>
                ))}
            </div>
            {/* Main */}
            <div className="flex-1 p-3 overflow-hidden">
                <div className="flex items-center justify-between mb-2">
                    <div>
                        <div className="font-bold text-slate-800 dark:text-slate-200 text-xs">AI Use Cases</div>
                        <div className="text-slate-400 text-[9px]">12 active initiatives</div>
                    </div>
                    <div className="bg-blue-600 text-white px-2 py-0.5 rounded-md text-[9px] font-semibold flex items-center gap-1"><Plus size={8} />New Use Case</div>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                    {['Invoice Automation', 'Customer Churn Prediction', 'Contract Review'].map(name => (
                        <div key={name} className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-2">
                            <div className="w-3 h-3 rounded bg-blue-500 mb-1" />
                            <div className="font-semibold text-slate-700 dark:text-slate-300 leading-tight text-[9px]">{name}</div>
                            <div className="mt-1 flex gap-1">
                                <span className="bg-emerald-100 text-emerald-700 rounded px-1 text-[8px]">Active</span>
                                <span className="bg-amber-100 text-amber-700 rounded px-1 text-[8px]">High</span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
            {/* Right rail */}
            <div className="w-12 bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-700 flex flex-col items-center pt-4 gap-3 flex-shrink-0">
                <div className="flex flex-col items-center gap-1 p-1.5 rounded-xl border border-blue-200 text-blue-500">
                    <MessageCircle size={14} />
                    <span className="text-[7px] font-semibold">Chat</span>
                </div>
                <div className="flex flex-col items-center gap-1 p-1.5 rounded-xl border border-slate-200 text-slate-400">
                    <FlaskConical size={14} />
                    <span className="text-[7px] font-semibold">Logs</span>
                </div>
            </div>
        </div>
    </ScreenFrame>
);

// Mockup: Agent Catalog (real agents from DB)
const AgentCatalogMockup: React.FC = () => (
    <ScreenFrame title="tavro.ai — Agent Catalog" subtitle="288 agents total">
        <div className="p-3 text-[10px]">
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 w-48">
                    <Search size={9} className="text-slate-400" />
                    <span className="text-slate-400">Search 288 agents…</span>
                </div>
                <div className="bg-blue-600 text-white px-2 py-0.5 rounded text-[9px] font-semibold">+ New Agent</div>
            </div>
            <div className="space-y-1.5">
                {[
                    { name: 'Business Data Intelligence Agent', desc: 'Large-scale data analysis, pattern recognition and business intelligence…', risk: '7.76', cls: 'High', clsColor: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300', tools: 5, pii: true },
                    { name: 'ColdChain AI — Perishable Intelligence Agent', desc: 'Forecasts demand, monitors perishable inventory, USDA FSIS & HACCP compliance…', risk: '4.56', cls: 'Medium', clsColor: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300', tools: 6, pii: false },
                    { name: 'Sentiment Agent', desc: 'Classifies customer feedback sentiment and escalates negative or urgent cases…', risk: '—', cls: 'Pending', clsColor: 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400', tools: 2, pii: false },
                ].map(a => (
                    <div key={a.name} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-2 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                            <div className="w-6 h-6 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center flex-shrink-0">
                                <Bot size={11} className="text-slate-500" />
                            </div>
                            <div className="min-w-0">
                                <div className="font-semibold text-slate-800 dark:text-slate-200 text-[9px] truncate">{a.name}</div>
                                <div className="text-slate-400 text-[8px] truncate">{a.desc}</div>
                                <div className="flex gap-1 mt-0.5">
                                    <span className="bg-slate-100 dark:bg-slate-700 text-slate-500 rounded px-1 text-[7px]">{a.tools} tools</span>
                                    {a.pii && <span className="bg-amber-100 dark:bg-amber-900/40 text-amber-600 rounded px-1 text-[7px]">PII</span>}
                                </div>
                            </div>
                        </div>
                        <div className="flex flex-col items-end gap-1 flex-shrink-0">
                            <span className={`${a.clsColor} rounded-full px-1.5 py-0.5 text-[8px] font-semibold`}>{a.cls}</span>
                            <span className="text-slate-400 text-[8px]">Score: {a.risk}</span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    </ScreenFrame>
);

// Mockup: Use Case Detail
const UseCaseDetailMockup: React.FC = () => (
    <ScreenFrame title="tavro.ai — AI-Powered Customer Support Chatbot · Use Case">
        <div className="p-3 text-[10px]">
            <div className="flex items-center justify-between mb-3">
                <div>
                    <div className="font-bold text-slate-800 dark:text-slate-200 text-xs">AI-Powered Customer Support Chatbot</div>
                    <div className="text-slate-500 dark:text-slate-400 text-[9px] mt-0.5">Owner: System Administrator</div>
                    <div className="flex gap-1 mt-1">
                        <span className="bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded-full px-2 py-0.5 text-[9px]">New</span>
                        <span className="bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 rounded-full px-2 py-0.5 text-[9px]">2 - High</span>
                    </div>
                </div>
                <div className="flex gap-1.5">
                    <div className="bg-blue-600 text-white px-2 py-1 rounded-md text-[9px] font-semibold flex items-center gap-1"><ShieldCheck size={8} />Audit</div>
                    <div className="bg-white border border-slate-300 dark:bg-slate-800 dark:border-slate-600 px-2 py-1 rounded-md text-[9px] text-slate-600 dark:text-slate-300">Edit</div>
                </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-2">
                    <div className="font-semibold text-slate-600 dark:text-slate-400 mb-1.5 flex items-center gap-1"><Bot size={9} />Currently Related Agents (2)</div>
                    {['Sentiment Agent', 'Business Data Intelligence Agent'].map(a => (
                        <div key={a} className="flex items-center justify-between py-0.5">
                            <span className="text-blue-600 dark:text-blue-400 text-[9px] truncate max-w-[110px]">{a}</span>
                            <span className="text-red-400 text-[8px] flex items-center gap-0.5 flex-shrink-0"><Unlink2 size={7} />Remove</span>
                        </div>
                    ))}
                    <div className="mt-2 border-t border-slate-100 dark:border-slate-700 pt-2">
                        <div className="text-slate-400 text-[9px] mb-1">Add Agent Relation</div>
                        <div className="flex items-center gap-1 bg-slate-50 dark:bg-slate-900 rounded border border-slate-200 dark:border-slate-700 px-1.5 py-0.5">
                            <Search size={8} className="text-slate-400" /><span className="text-slate-400">Filter agents…</span>
                        </div>
                    </div>
                </div>
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-2">
                    <div className="font-semibold text-slate-600 dark:text-slate-400 mb-1.5 flex items-center gap-1"><Workflow size={9} />Currently Related Processes (1)</div>
                    <div className="flex items-center justify-between py-0.5">
                        <span className="text-blue-600 dark:text-blue-400 text-[9px]">Customer Support Operations</span>
                        <span className="text-red-400 text-[8px] flex items-center gap-0.5"><Unlink2 size={7} />Remove</span>
                    </div>
                    <div className="mt-2 border-t border-slate-100 dark:border-slate-700 pt-2">
                        <div className="text-slate-400 text-[9px] mb-1">Add Process Relation</div>
                        <div className="flex items-center gap-1 bg-slate-50 dark:bg-slate-900 rounded border border-slate-200 dark:border-slate-700 px-1.5 py-0.5">
                            <Search size={8} className="text-slate-400" /><span className="text-slate-400">Filter processes…</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </ScreenFrame>
);

// Mockup: Agent view — Business Data Intelligence Agent (real DB record)
const AgentViewMockup: React.FC = () => (
    <ScreenFrame title="tavro.ai — Business Data Intelligence Agent · Agent">
        <div className="text-[10px]">
            <div className="flex items-center justify-between px-3 pt-3 pb-2 border-b border-slate-200 dark:border-slate-700">
                <div>
                    <div className="font-bold text-slate-800 dark:text-slate-200 text-xs">Business Data Intelligence Agent</div>
                    <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-slate-400 text-[9px]">5 tools · 5 data sources</span>
                        <span className="bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 rounded-full px-1.5 py-0.5 text-[8px] font-semibold">High Risk · 7.76</span>
                        <span className="bg-amber-50 dark:bg-amber-900/20 text-amber-600 border border-amber-200 dark:border-amber-800 rounded-full px-1.5 py-0.5 text-[8px]">PII</span>
                    </div>
                </div>
                <div className="flex gap-1.5">
                    <div className="bg-blue-600 text-white px-2 py-0.5 rounded text-[9px] font-semibold flex items-center gap-0.5"><FlaskConical size={8} />Playground</div>
                    <div className="bg-blue-600 text-white px-2 py-0.5 rounded text-[9px] font-semibold flex items-center gap-0.5"><ShieldAlert size={8} />Risk Assessment</div>
                    <div className="bg-blue-600 text-white px-2 py-0.5 rounded text-[9px] font-semibold flex items-center gap-0.5"><ShieldCheck size={8} />Audit</div>
                </div>
            </div>
            <div className="flex border-b border-slate-200 dark:border-slate-700 px-3">
                {['Overview', 'Context Graph', 'Related'].map((tab, i) => (
                    <div key={tab} className={`px-3 py-2 text-[9px] font-semibold border-b-2 ${i === 1 ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-500'}`}>{tab}</div>
                ))}
            </div>
            {/* Context Graph — real rings: Technical (blue), Functional (purple), Business (orange), Risk (rose) */}
            <div className="p-3 flex items-center justify-center bg-slate-50 dark:bg-slate-900/50">
                <div className="relative w-56 h-36">
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-20 h-9 bg-slate-700 dark:bg-slate-600 rounded-xl flex items-center justify-center z-10 border-2 border-slate-500">
                        <span className="text-white text-[7px] font-bold text-center leading-tight px-1">Business Data<br/>Intelligence</span>
                    </div>
                    {[
                        { label: '5 Tools', color: 'bg-blue-500',   top: '6%',  left: '12%' },
                        { label: 'Analytics DB', color: 'bg-blue-400', top: '6%', right: '12%' },
                        { label: '5 Data Sources', color: 'bg-violet-500', top: '42%', left: '0%' },
                        { label: 'Data Platform', color: 'bg-orange-500', top: '42%', right: '0%' },
                        { label: 'Risk: 7.76 High', color: 'bg-rose-500', bottom: '6%', left: '12%' },
                        { label: 'PII Exposure', color: 'bg-rose-400', bottom: '6%', right: '12%' },
                    ].map(n => (
                        <div key={n.label} className="absolute flex items-center justify-center z-10"
                            style={{ top: n.top, bottom: (n as any).bottom, left: (n as any).left, right: (n as any).right }}>
                            <div className={`${n.color} text-white rounded-md px-1.5 py-0.5 text-[7px] font-semibold shadow-sm whitespace-nowrap`}>{n.label}</div>
                        </div>
                    ))}
                    <svg className="absolute inset-0 w-full h-full" style={{ zIndex: 5 }}>
                        {[[112,70, 44,16],[112,70,180,16],[112,70,8,56],[112,70,216,56],[112,70,44,124],[112,70,180,124]].map(([x1,y1,x2,y2],i) => (
                            <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#94a3b8" strokeWidth="0.6" strokeDasharray="2,2"/>
                        ))}
                    </svg>
                </div>
            </div>
        </div>
    </ScreenFrame>
);

// Mockup: Risk Score Breakdown — real AIVSS data from ColdChain AI agent
const RiskScoreMockup: React.FC = () => (
    <ScreenFrame title="tavro.ai — Risk Assessment · ColdChain AI — Perishable Intelligence Agent" subtitle="AIVSS 4.65 · Medium">
        <div className="p-3 text-[10px]">
            <div className="grid grid-cols-3 gap-2 mb-3">
                {[
                    { label: 'Blended Risk', value: '4.56', cls: 'Medium', color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-700' },
                    { label: 'AIVSS Score', value: '4.65', cls: 'Medium', color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-700' },
                    { label: 'Regulatory', value: 'Other', cls: 'EU AI Act', color: 'text-slate-600 dark:text-slate-300', bg: 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-600' },
                ].map(s => (
                    <div key={s.label} className={`rounded-xl border p-2 ${s.bg}`}>
                        <div className="text-slate-500 dark:text-slate-400 text-[8px] mb-0.5">{s.label}</div>
                        <div className={`font-bold text-sm ${s.color}`}>{s.value}</div>
                        <div className="text-slate-400 text-[8px]">{s.cls}</div>
                    </div>
                ))}
            </div>
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-2 mb-2">
                <div className="font-semibold text-slate-600 dark:text-slate-400 mb-2 text-[9px]">AIVSS Capability Breakdown</div>
                {[
                    { cap: 'Autonomy of Action', score: 0.50, note: 'Human approval required for irreversible actions' },
                    { cap: 'Goal-Driven Planning', score: 0.50, note: '7-day demand forecasts, multi-step plans' },
                    { cap: 'Non-Determinism',     score: 0.50, note: 'Hybrid structured + natural language output' },
                    { cap: 'Opacity & Reflexivity',score: 0.50, note: 'Summarized internal reasoning' },
                    { cap: 'Contextual Awareness', score: 0.00, note: 'No unfiltered external data access' },
                    { cap: 'Memory Use',            score: 0.00, note: 'Stateless / ephemeral processing' },
                ].map(row => (
                    <div key={row.cap} className="flex items-center gap-2 mb-1">
                        <div className="w-28 text-slate-600 dark:text-slate-400 text-[8px] flex-shrink-0">{row.cap}</div>
                        <div className="flex-1 bg-slate-100 dark:bg-slate-700 rounded-full h-1.5">
                            <div className={`h-1.5 rounded-full ${row.score > 0 ? 'bg-amber-400' : 'bg-slate-300 dark:bg-slate-600'}`} style={{ width: `${row.score * 100}%` }} />
                        </div>
                        <div className="w-6 text-right text-slate-500 dark:text-slate-400 text-[8px]">{row.score.toFixed(2)}</div>
                        <div className="w-32 text-slate-400 text-[7px] truncate">{row.note}</div>
                    </div>
                ))}
            </div>
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-2">
                <div className="font-semibold text-slate-600 dark:text-slate-400 mb-1.5 text-[9px]">Top Scenario Risks (OWASP)</div>
                {[
                    { scenario: 'Agent Supply Chain & Dependency Attacks', score: '5.45', color: 'text-amber-600' },
                    { scenario: 'Insecure Critical Systems Interaction',    score: '4.65', color: 'text-amber-500' },
                    { scenario: 'Agent Memory & Context Manipulation',      score: '4.55', color: 'text-amber-500' },
                ].map(r => (
                    <div key={r.scenario} className="flex items-center justify-between py-0.5">
                        <span className="text-slate-600 dark:text-slate-400 text-[8px]">{r.scenario}</span>
                        <span className={`font-bold text-[9px] ${r.color}`}>{r.score}</span>
                    </div>
                ))}
            </div>
        </div>
    </ScreenFrame>
);



// Mockup: Spark
const SparkMockup: React.FC = () => (
    <ScreenFrame title="tavro.ai — Spark">
        <div className="p-3 text-[10px]">
            <div className="flex items-center justify-between mb-2">
                <div>
                    <div className="font-bold text-slate-800 dark:text-slate-200 text-xs flex items-center gap-1.5"><Zap size={12} className="text-violet-500" />Spark</div>
                    <div className="text-slate-400 text-[9px]">6 ideas · Page 1 of 1</div>
                </div>
                <div className="bg-violet-600 text-white px-2 py-0.5 rounded text-[9px] font-semibold flex items-center gap-0.5"><Zap size={8} />Inspire Me</div>
            </div>
            <div className="flex items-center gap-2 mb-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1">
                <Hash size={8} className="text-slate-400" />
                <span className="text-slate-400">Focus direction — e.g. "Quality management"…</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
                {[{ title: 'Automated PO Matching', signal: 'Gap Coverage', signalColor: 'bg-blue-100 text-blue-700', complexity: 'Medium', impact: 'High' }, { title: 'Vendor Risk Scoring', signal: 'Risk Hotspot', signalColor: 'bg-rose-100 text-rose-700', complexity: 'High', impact: 'High' }, { title: 'Payment Terms Optimizer', signal: 'Strategic Gap', signalColor: 'bg-slate-100 text-slate-600', complexity: 'Low', impact: 'Medium' }].map(idea => (
                    <div key={idea.title} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                        <div className="h-4 bg-gradient-to-r from-violet-500 to-indigo-600" />
                        <div className="p-2">
                            <div className="font-semibold text-slate-800 dark:text-slate-200 text-[9px] leading-tight mb-1">{idea.title}</div>
                            <span className={`${idea.signalColor} text-[7px] px-1 py-0.5 rounded-full font-semibold`}>{idea.signal}</span>
                            <div className="flex justify-between mt-1.5">
                                <span className="text-slate-400 text-[7px]">Complex: {idea.complexity}</span>
                                <span className="text-slate-400 text-[7px]">Impact: {idea.impact}</span>
                            </div>
                            <div className="mt-1.5 w-full bg-violet-600 text-white rounded text-[7px] text-center py-0.5 font-semibold flex items-center justify-center gap-0.5"><ArrowRight size={7} />View &amp; Develop</div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    </ScreenFrame>
);

// Mockup: Audit Center
const AuditMockup: React.FC = () => (
    <ScreenFrame title="tavro.ai — Audit Center">
        <div className="p-3 text-[10px]">
            <div className="flex items-center justify-between mb-3">
                <div>
                    <div className="font-bold text-slate-800 dark:text-slate-200 text-xs flex items-center gap-1.5"><ShieldCheck size={12} className="text-blue-500" />Audit Center</div>
                    <div className="text-slate-400 text-[9px]">4 completed runs · 2 critical · 5 high findings</div>
                </div>
                <div className="bg-blue-600 text-white px-2 py-0.5 rounded text-[9px] font-semibold flex items-center gap-0.5"><ShieldCheck size={8} />New Audit</div>
            </div>
            <div className="space-y-1.5">
                {[
                    { name: 'AI Customer Support Chatbot', vs: 'vs. EU AI Act', risk: 'Medium', riskColor: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300', pct: 100, status: '✓' },
                    { name: 'Large-Scale Data Processing', vs: 'vs. GDPR', risk: 'High', riskColor: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300', pct: 72, status: '⟳', live: true },
                    { name: 'Business Data Intelligence Agent', vs: 'vs. EU AI Act', risk: 'High', riskColor: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300', pct: 100, status: '✓' },
                ].map(run => (
                    <div key={run.name} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-2">
                        <div className="flex items-center justify-between mb-1">
                            <div>
                                <span className={`${run.status === '⟳' ? 'text-blue-500' : 'text-emerald-500'} mr-1.5`}>{run.status}</span>
                                <span className="font-semibold text-slate-700 dark:text-slate-300">{run.name}</span>
                                <span className="text-slate-400 ml-1">{run.vs}</span>
                            </div>
                            <span className={`${run.riskColor} rounded-full px-1.5 py-0.5 text-[8px] font-semibold`}>{run.risk}</span>
                        </div>
                        <div className="w-full bg-slate-100 dark:bg-slate-700 rounded-full h-1">
                            <div className="bg-blue-500 h-1 rounded-full" style={{ width: `${run.pct}%` }} />
                        </div>
                        {run.live && <div className="text-[8px] text-blue-500 mt-0.5 animate-pulse">● 3 findings so far…</div>}
                    </div>
                ))}
            </div>
        </div>
    </ScreenFrame>
);



// ─── Flow Diagram ─────────────────────────────────────────────────────────────

const FlowDiagram: React.FC<{ steps: { icon: React.ReactNode; label: string; color: string }[] }> = ({ steps }) => (
    <div className="flex items-center flex-wrap gap-2 my-5 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-700">
        {steps.map((step, i) => (
            <React.Fragment key={step.label}>
                <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${step.color} text-sm font-semibold`}>
                    <span className="flex-shrink-0">{step.icon}</span>
                    <span>{step.label}</span>
                </div>
                {i < steps.length - 1 && <ArrowRight size={16} className="text-slate-400 flex-shrink-0" />}
            </React.Fragment>
        ))}
    </div>
);

// ─── TOC Data ─────────────────────────────────────────────────────────────────

const TOC_SECTIONS: TocSection[] = [
    {
        id: 'nav-overview', label: 'Navigation', icon: <Layers size={14} />,
        children: [            
            { id: 'nav-sidebar', label: 'Navigation Sidebar' },
            { id: 'three-panel', label: 'Layout' },
        ],
    },
    {
        id: 'use-case-discovery', label: 'Use Case Discovery', icon: <ClipboardList size={14} />,
        children: [
            { id: 'uc-via-ui', label: 'Creating via the UI' },
            { id: 'uc-via-ai', label: 'Discovering via AI Assistant' },
        ],
    },
    {
        id: 'agents-blueprint', label: 'Use Case → Agent → Blueprint', icon: <Bot size={14} />,
        children: [
            { id: 'linking-agents', label: 'Linking Agents to a Use Case' },
            { id: 'agent-detail', label: 'Exploring Agent Detail' },
            { id: 'context-graph', label: 'Agent Context Graph' },
            { id: 'blueprint-map', label: 'Blueprint Organization Map' },
        ],
    },
    {
        id: 'risk-analysis', label: 'Risk Analysis', icon: <ShieldCheck size={14} />,
        children: [
            { id: 'agent-risk', label: 'Agent Risk Assessment' },
            { id: 'compliance-audit', label: 'Running a Compliance Audit' },
            { id: 'reading-findings', label: 'Reading Audit Findings' },
        ],
    },
    {
        id: 'playground', label: 'Agent Playground', icon: <FlaskConical size={14} />,
        children: [
            { id: 'pg-launch', label: 'Launching from an Agent' },
            { id: 'pg-configure', label: 'Configuring the Agent' },
            { id: 'pg-interact', label: 'Running a Test Session' },
            { id: 'pg-observations', label: 'Observations & Summary' },
        ],
    },
    {
        id: 'spark', label: 'Spark — AI Ideas', icon: <Zap size={14} />,
        children: [
            { id: 'spark-generate', label: 'Generating Ideas' },
            { id: 'spark-convert', label: 'Converting to a Use Case' },
        ],
    },
    {
        id: 'settings-overview', label: 'Settings', icon: <Settings size={14} />,
        children: [
            { id: 'llm-setup', label: 'LLM Provider Setup' },
            { id: 'theme', label: 'Appearance & Dev Tools' },
        ],
    },
];

// ─── Main Component ───────────────────────────────────────────────────────────

const UserGuidePage: React.FC = () => {
    const [activeSection, setActiveSection] = useState('nav-overview');
    const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(TOC_SECTIONS.map(s => s.id)));
    const [searchQuery, setSearchQuery] = useState('');
    const contentRef = useRef<HTMLDivElement>(null);

    const toggleSection = (id: string) => {
        setExpandedSections(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    };

    const scrollTo = useCallback((id: string) => {
        const el = document.getElementById(id);
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            setActiveSection(id);
        }
    }, []);

    useEffect(() => {
        const observer = new IntersectionObserver(
            entries => { for (const e of entries) { if (e.isIntersecting) setActiveSection(e.target.id); } },
            { rootMargin: '-15% 0px -75% 0px', threshold: 0 }
        );
        const els = contentRef.current?.querySelectorAll('[id]') ?? [];
        els.forEach(el => observer.observe(el));
        return () => observer.disconnect();
    }, []);

    const filteredToc = searchQuery.trim()
        ? TOC_SECTIONS.map(s => ({ ...s, children: s.children?.filter(c => c.label.toLowerCase().includes(searchQuery.toLowerCase())) })).filter(s => s.label.toLowerCase().includes(searchQuery.toLowerCase()) || (s.children && s.children.length > 0))
        : TOC_SECTIONS;

    return (
        <div className="flex gap-0 h-screen overflow-hidden bg-white dark:bg-slate-950">

            {/* ── Left TOC ──────────────────────────────────────────────────── */}
            <aside className="w-[255px] flex-shrink-0 h-screen overflow-y-auto border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                <div className="p-4">
                    {/* Header */}
                    <div className="flex items-center gap-2.5 mb-4 pb-3 border-b border-slate-100 dark:border-slate-800">
                        <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center flex-shrink-0">
                            <BookOpen size={15} className="text-white" />
                        </div>
                        <div>
                            <p className="text-sm font-bold text-slate-900 dark:text-white leading-none">User Guide</p>
                            <p className="text-[10px] text-slate-400 mt-0.5">Tavro Agent BizOps · v3.1</p>
                        </div>
                    </div>

                    {/* Search */}
                    <div className="relative mb-4">
                        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            placeholder="Search guide…"
                            className="w-full pl-8 pr-7 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 placeholder-slate-400 outline-none focus:border-blue-400 transition-colors"
                        />
                        {searchQuery && <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X size={12} /></button>}
                    </div>

                    {/* TOC Nav */}
                    <nav className="space-y-0.5">
                        {filteredToc.map(section => (
                            <div key={section.id}>
                                <div className="flex items-center">
                                    <button
                                        onClick={() => scrollTo(section.id)}
                                        className={`flex-1 flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-semibold transition-colors text-left ${activeSection === section.id ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'}`}
                                    >
                                        <span className="flex-shrink-0 opacity-70">{section.icon}</span>
                                        {section.label}
                                    </button>
                                    {section.children && (
                                        <button onClick={() => toggleSection(section.id)} className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                                            {expandedSections.has(section.id) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                        </button>
                                    )}
                                </div>
                                {section.children && expandedSections.has(section.id) && (
                                    <div className="ml-4 mt-0.5 space-y-0.5 border-l border-slate-100 dark:border-slate-800 pl-3">
                                        {section.children.map(child => (
                                            <button
                                                key={child.id}
                                                onClick={() => scrollTo(child.id)}
                                                className={`w-full text-left px-2 py-1.5 rounded-md text-[11px] transition-colors ${activeSection === child.id ? 'text-blue-600 dark:text-blue-400 font-semibold' : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 font-medium'}`}
                                            >
                                                {child.label}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}
                    </nav>
                </div>
            </aside>

            {/* ── Main Content ──────────────────────────────────────────────── */}
            <div ref={contentRef} className="flex-1 overflow-y-auto">
                <div className="max-w-4xl mx-auto px-10 py-8 pb-24">

                    {/* Hero Banner */}
                    <div className="mb-10 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 p-7 text-white">
                        <div className="flex items-start justify-between">
                            <div>
                                <div className="flex items-center gap-2 mb-3">
                                    <span className="bg-white/20 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">v3.1</span>
                                    <span className="bg-white/20 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">User Guide</span>
                                </div>
                                <h1 className="text-2xl font-extrabold mb-2 leading-tight">Tavro Agent BizOps</h1>
                                <p className="text-blue-100 text-sm leading-relaxed max-w-xl">
                                    Your step-by-step guide to navigating the portal — from discovering AI use cases and building your agent roster, to mapping your organization's digital twin and running compliance audits.
                                </p>
                            </div>
                            <BookOpen size={48} className="text-white/20 flex-shrink-0" />
                        </div>                        
                    </div>


                    {/* ════════════════════════════════════════════════════════
                        1 · PORTAL NAVIGATION
                    ════════════════════════════════════════════════════════ */}
                    <SectionHeading id="nav-overview" level={2} icon={<Layers size={18} />}>Portal Navigation</SectionHeading>                 

                    
                    <div className="grid grid-cols-3 gap-3 mt-4">
                        {[
                            { title: 'Left Sidebar', color: 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30', desc: 'Primary navigation — links to every module. Collapse it using the chevron button on its right edge to gain more space. Collapsed icons show tooltips on hover.' },
                            { title: 'Main Content', color: 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/30', desc: 'Where all page content renders — use case lists, agent details, blueprint graphs, audit results. Scrolls independently of both sidebars.' },
                            { title: 'Right Panel', color: 'border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/30', desc: 'Contextual workspace — AI Chat, Dev Logs, and Attachments. Stays open while you work. Resize by dragging the left edge of the panel.' },
                        ].map(z => (
                            <div key={z.title} className={`rounded-xl border p-3.5 ${z.color}`}>
                                <p className="text-xs font-bold text-slate-800 dark:text-slate-200 mb-1.5">{z.title}</p>
                                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">{z.desc}</p>
                            </div>
                        ))}
                    </div>

                    <SectionHeading id="nav-sidebar" level={3}>Navigation Sidebar</SectionHeading>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-3 leading-relaxed">
                        Every module is one click away from the left sidebar. Here's what each entry does:
                    </p>
                    <div className="grid grid-cols-2 gap-2 my-4">
                        {[
                            { icon: <Home size={14} />, path: '/', label: 'Home', desc: 'Landing dashboard with quick access to key modules' },
                            { icon: <ClipboardList size={14} />, path: '/use-cases', label: 'AI Use Cases', desc: 'All AI initiatives — create, browse, link to agents & processes' },
                            { icon: <Bot size={14} />, path: '/catalog', label: 'Agents', desc: 'Full agent catalog with risk scores and governance status' },
                            { icon: <AppWindow size={14} />, path: '/applications', label: 'Applications', desc: 'Software systems your agents interact with' },
                            { icon: <Workflow size={14} />, path: '/processes', label: 'Processes', desc: 'Business workflows and their AI exposure' },
                            { icon: <Plug size={14} />, path: '/integrations', label: 'Integrations', desc: 'APIs and connectors used by agents' },
                            { icon: <Zap size={14} className="text-violet-500" />, path: '/spark', label: 'Spark', desc: 'AI-generated use case ideas from your business context' },
                            { icon: <BarChart2 size={14} />, path: '/insights', label: 'Insights', desc: 'Cross-portfolio risk and coverage analytics' },
                            { icon: <Network size={14} />, path: '/blueprint', label: 'Blueprint', desc: 'Interactive digital twin graph of your organization' },
                            { icon: <Scale size={14} />, path: '/compliance', label: 'Compliance', desc: 'Regulations and internal policies with gap tracking' },
                            { icon: <ShieldCheck size={14} />, path: '/audit', label: 'Audit Center', desc: 'AI-powered compliance audits with live streaming results' },
                            { icon: <FlaskConical size={14} />, path: '/playground', label: 'Agent Playground', desc: 'Prototype and test agents before committing to the catalog' },
                        ].map(item => (
                            <div key={item.path} className="flex items-start gap-3 p-3 rounded-xl bg-white dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 hover:border-slate-200 dark:hover:border-slate-700 transition-colors">
                                <div className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center flex-shrink-0 text-slate-500 dark:text-slate-400 mt-0.5">{item.icon}</div>
                                <div>
                                    <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">{item.label} <span className="text-slate-400 font-normal">{item.path}</span></div>
                                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{item.desc}</div>
                                </div>
                            </div>
                        ))}
                    </div>


                    {/* ════════════════════════════════════════════════════════
                        2 · USE CASE DISCOVERY
                    ════════════════════════════════════════════════════════ */}
                    <SectionHeading id="use-case-discovery" level={2} icon={<ClipboardList size={18} />}>Use Case Discovery</SectionHeading>
                    <SectionHeading id="three-panel" level={3}>Layout</SectionHeading>
                    <LayoutMockup />
                    <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-4">
                        A <strong className="text-slate-800 dark:text-slate-200">Use Case</strong> is the starting point for every AI initiative in Tavro. It documents the business problem, expected benefits, and priority — and acts as the anchor that links agents, processes, applications, and compliance rules together. There are two ways to create one.
                    </p>

                    <SectionHeading id="uc-via-ui" level={3}>Path 1 — Creating a Use Case via the UI</SectionHeading>                    
                    <FlowDiagram steps={[
                        { icon: <ClipboardList size={14} />, label: 'AI Use Cases', color: 'bg-blue-50 border-blue-200 text-blue-700' },
                        { icon: <Plus size={14} />, label: '+ New Use Case', color: 'bg-blue-50 border-blue-200 text-blue-700' },
                        { icon: <Settings2 size={14} />, label: 'Fill Details', color: 'bg-slate-50 border-slate-200 text-slate-700' },
                        { icon: <Link2 size={14} />, label: 'Link Entities', color: 'bg-slate-50 border-slate-200 text-slate-700' },
                        { icon: <CheckCircle2 size={14} />, label: 'Save', color: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
                    ]} />
                    <Step n={1} title="Navigate to AI Use Cases">
                        Click <strong>AI Use Cases</strong> in the left sidebar. You'll see a grid of all existing initiatives with their status and priority badges.
                    </Step>
                    <Step n={2} title="Open the creation form">
                        Click the <UIButton color="blue" icon={<Plus size={10} />}>New Use Case</UIButton> button in the top-right of the page.
                    </Step>
                    <Step n={3} title="Fill in the required fields">
                        <div className="mt-2 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                            <table className="w-full text-xs">
                                <thead><tr className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700"><th className="text-left px-3 py-2 text-slate-500 font-semibold">Field</th><th className="text-left px-3 py-2 text-slate-500 font-semibold">What to enter</th></tr></thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                    {[
                                        ['Title', '"AI-Powered Customer Support Chatbot"'],
                                        ['Problem Statement', '"Customer support teams face high volumes of repetitive queries, leading to long response times, increased operational costs, and inconsistent customer experiences."'],
                                        ['Expected Benefits', '"Reduced response time (instant replies), lower operational costs, improved customer satisfaction, 24/7 availability, allows human agents to focus on complex interactions."'],
                                        ['Priority', '2 - High (drives ordering in the catalog)'],
                                        ['Status', 'New — use Proposed for ideas, Active once approved, In Review if under evaluation'],
                                        ['Function', 'Customer Operations / Support'],
                                    ].map(([f, d]) => (
                                        <tr key={f} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30"><td className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap">{f}</td><td className="px-3 py-2 text-slate-500 dark:text-slate-400">{d}</td></tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </Step>
                    <Step n={4} title="Save and open the detail view">
                        Click <UIButton color="blue">Save</UIButton>. You'll land on the Use Case detail page where you can link agents, processes Under Business Imapc
                    </Step>

                    <SectionHeading id="uc-via-ai" level={3}>Path 2 — Creating AI use cases via the AI Assistant</SectionHeading>
                        Click the <UIButton color="slate" icon={<MessageCircle size={10} />}>Chat</UIButton> button in the right rail (the icon column on the far right). The panel will expand with the AI Assistant tab active.
                     <p className="text-sm text-slate-600 dark:text-slate-400 mb-4 leading-relaxed">
                        User can pass a prompt to create AI Use cases eg. Generate a detailed AI Use Case for a supply chain organization to optimize its order management process.
                    </p>
                  
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-4 leading-relaxed">
                        The AI Assistant is context-aware — it knows which page you're on and what data is loaded. You can use it to brainstorm, identify gaps, and even ask it to draft use case content for you.
                    </p>
                    <Step n={1} title="Open the AI Assistant">
                        Click the <UIButton color="slate" icon={<MessageCircle size={10} />}>Chat</UIButton> button in the right rail (the icon column on the far right). The panel will expand with the AI Assistant tab active.
                    </Step>
                    <Step n={2} title="Ask a discovery question">
                        Try prompts like:
                        <div className="mt-2 space-y-1.5">
                            {['"Which use cases are highest priority?"', '"We have an agent for invoice processing — what related use cases are we missing?"', '"Suggest 3 high-priority AI initiatives for a mid-size manufacturing company."'].map(p => (
                                <div key={p} className="flex items-start gap-2 bg-slate-800 text-slate-100 rounded-lg px-3 py-2 text-xs font-mono">{p}</div>
                            ))}
                        </div>
                    </Step>                    
                    <Callout type="tip" title="Spark for Structured AI Ideas">
                        For a more structured approach, use <strong>Spark</strong> (left sidebar → Spark). It analyzes your entire Blueprint and automatically generates prioritized use case ideas — see the <em>Spark</em> section below.
                    </Callout>


                    {/* ════════════════════════════════════════════════════════
                        3 · AGENTS → BLUEPRINT
                    ════════════════════════════════════════════════════════ */}
                    <SectionHeading id="agents-blueprint" level={2} icon={<Bot size={18} />}>Use Case → Agent → Blueprint</SectionHeading>
                    <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-4">
                        Once a use case exists, the next step is to populate it with agents. 
                    </p>
                    <FlowDiagram steps={[
                        { icon: <ClipboardList size={14} />, label: 'Use Case', color: 'bg-blue-50 border-blue-200 text-blue-700' },
                        { icon: <Link2 size={14} />, label: 'Link Agents', color: 'bg-blue-50 border-blue-200 text-blue-700' },
                        { icon: <Bot size={14} />, label: 'Agent Detail', color: 'bg-slate-50 border-slate-200 text-slate-700' }
                    ]} />

                    <SectionHeading id="linking-agents" level={3}>Linking Agents to a Use Case</SectionHeading>                    
                    <AgentCatalogMockup />
                    <UseCaseDetailMockup />
                    <Step n={1} title="Open the Use Case">
                        From <strong>AI Use Cases</strong>, click <em>AI-Powered Customer Support Chatbot</em>. You'll see its detail page with two relationship sections: <em>Currently Related Agents</em> and <em>Business Imapact Currently Related Processes</em>.
                    </Step>
                    <Step n={2} title="Find an agent to link">
                        Under <strong>Add Agent Relation</strong>, use the <UIButton color="slate" icon={<Search size={10} />}>Filter agents…</UIButton> search box to find an agent by name.
                    </Step>
                    <Step n={3} title="Link the agent">
                        Click the <UIButton color="blue" icon={<PlusCircle size={10} />}>Link</UIButton> button next to the agent. It moves immediately into the <em>Currently Related Agents</em> section above.
                    </Step>
                    <Step n={4} title="Link related processes">
                        Repeat for the <strong>Add Process Relation</strong> section. Use <UIButton color="blue" icon={<PlusCircle size={10} />}>Create Process</UIButton> if the process doesn't exist yet — it opens the process form with the use case pre-filled.
                    </Step>
                    <Callout type="info" title="Unlinking">
                        To remove a relationship, click the <UIButton color="red" icon={<Unlink2 size={10} />}>Remove</UIButton> button next to the agent or process. The change is immediate.
                    </Callout>

                    <SectionHeading id="agent-detail" level={3}>Exploring Agent Detail</SectionHeading>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-3 leading-relaxed">
                        Click any agent name in the <em>Currently Related Agents</em> list to open its full detail page. The agent page has three key tabs:
                    </p>
                    <div className="grid grid-cols-3 gap-2 my-4">
                        {[
                            { tab: 'Overview', desc: 'Role, instructions, goal, environment, owner, governance status, and key governance tags. This is the agent\'s identity card.' },
                            { tab: 'Context Graph', desc: 'An interactive radial graph showing every connection this agent has — tools, data sources, applications, processes, use cases, and risk scores.' },
            
                        ].map(t => (
                            <div key={t.tab} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-3.5">
                                <div className="text-xs font-bold text-blue-600 dark:text-blue-400 mb-1.5">{t.tab}</div>
                                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">{t.desc}</p>
                            </div>
                        ))}
                    </div>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-3 leading-relaxed">
                        From the agent page you can also trigger key actions using the buttons in the top-right:
                    </p>
                    <div className="flex flex-wrap gap-2 mb-4">
                        <UIButton color="blue" icon={<FlaskConical size={10} />}>Playground</UIButton>
                        <UIButton color="blue" icon={<ShieldAlert size={10} />}>Risk Assessment</UIButton>
                        <UIButton color="blue" icon={<ShieldCheck size={10} />}>Audit</UIButton>
                        <UIButton color="slate">Edit</UIButton>
                        <UIButton color="red">Delete</UIButton>
                    </div>

                    <SectionHeading id="context-graph" level={3}>Agent Context Graph</SectionHeading>
                    <AgentViewMockup />
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-3 leading-relaxed">
                        The <strong>Context Graph</strong> tab renders a live radial diagram of everything the agent is connected to. It's the fastest way to understand an agent's full blast radius across your organization.
                    </p>
                    <div className="grid grid-cols-2 gap-2 my-4">
                        {[
                            { ring: 'Technical', color: 'border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-800', textColor: 'text-blue-700 dark:text-blue-300', items: 'Tools the agent uses, its reasoning model, autonomy level, memory type, access scope' },
                            { ring: 'Functional', color: 'border-violet-200 bg-violet-50 dark:bg-violet-950/30 dark:border-violet-800', textColor: 'text-violet-700 dark:text-violet-300', items: 'Data sources — tables and columns the agent reads from or writes to' },
                            { ring: 'Business', color: 'border-orange-200 bg-orange-50 dark:bg-orange-950/30 dark:border-orange-800', textColor: 'text-orange-700 dark:text-orange-300', items: 'Connected applications, business processes, and AI use cases' },
                            { ring: 'Risk', color: 'border-rose-200 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-800', textColor: 'text-rose-700 dark:text-rose-300', items: 'Blended Risk score, AIVSS score, Regulatory Risk classification' },
                        ].map(r => (
                            <div key={r.ring} className={`rounded-xl border p-3.5 ${r.color}`}>
                                <p className={`text-xs font-bold mb-1 ${r.textColor}`}>{r.ring}</p>
                                <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">{r.items}</p>
                            </div>
                        ))}
                    </div>
                    <Callout type="tip" title="Navigate from the Graph">
                        Every leaf node in the Context Graph is clickable. Clicking an Application node takes you to that application's detail page; clicking a Use Case node takes you to the use case — making it a powerful jump-pad for cross-navigation.
                    </Callout>

                    <SectionHeading id="blueprint-map" level={3}>Blueprint — Your Organization Map</SectionHeading>                    
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-3 leading-relaxed">
                        Blueprint is Tavro's <strong>digital twin</strong> of your organization. It holds all the business dimensions — applications, processes, teams, strategy pillars, risk domains — as nodes in an interactive graph, with relationships connecting them.
                    </p>
                    <Callout type="warning" title="First-Time Setup Required">
                        Before using Blueprint, you must register your company. Navigate to <strong>Blueprint</strong> and if no company exists, click <strong>Add company</strong> in the company dropdown — it opens the setup wizard at <InlineCode>/blueprint/setup</InlineCode>.
                    </Callout>
                    <Step n={1} title="Select your company">
                        In the Blueprint header, click the company dropdown (<Building2 size={12} className="inline" /> icon) and select your organization.
                    </Step>
                    <Step n={2} title="Choose a view mode">
                        Use the <UIButton color="slate" icon={<Network size={10} />}>Graph</UIButton> / <UIButton color="slate" icon={<LayoutGrid size={10} />}>Grid</UIButton> / <UIButton color="slate" icon={<List size={10} />}>List</UIButton> toggle. Start with Graph to see the full picture, switch to Grid or List for bulk operations.
                    </Step>
                    <Step n={3} title="Add a dimension (node)">
                        Click <UIButton color="blue" icon={<Plus size={10} />}>Add dimension</UIButton>. In the modal, choose a <strong>Category</strong> (Application, Process, Risk, Strategy, etc.), enter a <strong>Label</strong> and optional <strong>Summary</strong> and <strong>Tags</strong>, then click Create.
                    </Step>
                    <Step n={4} title="Add a relationship (edge)">
                        Click <UIButton color="slate" icon={<Link2 size={10} />}>Add relationship</UIButton>. Pick the <strong>Source</strong> node, <strong>Target</strong> node, and <strong>Relationship Type</strong> (depends_on, supports, risks, enables, etc.).
                    </Step>
                    <Step n={5} title="Explore and filter">
                        In Grid or List view, use the category filter pills at the top to focus on a single dimension type. Click any node card to open the detail panel on the right and edit its summary, tags, or relationships.
                    </Step>


                    {/* ════════════════════════════════════════════════════════
                        4 · RISK ANALYSIS
                    ════════════════════════════════════════════════════════ */}
                    <SectionHeading id="risk-analysis" level={2} icon={<ShieldCheck size={18} />}>Risk Analysis</SectionHeading>
                    <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-4">
                        Tavro provides two layers of risk analysis: individual <strong>Agent Risk Assessments</strong> (AI-evaluated risk scores per agent) and <strong>Compliance Audits</strong> (AI-evaluated checks of use cases against regulations or policies).
                    </p>

                    <SectionHeading id="agent-risk" level={3}>Agent Risk Assessment</SectionHeading>                  
                    <FlowDiagram steps={[
                        { icon: <Bot size={14} />, label: 'Agent Detail', color: 'bg-blue-50 border-blue-200 text-blue-700' },
                        { icon: <ShieldAlert size={14} />, label: 'Risk Assessment', color: 'bg-blue-50 border-blue-200 text-blue-700' },
                        { icon: <RefreshCw size={14} />, label: 'Processing…', color: 'bg-amber-50 border-amber-200 text-amber-700' },
                        { icon: <CheckCircle2 size={14} />, label: 'Scores Appear', color: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
                    ]} />
                    <Step n={1} title="Open the Agent">
                        Navigate to <strong>Agents</strong> and click the <em>Sentiment Agent</em> card — its risk class shows <strong>Pending</strong> because no assessment has run yet.
                    </Step>
                    <Step n={2} title="Trigger the assessment">
                        Click <UIButton color="blue" icon={<ShieldAlert size={10} />}>Risk Assessment</UIButton> in the top-right. The button shows a spinner labeled <em>"Assessing…"</em> while the AI evaluates the agent against the EU AI Act and AIVSS framework.
                    </Step>
                    <Step n={3} title="Wait for results">
                        The assessment runs asynchronously. The agent card pulses while processing. When complete, Blended Risk, AIVSS Score, and Regulatory Risk appear in the <strong>Overview</strong> tab.
                    </Step>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-3 mt-4 leading-relaxed">
                        The assessment produces three scores. The example below shows real output from the <strong>ColdChain AI — Perishable Intelligence Agent</strong> (6 tools, 6 data sources, Medium risk):
                    </p>
                    <RiskScoreMockup />
                    <div className="grid grid-cols-3 gap-2 my-3">
                        {[
                            { label: 'Blended Risk', desc: 'Combined score: access scope, autonomy level, data sensitivity, tool capabilities. ColdChain: 4.56 Medium. Business Data Intelligence: 7.76 High.', color: 'border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800' },
                            { label: 'AIVSS Score', desc: 'AI Vulnerability Scoring System — 10 capability dimensions (autonomy, memory, tool use, multi-agent, etc.) each scored 0–1. ColdChain: 4.65. BDI Agent: 8.95.', color: 'border-rose-200 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-800' },
                            { label: 'Regulatory Risk', desc: 'EU AI Act classification — Other, High Risk, or Prohibited. Driven by PII/PHI/PCI flags and Article 5/6 evaluation. BDI Agent: High Risk (PII: Yes).', color: 'border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-800' },
                        ].map(s => (
                            <div key={s.label} className={`rounded-xl border p-3.5 ${s.color}`}>
                                <p className="text-xs font-bold text-slate-800 dark:text-slate-200 mb-1">{s.label}</p>
                                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">{s.desc}</p>
                            </div>
                        ))}
                    </div>

                    <SectionHeading id="compliance-audit" level={3}>Running a Compliance Audit</SectionHeading>
                    <AuditMockup />
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-3 leading-relaxed">
                        Compliance audits can be launched from three places: the <strong>Audit Center</strong> page, a <strong>Use Case</strong> detail page, or an <strong>Agent</strong> detail page. Results stream live as the AI processes each assessment pair.
                    </p>
                    <Step n={1} title="Open the audit dialog">
                        From any of the three locations, click <UIButton color="blue" icon={<ShieldCheck size={10} />}>Audit</UIButton> (or <UIButton color="blue" icon={<ShieldCheck size={10} />}>New Audit</UIButton> on the Audit Center page).
                    </Step>
                    <Step n={2} title="Choose your scope">
                        <div className="mt-2 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                            <table className="w-full text-xs">
                                <thead><tr className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700"><th className="text-left px-3 py-2 text-slate-500 font-semibold">Scope</th><th className="text-left px-3 py-2 text-slate-500 font-semibold">Best for</th></tr></thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                    {[['Single use case × single regulation', 'Targeted spot-check before a product launch or deployment'], ['Single use case × all regulations', 'Full compliance picture for one AI initiative'], ['All use cases × single regulation', 'Impact analysis when a new regulation comes into effect'], ['Full catalog × all regulations', 'Quarterly enterprise-wide compliance review']].map(([scope, use]) => (
                                        <tr key={scope} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30"><td className="px-3 py-2.5 text-slate-700 dark:text-slate-300 font-medium">{scope}</td><td className="px-3 py-2.5 text-slate-500 dark:text-slate-400">{use}</td></tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </Step>
                    <Step n={3} title="Select compliance items">
                        Pick the regulations or policies to audit against from the multi-select list. Your Compliance module must have items loaded — navigate to <strong>Compliance</strong> to add them first if needed.
                    </Step>
                    <Step n={4} title="Launch the audit">
                        Click <UIButton color="blue" icon={<ShieldCheck size={10} />}>Launch audit</UIButton>. The run appears in the Audit Center with a live progress bar. Findings appear in real time as the AI evaluates each pair.
                    </Step>

                    <SectionHeading id="reading-findings" level={3}>Reading Audit Findings</SectionHeading>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-3 leading-relaxed">
                        Click any completed audit run to drill into its findings report. Each finding covers one use case × compliance item pair and contains:
                    </p>
                    <div className="space-y-2 my-4">
                        {[
                            { label: 'Risk Level', badge: <Badge color="red">Critical / High / Medium / Low</Badge>, desc: 'Overall severity of the compliance exposure for this pair' },
                            { label: 'Gaps', badge: <Badge color="amber">Gap</Badge>, desc: 'Specific compliance requirements that the use case does not currently satisfy, each with a severity rating' },
                            { label: 'Compliant Areas', badge: <Badge color="green">Compliant</Badge>, desc: 'Requirements that the use case already satisfies — positive evidence for audit reporting' },
                            { label: 'Recommendations', badge: <Badge color="blue">Action Items</Badge>, desc: 'Prioritized next steps — Immediate (fix now), Short-term (within quarter), Long-term (roadmap item)' },
                        ].map(f => (
                            <div key={f.label} className="flex gap-3 p-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-800">
                                <div className="w-28 flex-shrink-0 pt-0.5">{f.badge}</div>
                                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{f.desc}</p>
                            </div>
                        ))}
                    </div>


                    {/* ════════════════════════════════════════════════════════
                        5 · PLAYGROUND
                    ════════════════════════════════════════════════════════ */}
                    <SectionHeading id="playground" level={2} icon={<FlaskConical size={18} />}>Agent Playground</SectionHeading>
                    <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-4">
                        The Playground is where you prototype and test AI agents before formally registering them in the catalog. You bring a use case or agent into a sandboxed environment, configure the agent runtime, and run test conversations to see how it behaves with real business context.
                    </p>
                    <FlowDiagram steps={[
                        { icon: <Bot size={14} />, label: 'Agent', color: 'bg-blue-50 border-blue-200 text-blue-700' },
                        { icon: <FlaskConical size={14} />, label: 'Playground button', color: 'bg-blue-50 border-blue-200 text-blue-700' },
                        { icon: <Settings2 size={14} />, label: 'Configure', color: 'bg-slate-50 border-slate-200 text-slate-700' },
                        { icon: <Play size={14} />, label: 'Start session', color: 'bg-violet-50 border-violet-200 text-violet-700' },
                        { icon: <MessageSquare size={14} />, label: 'Interact', color: 'bg-violet-50 border-violet-200 text-violet-700' },
                        { icon: <ClipboardCheck size={14} />, label: 'Summarise', color: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
                    ]} />

                    <SectionHeading id="pg-launch" level={3}>Launching from an Agent</SectionHeading>                  
                    <Step n={1} title="Open the Sentiment Agent">
                        Go to <strong>Agents</strong> → search for <em>"Sentiment Agent"</em> → click the card.
                    </Step>
                    <Step n={2} title="Click Playground">
                        Click <UIButton color="blue" icon={<FlaskConical size={10} />}>Playground</UIButton> in the top-right. The Playground opens with the agent's name and description pre-loaded from the catalog record.
                    </Step>
                    <Callout type="tip" title="Launching from the sidebar">
                        You can also open <strong>Agent Playground</strong> directly from the left sidebar to prototype a brand-new agent from scratch without a catalog record.
                    </Callout>
                    
                                    
                    <div className="space-y-3 my-4">
                        {[
                            { section: 'Infrastructure', desc: 'Choose between Claude (Anthropic) or Azure AI Foundry. For the Sentiment Agent, select Claude and pick claude-sonnet-4.' },
                            { section: 'Model', desc: 'Select the model — e.g. claude-sonnet-4, claude-opus-4.1. Options update based on the provider.' },
                            { section: 'Agent Name', desc: 'Pre-filled as "Sentiment Agent" from the catalog. This appears in the session header and downloaded transcript filename.' },
                            { section: 'System Prompt', desc: 'Write the agent\'s instructions. If your company Blueprint is loaded, Tavro automatically injects organizational context at the bottom of this prompt — you\'ll see a note confirming this.' },
                            { section: 'Temperature', desc: 'Drag the slider from 0 (Precise — deterministic responses) to 1 (Creative — more varied responses). For business-critical agents, stay at 0.1–0.3.' },
                            { section: 'Max Tokens', desc: 'Cap the response length. 1024 is good for structured extractions; 4096+ for conversational agents that need to write detailed analysis.' },
                            { section: 'Tools & Capabilities', desc: 'Toggle the checkboxes to enable tools: web_search (live internet), code_interpreter (run Python), file_search (search attached documents), blueprint_context (pull live data from your company Blueprint via MCP).' },
                        ].map(s => (
                            <div key={s.section} className="flex gap-3 text-sm">
                                <div className="w-36 flex-shrink-0 font-semibold text-slate-700 dark:text-slate-300 pt-0.5">{s.section}</div>
                                <p className="flex-1 text-slate-500 dark:text-slate-400 leading-relaxed">{s.desc}</p>
                            </div>
                        ))}
                    </div>

                    <SectionHeading id="pg-interact" level={3}>Running a Test Session</SectionHeading>
                    <Step n={1} title="Start the session">
                        Click <UIButton color="blue" icon={<Play size={10} />}>Start session</UIButton> in the header, or click <UIButton color="violet" icon={<Play size={10} />}>Start session and interact</UIButton> at the bottom of the Configure tab. The session indicator turns green.
                    </Step>
                    <Step n={2} title="Switch to the Interact tab">
                        Click the <strong>Interact</strong> tab. You'll see the message thread. Type a test message in the input box and press Send.
                    </Step>
                    <Step n={3} title="Interact naturally">
                        The agent streams responses in real time. Test it against realistic scenarios — use actual data samples if possible.
                    </Step>
                    <Step n={4} title="Export the transcript">
                        Click <UIButton color="slate">Copy transcript</UIButton> to copy to clipboard, or <UIButton color="slate">Download</UIButton> to save a <InlineCode>.txt</InlineCode> file named <em>tavro-session-{'{agentName}'}-{'{timestamp}'}.txt</em>.
                    </Step>

                    <SectionHeading id="pg-observations" level={3}>Observations &amp; Summary</SectionHeading>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-3 leading-relaxed">
                        As the agent responds, you can tag each response with a quick observation using the buttons below each assistant message. These feed into the session summary.
                    </p>
                    <div className="flex flex-wrap gap-2 my-3">
                        {[{ l: '+ Gap', c: 'rose' as const }, { l: '+ Works well', c: 'green' as const }, { l: '+ Needs info', c: 'amber' as const }, { l: '+ Unexpected', c: 'violet' as const }, { l: '+ Note', c: 'slate' as const }].map(b => <Badge key={b.l} color={b.c}>{b.l}</Badge>)}
                    </div>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-3 leading-relaxed">
                        For longer written observations, switch to the <strong>Observations</strong> tab and click <UIButton color="slate" icon={<Plus size={10} />}>Add observation</UIButton>. Select a type, write your note, and click Save.
                    </p>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-3 leading-relaxed">
                        When done, click the <strong>Summary</strong> tab. Click <UIButton color="violet" icon={<Loader2 size={10} />}>Generate session summary</UIButton> to have the AI produce a structured report:
                    </p>
                    <div className="grid grid-cols-2 gap-2 my-3">
                        {[['Overall Assessment', 'Prose summary of the agent\'s suitability'], ['Works Well', 'Capabilities confirmed during the session'], ['Gaps Found', 'Areas where the agent underperformed'], ['Recommended Next Steps', 'Numbered action items for improving the agent']].map(([title, desc]) => (
                            <div key={title} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-3">
                                <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-0.5">{title}</p>
                                <p className="text-[11px] text-slate-500 dark:text-slate-400">{desc}</p>
                            </div>
                        ))}
                    </div>
                    <Step n={5} title="End the session">
                        Click <UIButton color="rose" icon={<Play size={10} />}>End session</UIButton> in the header. The session is archived, and all observations and the summary are preserved for review.
                    </Step>


                    {/* ════════════════════════════════════════════════════════
                        6 · SPARK
                    ════════════════════════════════════════════════════════ */}
                    <SectionHeading id="spark" level={2} icon={<Zap size={18} />}>Spark — AI Idea Generation</SectionHeading>
                    <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-4">
                        Spark analyzes your company's Blueprint, existing agents, and compliance landscape to surface high-value AI use case opportunities you haven't identified yet. It's the fastest way to populate your use case backlog with data-driven ideas.
                    </p>
                    <SparkMockup />

                    <SectionHeading id="spark-generate" level={3}>Generating Ideas</SectionHeading>
                    <Step n={1} title="Navigate to Spark">
                        Click <strong>Spark</strong> in the left sidebar (violet Zap icon).
                    </Step>
                    <Step n={2} title="Optionally set a focus direction">
                        Type a focus area into the direction field (e.g. <em>"predictive maintenance"</em>, <em>"customer onboarding automation"</em>). Leave it blank to scan your entire Blueprint.
                    </Step>
                    <Step n={3} title="Optionally filter by Blueprint dimensions">
                        Click <UIButton color="slate">Filters</UIButton> to expand the dimension panel. Select specific Blueprint nodes to focus the ideation on those areas. A badge shows how many filters are active.
                    </Step>
                    <Step n={4} title="Generate">
                        Click <UIButton color="violet" icon={<Zap size={10} />}>Inspire Me</UIButton>. Spark sends your company context to Claude and streams back a set of ideas. Each idea card shows:
                        <div className="mt-2 space-y-1">
                            {[['Signal type', 'Why Spark thinks this opportunity exists (Gap Coverage, Risk Hotspot, Integration Surface, Compliance Gap, Strategic Gap)'], ['Complexity', 'Estimated implementation effort: Low / Medium / High'], ['Impact', 'Expected business impact: Low / Medium / High'], ['Similar agents', 'Agents already in your catalog that are related — avoid duplicates']].map(([f, d]) => (
                                <div key={f} className="flex gap-2 text-xs"><span className="w-28 font-semibold text-slate-700 dark:text-slate-300 flex-shrink-0">{f}</span><span className="text-slate-500 dark:text-slate-400">{d}</span></div>
                            ))}
                        </div>
                    </Step>
                    <Step n={5} title="Save interesting ideas">
                        Click the bookmark icon on a card to save it. Saved ideas appear in the <strong>Saved ideas strip</strong> at the top of the page so you can return to them later.
                    </Step>

                    <SectionHeading id="spark-convert" level={3}>Converting an Idea to a Use Case</SectionHeading>
                    <Step n={1} title="Open the idea">
                        Click <UIButton color="violet" icon={<ArrowRight size={10} />}>View &amp; Develop</UIButton> on any idea card. The idea modal opens with the full description, rationale, target dimensions, and similar agents.
                    </Step>
                    <Step n={2} title="Review the details">
                        Read the <em>Description</em>, <em>Why this matters</em> section, and the <em>Source context</em> (the Blueprint nodes that triggered this idea). Check <em>Similar agents</em> to confirm no duplicate work exists.
                    </Step>
                    <Step n={3} title="Convert to Use Case">
                        Click <UIButton color="violet" icon={<Zap size={10} />}>Convert to Use Case</UIButton>. Tavro automatically:
                        <div className="mt-2 space-y-1 text-xs text-slate-600 dark:text-slate-400">
                            <div className="flex items-center gap-2"><CheckCircle2 size={12} className="text-emerald-500 flex-shrink-0" />Enriches the idea into a full use case record via Claude</div>
                            <div className="flex items-center gap-2"><CheckCircle2 size={12} className="text-emerald-500 flex-shrink-0" />Creates the use case and navigates you directly to it</div>
                            <div className="flex items-center gap-2"><CheckCircle2 size={12} className="text-emerald-500 flex-shrink-0" />Attempts to create and pre-link a suggested agent (best-effort)</div>
                        </div>
                    </Step>
                    <Step n={4} title="Refine the use case">
                        On the new use case page, review the AI-generated content, edit any fields that need adjusting, and link additional agents, processes, and applications as described in the <em>Use Case → Agent → Blueprint</em> section.
                    </Step>


                    {/* ════════════════════════════════════════════════════════
                        7 · SETTINGS
                    ════════════════════════════════════════════════════════ */}
                    <SectionHeading id="settings-overview" level={2} icon={<Settings size={18} />}>Settings</SectionHeading>
                    <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed mb-4">
                        Access Settings via the bottom of the left sidebar. It has four sections that control how Tavro behaves for you personally.
                    </p>

                    <SectionHeading id="llm-setup" level={3}>LLM Provider Setup</SectionHeading>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-3 leading-relaxed">
                        The AI Assistant in the right panel uses the LLM you configure here. Tavro currently supports the <strong>Copilot SDK</strong> provider with four backend options:
                    </p>
                    <div className="grid grid-cols-2 gap-2 my-3">
                        {[['GitHub Copilot', 'API Key + Model', 'Default: gpt-4.1'], ['OpenAI', 'API Key + Model', 'gpt-4o, gpt-5.5'], ['Azure OpenAI', 'API Key + Base URL + Model', 'Your Azure resource endpoint'], ['Anthropic', 'API Key + Model', 'claude-sonnet-4-6, claude-sonnet-4-5']].map(([name, fields, note]) => (
                            <div key={name} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-3">
                                <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">{name}</p>
                                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{fields}</p>
                                <p className="text-[10px] text-blue-500 dark:text-blue-400 mt-0.5">{note}</p>
                            </div>
                        ))}
                    </div>
                    <Step n={1} title="Expand the Copilot SDK card">In Settings → Chat AI Configuration, click the provider card to expand it.</Step>
                    <Step n={2} title="Choose your backend type">Select GitHub / OpenAI / Azure / Anthropic from the Provider Type selector.</Step>
                    <Step n={3} title="Enter credentials">Fill in the API Key (and Base URL if Azure). Use the eye icon to reveal/hide the key.</Step>
                    <Step n={4} title="Activate">Click <UIButton color="blue">Save</UIButton>, then click <UIButton color="blue">Use this LLM</UIButton>. The AI Assistant will now use this provider.</Step>

                    <SectionHeading id="theme" level={3}>Appearance &amp; Developer Tools</SectionHeading>
                    <div className="grid grid-cols-2 gap-3 my-3">
                        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
                            <p className="text-xs font-bold text-slate-800 dark:text-slate-200 mb-2">Theme</p>
                            <div className="space-y-1 text-xs text-slate-600 dark:text-slate-400">
                                <div className="flex items-center gap-2"><span className="w-16 font-semibold">Light</span>White/slate — best for bright environments</div>
                                <div className="flex items-center gap-2"><span className="w-16 font-semibold">Dark</span>Reduced eye strain for low-light work</div>
                                <div className="flex items-center gap-2"><span className="w-16 font-semibold">System</span>Follows your OS light/dark setting</div>
                            </div>
                        </div>
                        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
                            <p className="text-xs font-bold text-slate-800 dark:text-slate-200 mb-2">Developer Settings</p>
                            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                                Toggle <strong>Show Logs</strong> to enable the <strong>Dev Logs</strong> tab in the right panel. It shows a live stream of MCP calls, API events, and auth activity — useful for diagnosing connection issues.
                            </p>
                        </div>
                    </div>

                    {/* Contact */}
                    <div className="mt-16 rounded-2xl bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/40 dark:to-indigo-950/40 border border-blue-100 dark:border-blue-900 px-8 py-6 flex items-center justify-between gap-6">
                        <div>
                            <p className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-1">Have a question?</p>
                            <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                                For any queries, feedback, or support requests, please reach out to us at{' '}
                                <a href="mailto:info@tavro.ai" className="text-blue-600 dark:text-blue-400 font-semibold hover:underline">
                                    info@tavro.ai
                                </a>
                            </p>
                        </div>
                        <a
                            href="mailto:info@tavro.ai"
                            className="flex-shrink-0 flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors"
                        >
                            <Globe size={14} />
                            Contact Support
                        </a>
                    </div>

                    {/* Footer */}
                    <div className="mt-6 pt-6 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
                        <div>
                            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Tavro Agent BizOps · User Guide</p>
                            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">v3.1 · © 2026 Tavro AI</p>
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-slate-400">
                            <Globe size={12} /><span>tavro.ai</span>
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
};

export default UserGuidePage;
