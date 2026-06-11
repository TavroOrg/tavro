import React, { useEffect, useState } from 'react';
import {
  Bot, ClipboardList, BarChart2, Brain, GitBranch, TrendingUp,
  Map, Layers, Cpu, Zap, Activity, ChevronRight, ArrowRight,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useChatContext } from '../context/ChatContext';
import travoLogo from '../assets/travo_logo.png';

const LIFECYCLE_STAGES = [
  {
    id: 'blueprint',
    label: 'Blueprint',
    Icon: Map,
    description: 'Overall Enterprise Context',
    steps: ['Enterprise Profile', 'Business Strategies', 'Org Structure', 'Financials', 'Risk Profile', 'Business Apps', 'Processes'],
    route: '/blueprint',
  },
  {
    id: 'plan',
    label: 'Plan',
    Icon: ClipboardList,
    description: 'Use case to agent blueprint',
    steps: ['Idea Generation', 'Use Case Discovery', 'Agent Blueprint', 'Risk Profiling', 'Agent Lineage', 'Agent Card', 'Stakeholder Alignment', 'Success Metrics', 'Change Mgmt'],
    route: '/use-cases',
  },
  {
    id: 'design',
    label: 'Design',
    Icon: Layers,
    description: 'What-if analysis and agent variants',
    steps: ['Variant Modeling', 'Autonomy Spectrum', 'Tool Set Selection', 'Cost Modelling', 'Scenario Stress Testing'],
    route: '/use-cases',
  },
  {
    id: 'develop',
    label: 'Develop',
    Icon: Cpu,
    description: 'Development work plan generation',
    steps: ['Work Plan Generation', 'MCP and Tool Build', 'Prompt Engineering', 'Guardrails Setup', 'Data Pipelines', 'Data Governance Integration'],
    route: '/catalog',
  },
  {
    id: 'deploy',
    label: 'Deploy',
    Icon: Zap,
    description: 'Deployment work plan',
    steps: ['Environment Config', 'Compute & Network', 'IAM & Security', 'CI/CD Pipeline', 'Versioning & Rollback'],
    route: '/catalog',
  },
  {
    id: 'monitor',
    label: 'Monitor',
    Icon: Activity,
    description: 'Active governance and drift detection',
    steps: ['Dynamic Risk Scoring', 'Drift Detection', 'Audit Trail', 'HITL Escalation', 'Continuous Improvement', 'AI ROI Tracking'],
    route: '/insights',
  },
];

const VALUE_PROPS = [
  {
    Icon: Bot,
    title: 'Build & Control Agents',
    description: 'Build new agents from scratch or bring governance to agents already running in your enterprise — all from one command center.',
    colorClass: 'text-violet-600 dark:text-violet-400',
    bgClass: 'bg-violet-50 dark:bg-violet-900/20',
    borderClass: 'border-violet-200 dark:border-violet-800',
  },
  {
    Icon: Brain,
    title: 'Enterprise-Aware LLM',
    description: 'Ground every AI decision in your company\'s real context — org structure, financials, risk profile, business apps, and processes.',
    colorClass: 'text-purple-600 dark:text-purple-400',
    bgClass: 'bg-purple-50 dark:bg-purple-900/20',
    borderClass: 'border-purple-200 dark:border-purple-800',
  },
  {
    Icon: GitBranch,
    title: 'End-to-End AI Lifecycle',
    description: 'From ideation to production governance — Blueprint, Plan, Design, Develop, Deploy, and Monitor with built-in steps at every stage.',
    colorClass: 'text-indigo-600 dark:text-indigo-400',
    bgClass: 'bg-indigo-50 dark:bg-indigo-900/20',
    borderClass: 'border-indigo-200 dark:border-indigo-800',
  },
  {
    Icon: TrendingUp,
    title: 'AI BizOps Companion',
    description: 'Your strategic partner for AI operations — aligning stakeholders, tracking ROI, managing risk, and driving continuous improvement.',
    colorClass: 'text-blue-600 dark:text-blue-400',
    bgClass: 'bg-blue-50 dark:bg-blue-900/20',
    borderClass: 'border-blue-200 dark:border-blue-800',
  },
];

const QUICK_ACTIONS = [
  { Icon: ClipboardList, label: 'AI Use Cases', desc: 'Discover and manage AI implementations', route: '/use-cases' },
  { Icon: Bot, label: 'Agent Catalog', desc: 'Explore your registered AI agents', route: '/catalog' },
  { Icon: BarChart2, label: 'Insights', desc: 'Analytics and executive risk summaries', route: '/insights' },
];

