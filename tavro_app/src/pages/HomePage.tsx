import React, { useEffect, useState } from 'react';
import {
  ClipboardList, Map, Layers, Cpu, Zap, Activity, ArrowRight,
  TrendingUp, AlertCircle, Bot, X, ArrowUpRight,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useChatContext } from '../context/ChatContext';
import travoLogo from '../assets/travo_logo.png';

const STAGES = [
  { id: 'blueprint', label: 'Blueprint', Icon: Map, route: '/blueprint' },
  { id: 'spark', label: 'Spark', Icon: Zap, route: '/spark' },
  { id: 'plan', label: 'Plan', Icon: ClipboardList, route: '/use-cases' },
  { id: 'build', label: 'Build', Icon: Cpu, route: '/catalog' },
  { id: 'deploy', label: 'Deploy', Icon: Layers, route: null },
  { id: 'govern', label: 'Govern', Icon: Activity, route: '/compliance' },
];

const STATS = [
  {
    label: 'Spark Ideas',
    value: 84,
    sub: '+12 this week',
    subColor: 'text-emerald-600 dark:text-emerald-400',
    Icon: Zap,
    iconColor: 'text-violet-600 dark:text-violet-400',
    iconBg: 'bg-violet-50 dark:bg-violet-900/20',
  },
  {
    label: 'AI Use Cases',
    value: 52,
    sub: '8 in progress',
    subColor: 'text-slate-500 dark:text-slate-400',
    Icon: ClipboardList,
    iconColor: 'text-blue-600 dark:text-blue-400',
    iconBg: 'bg-blue-50 dark:bg-blue-900/20',
  },
  {
    label: 'Active Agents',
    value: 84,
    sub: '6 live in prod',
    subColor: 'text-emerald-600 dark:text-emerald-400',
    Icon: Bot,
    iconColor: 'text-purple-600 dark:text-purple-400',
    iconBg: 'bg-purple-50 dark:bg-purple-900/20',
  },
  {
    label: 'Open Issues',
    value: 3,
    sub: '2 need review',
    subColor: 'text-rose-600 dark:text-rose-400',
    Icon: AlertCircle,
    iconColor: 'text-rose-600 dark:text-rose-400',
    iconBg: 'bg-rose-50 dark:bg-rose-900/20',
  },
];

const RECENT_ACTIVITY = [
  { id: 1, text: 'Invoice automation moved to Design stage', time: '2h ago', dot: 'bg-violet-500' },
  { id: 2, text: '3 new Spark ideas generated', time: '5h ago', dot: 'bg-emerald-500' },
  { id: 3, text: 'HR onboarding agent - risk flag raised', time: 'Yesterday', dot: 'bg-amber-500' },
  { id: 4, text: 'Procurement agent deployed to production', time: '2 days ago', dot: 'bg-emerald-500' },
];

const ATTENTION_ITEMS = [
  {
    id: 1,
    badge: 'Risk',
    badgeClass: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    text: 'HR onboarding agent - autonomy level review required',
    action: 'Review',
    route: '/catalog',
  },
  {
    id: 2,
    badge: 'Approval',
    badgeClass: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
    text: 'Invoice automation - stakeholder sign-off pending',
    action: 'Review',
    route: '/use-cases',
  },
  {
    id: 3,
    badge: 'Issue',
    badgeClass: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400',
    text: 'Procurement agent - behavioral drift detected',
    action: 'Review',
    route: '/catalog',
  },
  {
    id: 4,
    badge: 'Incomplete',
    badgeClass: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
    text: 'Blueprint - financials section not yet populated',
    action: 'Complete',
    route: '/blueprint',
  },
];

const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const { setViewContext } = useChatContext();
  const [showDeployMessage, setShowDeployMessage] = useState(false);

  useEffect(() => {
    setViewContext('home');
  }, [setViewContext]);

  const handleStageClick = (id: string, route: string | null) => {
    if (id === 'deploy') {
      setShowDeployMessage(true);
    } else if (route) {
      navigate(route);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-8 animate-fade-in">

      {/* ── Hero ── */}
      <div className="bg-white dark:bg-slate-900 p-8 md:p-12 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <div className="flex flex-col md:flex-row items-center md:items-start gap-6">
          <div className="flex-shrink-0 w-20 h-20 bg-white rounded-2xl flex items-center justify-center shadow-lg shadow-blue-100 dark:shadow-blue-900/20 border border-slate-100 dark:border-slate-700">
            <img src={travoLogo} alt="Tavro" className="w-14 h-14 object-contain" />
          </div>
          <div className="text-center md:text-left">
            <h1 className="text-3xl md:text-4xl font-bold text-slate-800 dark:text-white tracking-tight mb-3">
              Welcome to <span className="text-purple-700 dark:text-purple-400">Tavro Agent BizOps</span>
            </h1>
            <p className="text-slate-500 dark:text-slate-400 text-base md:text-lg max-w-2xl leading-relaxed">
              Build, govern, and scale enterprise-aware AI agents - from first idea to production.
            </p>
          </div>
        </div>
      </div>

      {/* ── Stats ── */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {STATS.map(({ label, value, sub, subColor, Icon, iconColor, iconBg }) => (
          <div
            key={label}
            className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm"
          >
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                {label}
              </p>
              <div className={`p-1.5 rounded-lg ${iconBg}`}>
                <Icon size={14} className={iconColor} />
              </div>
            </div>
            <p className="text-3xl font-bold text-slate-800 dark:text-white mb-1">{value}</p>
            <p className={`text-xs font-medium ${subColor}`}>{sub}</p>
          </div>
        ))}
      </div>

      {/* ── Stage Pipeline ── */}
      <div className="space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {STAGES.map(({ id, label, Icon, route }, idx) => (
            <button
              key={id}
              onClick={() => handleStageClick(id, route)}
              className="relative text-left p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-purple-300 dark:hover:border-purple-700 hover:bg-purple-50 dark:hover:bg-purple-900/20 hover:shadow-md transition-all group"
            >
              {idx < STAGES.length - 1 && (
                <span className="hidden xl:flex absolute -right-4 top-1/2 -translate-y-1/2 z-10">
                  <ArrowRight size={22} strokeWidth={2.5} className="text-purple-700 dark:text-purple-400" />
                </span>
              )}
              <div className="w-8 h-8 rounded-lg flex items-center justify-center mb-3 bg-purple-50 dark:bg-purple-900/30 group-hover:bg-purple-100 dark:group-hover:bg-purple-900/50 transition-colors">
                <Icon size={16} className="text-purple-600 dark:text-purple-400" />
              </div>
              <div className="font-bold text-sm text-slate-800 dark:text-slate-200">
                {label}
              </div>
            </button>
          ))}
        </div>

        {/* Deploy notice */}

        {showDeployMessage && (
          <div className="flex items-start gap-3 p-4 rounded-2xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 animate-fade-in">
            <TrendingUp size={18} className="text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-amber-800 dark:text-amber-200 flex-1">
              <span className="font-semibold">Deploy</span> is accomplished outside Tavro and facilitated through integrations - coming soon.
            </p>
            <button
              onClick={() => setShowDeployMessage(false)}
              className="text-amber-500 hover:text-amber-700 dark:hover:text-amber-300 flex-shrink-0"
            >
              <X size={16} />
            </button>
          </div>
        )}
      </div>

      {/* ── Recent Activity & Needs Attention ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Recent Activity */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-5">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-4">
            Recent Activity
          </h2>
          <div className="space-y-4">
            {RECENT_ACTIVITY.map(({ id, text, time, dot }) => (
              <div key={id} className="flex items-start gap-3">
                <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${dot}`} />
                <p className="text-sm text-slate-700 dark:text-slate-300 flex-1 leading-snug">{text}</p>
                <span className="text-xs text-slate-400 dark:text-slate-500 whitespace-nowrap flex-shrink-0">{time}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Needs Your Attention */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-5">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-4">
            Needs Your Attention
          </h2>
          <div className="space-y-4">
            {ATTENTION_ITEMS.map(({ id, badge, badgeClass, text, action, route }) => (
              <div key={id} className="flex items-start gap-3">
                <span className={`mt-0.5 px-2 py-0.5 rounded text-[10px] font-semibold flex-shrink-0 ${badgeClass}`}>
                  {badge}
                </span>
                <p className="text-sm text-slate-700 dark:text-slate-300 flex-1 leading-snug">{text}</p>
                <button
                  onClick={() => navigate(route)}
                  className="flex items-center gap-0.5 text-xs font-semibold text-purple-700 dark:text-purple-400 hover:text-purple-900 dark:hover:text-purple-300 whitespace-nowrap flex-shrink-0"
                >
                  {action} <ArrowUpRight size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>

      </div>

    </div>
  );
};

export default HomePage;