const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const { setViewContext } = useChatContext();
  const [activeStage, setActiveStage] = useState<string | null>(null);

  useEffect(() => {
    setViewContext('home');
  }, [setViewContext]);

  const activeStageData = LIFECYCLE_STAGES.find(s => s.id === activeStage);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-10 animate-fade-in">

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
              The enterprise platform that makes your LLMs enterprise-aware — guiding you from the first idea all the way through production governance.
            </p>
          </div>
        </div>
      </div>

      {/* ── Value Propositions ── */}
      <div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {VALUE_PROPS.map(({ Icon, title, description, colorClass, bgClass, borderClass }) => (
            <div
              key={title}
              className={`p-5 rounded-2xl border ${bgClass} ${borderClass} transition-all hover:shadow-md`}
            >
              <div className="p-2.5 rounded-xl inline-flex mb-3 bg-white dark:bg-slate-800 shadow-sm">
                <Icon size={20} className={colorClass} />
              </div>
              <h3 className="font-bold text-slate-800 dark:text-white text-sm mb-2">{title}</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{description}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Lifecycle Pipeline ── */}
      <div>
        <div className="mb-5">
          <h2 className="text-base font-bold text-slate-800 dark:text-white uppercase tracking-wider">
            AI Agent Lifecycle
          </h2>
        </div>

        {/* Stage flow — horizontal on large screens */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {LIFECYCLE_STAGES.map(({ id, label, Icon, description, steps }, idx) => {
            const isActive = activeStage === id;
            return (
              <button
                key={id}
                onClick={() => setActiveStage(isActive ? null : id)}
                className={`relative text-left p-4 rounded-2xl border transition-all ${
                  isActive
                    ? 'bg-purple-700 border-purple-700 shadow-lg shadow-purple-300/30 dark:shadow-purple-900/50'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-purple-300 dark:hover:border-purple-700 hover:shadow-md'
                }`}
              >
                {/* Connecting arrow — only on xl, not on last */}
                {idx < LIFECYCLE_STAGES.length - 1 && (
                  <span className="hidden xl:flex absolute -right-4 top-1/2 -translate-y-1/2 z-10">
                    <ArrowRight size={22} strokeWidth={2.5} className="text-purple-700 dark:text-purple-400" />
                  </span>
                )}

                <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-3 ${
                  isActive ? 'bg-white/20' : 'bg-purple-50 dark:bg-purple-900/30'
                }`}>
                  <Icon size={16} className={isActive ? 'text-white' : 'text-purple-600 dark:text-purple-400'} />
                </div>

                <div className={`text-xs font-semibold uppercase tracking-wider mb-0.5 ${
                  isActive ? 'text-purple-200' : 'text-slate-400 dark:text-slate-500'
                }`}>
                  Stage {idx + 1}
                </div>
                <div className={`font-bold text-sm ${isActive ? 'text-white' : 'text-slate-800 dark:text-slate-200'}`}>
                  {label}
                </div>
                <div className={`text-xs mt-1 leading-tight ${
                  isActive ? 'text-purple-200' : 'text-slate-500 dark:text-slate-400'
                }`}>
                  {steps.length} steps
                </div>
              </button>
            );
          })}
        </div>

        {/* Expanded stage detail */}
        {activeStageData && (
          <div className="mt-4 p-6 rounded-2xl bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 animate-fade-in">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-bold text-slate-800 dark:text-white">{activeStageData.label}</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">{activeStageData.description}</p>
              </div>
              <button
                onClick={() => navigate(activeStageData.route)}
                className="flex items-center gap-1.5 text-sm font-semibold text-purple-700 dark:text-purple-400 hover:text-purple-900 dark:hover:text-purple-300 flex-shrink-0 ml-4"
              >
                Open <ChevronRight size={14} />
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {activeStageData.steps.map((step, i) => (
                <div
                  key={step}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-800 rounded-full border border-purple-200 dark:border-purple-700 text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  <span className="w-4 h-4 rounded-full bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 text-[10px] flex items-center justify-center font-bold flex-shrink-0">
                    {i + 1}
                  </span>
                  {step}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Quick Access ── */}
      <div>
        <h2 className="text-base font-bold text-slate-800 dark:text-white uppercase tracking-wider mb-4">
          Quick Access
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {QUICK_ACTIONS.map(({ Icon, label, desc, route }) => (
            <button
              key={label}
              onClick={() => navigate(route)}
              className="flex items-center gap-4 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-purple-300 dark:hover:border-purple-700 hover:shadow-md transition-all group text-left"
            >
              <div className="p-3 bg-purple-50 dark:bg-purple-900/30 rounded-xl group-hover:scale-110 transition-transform flex-shrink-0">
                <Icon size={20} className="text-purple-600 dark:text-purple-400" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-bold text-slate-800 dark:text-slate-200 text-sm">{label}</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{desc}</p>
              </div>
              <ChevronRight
                size={16}
                className="text-slate-300 dark:text-slate-600 flex-shrink-0 group-hover:text-purple-500 group-hover:translate-x-0.5 transition-all"
              />
            </button>
          ))}
        </div>
      </div>

    </div>
  );
};

export default HomePage;
