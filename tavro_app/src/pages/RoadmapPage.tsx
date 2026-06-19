import React, { useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Map, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useUseCases } from '../context/UseCaseContext';
import { readRoadmapConfig } from '../services/roadmapConfig';

// ── Types ──────────────────────────────────────────────────────────────────────

type DataReadiness = 'fully_ready' | 'partially_ready' | 'not_ready';
type Quadrant = 'quick_win' | 'big_bet' | 'fill_in' | 'money_pit';
type TimeHorizon = 'now' | 'next' | 'later';

interface UseCasePoint {
  id: string;
  name: string;
  cost: number;
  risk: number;
  value: number;
  readiness: DataReadiness;
  timeHorizon: TimeHorizon;
  businessFunction: string;
  quadrant: Quadrant;
}

// ── Config ─────────────────────────────────────────────────────────────────────

const QUADRANT_META: Record<Quadrant, { label: string; color: string; zone: string; action: string }> = {
  quick_win: { label: 'Quick wins',  color: '#1D7A4A', zone: 'rgba(29,122,74,0.05)',  action: 'Do first — high reward, low barrier to entry' },
  big_bet:   { label: 'Big bets',    color: '#5C2D8A', zone: 'rgba(92,45,138,0.05)',  action: 'Plan and fund — stage the build' },
  fill_in:   { label: 'Fill-ins',    color: '#B85C00', zone: 'rgba(184,92,0,0.05)',   action: 'Govern carefully — proceed if controls are in place' },
  money_pit: { label: 'Money pits',  color: '#A32D2D', zone: 'rgba(163,45,45,0.05)', action: 'Kill or deprioritize — high effort, high risk' },
};

const READINESS_LABEL: Record<DataReadiness, string> = {
  fully_ready:     'Fully ready',
  partially_ready: 'Partially ready',
  not_ready:       'Not ready',
};

const TIME_LABEL: Record<TimeHorizon, string> = {
  now: 'Now', next: 'Next', later: 'Later',
};

// ── Sample data (12 illustrative use cases — spec §8) ─────────────────────────

const SAMPLE_DATA: UseCasePoint[] = [
  // Quick wins — low cost (≤3), low risk (≤3)
  { id: '1',  name: 'Invoice Processing Automation', cost: 1.5, risk: 1.8, value: 5, readiness: 'fully_ready',     timeHorizon: 'now',   businessFunction: 'Finance',         quadrant: 'quick_win' },
  { id: '2',  name: 'Customer FAQ Chatbot',          cost: 2.2, risk: 2.0, value: 4, readiness: 'fully_ready',     timeHorizon: 'now',   businessFunction: 'Customer Service', quadrant: 'quick_win' },
  { id: '3',  name: 'Employee Onboarding Assistant', cost: 1.8, risk: 1.5, value: 3, readiness: 'partially_ready', timeHorizon: 'now',   businessFunction: 'HR',               quadrant: 'quick_win' },
  { id: '4',  name: 'Report Summarization',          cost: 2.8, risk: 2.5, value: 4, readiness: 'fully_ready',     timeHorizon: 'now',   businessFunction: 'Operations',       quadrant: 'quick_win' },
  // Big bets — high cost (>3), low risk (≤3)
  { id: '5',  name: 'Revenue Forecasting Engine',    cost: 4.2, risk: 2.2, value: 5, readiness: 'partially_ready', timeHorizon: 'next',  businessFunction: 'Finance',          quadrant: 'big_bet'   },
  { id: '6',  name: 'Supply Chain Optimizer',        cost: 4.8, risk: 2.8, value: 5, readiness: 'partially_ready', timeHorizon: 'next',  businessFunction: 'Operations',       quadrant: 'big_bet'   },
  { id: '7',  name: 'Customer Churn Predictor',      cost: 3.8, risk: 2.0, value: 4, readiness: 'not_ready',       timeHorizon: 'next',  businessFunction: 'Sales',            quadrant: 'big_bet'   },
  // Fill-ins — low cost (≤3), high risk (>3)
  { id: '8',  name: 'HR Policy Advisor',             cost: 2.0, risk: 4.2, value: 3, readiness: 'partially_ready', timeHorizon: 'later', businessFunction: 'HR',               quadrant: 'fill_in'   },
  { id: '9',  name: 'Compliance Monitor',            cost: 2.8, risk: 3.8, value: 2, readiness: 'fully_ready',     timeHorizon: 'later', businessFunction: 'Legal',            quadrant: 'fill_in'   },
  { id: '10', name: 'Contract Risk Analyzer',        cost: 1.8, risk: 4.8, value: 3, readiness: 'partially_ready', timeHorizon: 'later', businessFunction: 'Legal',            quadrant: 'fill_in'   },
  // Money pits — high cost (>3), high risk (>3)
  { id: '11', name: 'Autonomous Trading Agent',      cost: 4.8, risk: 4.8, value: 2, readiness: 'not_ready',       timeHorizon: 'later', businessFunction: 'Finance',          quadrant: 'money_pit' },
  { id: '12', name: 'Medical Diagnosis Support',     cost: 4.2, risk: 5.0, value: 3, readiness: 'not_ready',       timeHorizon: 'later', businessFunction: 'Healthcare',       quadrant: 'money_pit' },
];

// ── Chart geometry ─────────────────────────────────────────────────────────────

const VB_W = 800;
const VB_H = 520;
const PAD  = { l: 72, r: 32, t: 40, b: 64 };
const PW   = VB_W - PAD.l - PAD.r;   // 696
const PH   = VB_H - PAD.t - PAD.b;   // 416

const xs = (v: number) => PAD.l + (v / 6) * PW;
const ys = (v: number) => PAD.t + ((6 - v) / 6) * PH;
const br = (value: number) => 10 + (value - 1) * 6.25;

const DX = xs(3);
const DY = ys(3);
const TICKS       = [1, 2, 3, 4, 5];
const TICK_LABELS = ['Very low', 'Low', 'Medium', 'High', 'Very high'];

// ── Tooltip ────────────────────────────────────────────────────────────────────

interface TooltipState { uc: UseCasePoint; x: number; y: number }

function Tooltip({ state }: { state: TooltipState }) {
  const { uc, x, y } = state;
  const q = QUADRANT_META[uc.quadrant];
  return (
    <div
      className="fixed z-50 bg-white border border-slate-200 rounded-xl shadow-xl p-3 text-xs pointer-events-none min-w-[200px]"
      style={{ left: x + 14, top: y - 10 }}
    >
      <p className="font-bold text-slate-800 mb-2 leading-snug">{uc.name}</p>
      <div className="flex flex-col gap-1 text-slate-600">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: q.color }} />
          <span className="font-semibold" style={{ color: q.color }}>{q.label}</span>
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
          <span className="text-slate-400">Cost / Effort</span>
          <span className="font-medium">{uc.cost.toFixed(1)}</span>
          <span className="text-slate-400">Risk</span>
          <span className="font-medium">{uc.risk.toFixed(1)}</span>
          <span className="text-slate-400">Business Value</span>
          <span className="font-medium">{uc.value.toFixed(1)}</span>
          <span className="text-slate-400">Data Readiness</span>
          <span className="font-medium">{READINESS_LABEL[uc.readiness]}</span>
          <span className="text-slate-400">Time Horizon</span>
          <span className="font-medium">{TIME_LABEL[uc.timeHorizon]}</span>
        </div>
      </div>
    </div>
  );
}

// ── Bubble chart (SVG) ─────────────────────────────────────────────────────────

function BubbleChart({
  data,
  highlightId,
  onHover,
  onLeave,
  onClick,
}: {
  data: UseCasePoint[];
  highlightId: string | null;
  onHover: (uc: UseCasePoint, x: number, y: number) => void;
  onLeave: () => void;
  onClick: (uc: UseCasePoint) => void;
}) {
  return (
    <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="w-full h-auto" style={{ maxHeight: 520 }}>

      {/* Quadrant zone backgrounds */}
      <rect x={PAD.l} y={PAD.t}  width={DX - PAD.l}       height={DY - PAD.t}       fill={QUADRANT_META.fill_in.zone}   />
      <rect x={DX}    y={PAD.t}  width={PAD.l + PW - DX}  height={DY - PAD.t}       fill={QUADRANT_META.money_pit.zone} />
      <rect x={PAD.l} y={DY}     width={DX - PAD.l}        height={PAD.t + PH - DY}  fill={QUADRANT_META.quick_win.zone} />
      <rect x={DX}    y={DY}     width={PAD.l + PW - DX}   height={PAD.t + PH - DY}  fill={QUADRANT_META.big_bet.zone}   />

      {/* Quadrant watermark labels */}
      <text x={(PAD.l + DX) / 2}       y={(PAD.t + DY) / 2}       textAnchor="middle" dominantBaseline="middle" fontSize={15} fontWeight={700} fill={QUADRANT_META.fill_in.color}   opacity={0.35}>Fill-ins</text>
      <text x={(DX + PAD.l + PW) / 2}  y={(PAD.t + DY) / 2}       textAnchor="middle" dominantBaseline="middle" fontSize={15} fontWeight={700} fill={QUADRANT_META.money_pit.color} opacity={0.35}>Money pits</text>
      <text x={(PAD.l + DX) / 2}       y={(DY + PAD.t + PH) / 2}  textAnchor="middle" dominantBaseline="middle" fontSize={15} fontWeight={700} fill={QUADRANT_META.quick_win.color} opacity={0.35}>Quick wins</text>
      <text x={(DX + PAD.l + PW) / 2}  y={(DY + PAD.t + PH) / 2}  textAnchor="middle" dominantBaseline="middle" fontSize={15} fontWeight={700} fill={QUADRANT_META.big_bet.color}   opacity={0.35}>Big bets</text>

      {/* Plot border */}
      <rect x={PAD.l} y={PAD.t} width={PW} height={PH} fill="none" stroke="#e2e8f0" strokeWidth={1} />

      {/* Dashed divider lines */}
      <line x1={DX}    y1={PAD.t}      x2={DX}          y2={PAD.t + PH} stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="6 4" />
      <line x1={PAD.l} y1={DY}         x2={PAD.l + PW}  y2={DY}         stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="6 4" />

      {/* X axis ticks and labels */}
      {TICKS.map((t, i) => (
        <g key={`xt-${t}`}>
          <line x1={xs(t)} y1={PAD.t + PH} x2={xs(t)} y2={PAD.t + PH + 5} stroke="#cbd5e1" strokeWidth={1} />
          <text x={xs(t)} y={PAD.t + PH + 18} textAnchor="middle" fontSize={10} fill="#94a3b8">{TICK_LABELS[i]}</text>
        </g>
      ))}

      {/* Y axis ticks and labels */}
      {TICKS.map((t, i) => (
        <g key={`yt-${t}`}>
          <line x1={PAD.l - 5} y1={ys(t)} x2={PAD.l} y2={ys(t)} stroke="#cbd5e1" strokeWidth={1} />
          <text x={PAD.l - 10} y={ys(t)} textAnchor="end" dominantBaseline="middle" fontSize={10} fill="#94a3b8">{TICK_LABELS[i]}</text>
        </g>
      ))}

      {/* Axis labels */}
      <text x={PAD.l + PW / 2} y={VB_H - 8} textAnchor="middle" fontSize={11} fill="#64748b" fontWeight={500}>
        Estimated cost / effort →
      </text>
      <text
        x={14} y={PAD.t + PH / 2}
        textAnchor="middle" fontSize={11} fill="#64748b" fontWeight={500}
        transform={`rotate(-90, 14, ${PAD.t + PH / 2})`}
      >
        ↑ Estimated risk
      </text>

      {/* Bubbles */}
      {data.map(uc => {
        const cx          = xs(uc.cost);
        const cy          = ys(uc.risk);
        const r           = br(uc.value);
        const color       = QUADRANT_META[uc.quadrant].color;
        const isHighlight = highlightId === uc.id;
        const fillOpacity = uc.readiness === 'fully_ready' ? 0.7 : uc.readiness === 'partially_ready' ? 0.25 : 0;
        const dashArray   = uc.readiness === 'fully_ready' ? undefined : '4 2';

        return (
          <g key={uc.id} style={{ cursor: 'pointer' }}>
            {isHighlight && (
              <circle cx={cx} cy={cy} r={r + 7} fill="none" stroke={color} strokeWidth={2} opacity={0.35} />
            )}
            <circle
              cx={cx} cy={cy} r={r}
              fill={color} fillOpacity={fillOpacity}
              stroke={color} strokeWidth={isHighlight ? 2.5 : 1.5}
              strokeDasharray={dashArray}
              onMouseEnter={(e) => onHover(uc, e.clientX, e.clientY)}
              onMouseMove={(e)  => onHover(uc, e.clientX, e.clientY)}
              onMouseLeave={onLeave}
              onClick={() => onClick(uc)}
            />
          </g>
        );
      })}
    </svg>
  );
}

// ── Portfolio summary cards ────────────────────────────────────────────────────

function SummaryCards({
  counts,
  activeQuadrant,
  onSelect,
}: {
  counts: Partial<Record<Quadrant, number>>;
  activeQuadrant: Quadrant | 'all';
  onSelect: (q: Quadrant | 'all') => void;
}) {
  const quadrants: Quadrant[] = ['quick_win', 'big_bet', 'fill_in', 'money_pit'];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {quadrants.map(q => {
        const meta     = QUADRANT_META[q];
        const isActive = activeQuadrant === q;
        return (
          <button
            key={q}
            onClick={() => onSelect(isActive ? 'all' : q)}
            className={`flex items-center gap-3 p-4 rounded-xl border text-left transition-all ${
              isActive
                ? 'shadow-sm'
                : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'
            }`}
            style={isActive ? { borderColor: meta.color, background: meta.zone } : {}}
          >
            <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: meta.color }} />
            <div>
              <p className="text-xl font-bold text-slate-800">{counts[q] ?? 0}</p>
              <p className="text-xs text-slate-500 mt-0.5">{meta.label}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ── Legend ─────────────────────────────────────────────────────────────────────

function Legend() {
  const quadrants: Quadrant[] = ['quick_win', 'big_bet', 'fill_in', 'money_pit'];
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col gap-4 text-xs">

      <div>
        <p className="font-bold text-slate-500 mb-2 uppercase tracking-wide text-[10px]">Quadrant</p>
        <div className="flex flex-col gap-2">
          {quadrants.map(q => {
            const m = QUADRANT_META[q];
            return (
              <div key={q} className="flex items-start gap-2">
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 mt-0.5" style={{ background: m.color }} />
                <div>
                  <span className="font-semibold" style={{ color: m.color }}>{m.label}</span>
                  <p className="text-slate-400 text-[10px] mt-0.5">{m.action}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <p className="font-bold text-slate-500 mb-2 uppercase tracking-wide text-[10px]">Bubble size = Business Value</p>
        <div className="flex items-end gap-4">
          {[1, 3, 5].map(v => (
            <div key={v} className="flex flex-col items-center gap-1">
              <svg width={br(v) * 2 + 4} height={br(v) * 2 + 4}>
                <circle cx={br(v) + 2} cy={br(v) + 2} r={br(v)} fill="#64748b" fillOpacity={0.3} stroke="#64748b" strokeWidth={1.5} />
              </svg>
              <span className="text-slate-400">{v === 1 ? 'Low' : v === 3 ? 'Med' : 'High'}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="font-bold text-slate-500 mb-2 uppercase tracking-wide text-[10px]">Data Readiness</p>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <svg width={18} height={18}><circle cx={9} cy={9} r={7} fill="#64748b" fillOpacity={0.7} stroke="#64748b" strokeWidth={1.5} /></svg>
            <span className="text-slate-500">Fully ready</span>
          </div>
          <div className="flex items-center gap-2">
            <svg width={18} height={18}><circle cx={9} cy={9} r={7} fill="#64748b" fillOpacity={0.25} stroke="#64748b" strokeWidth={1.5} strokeDasharray="4 2" /></svg>
            <span className="text-slate-500">Partially ready</span>
          </div>
          <div className="flex items-center gap-2">
            <svg width={18} height={18}><circle cx={9} cy={9} r={7} fill="none" stroke="#64748b" strokeWidth={1.5} strokeDasharray="4 2" /></svg>
            <span className="text-slate-500">Not ready</span>
          </div>
        </div>
      </div>

      <p className="text-slate-400 text-[10px]">Time horizon shown in tooltip and filter controls.</p>
    </div>
  );
}

// ── Filter bar ─────────────────────────────────────────────────────────────────

function FilterBar({
  activeTimeHorizon,
  setActiveTimeHorizon,
  activeQuadrant,
  setActiveQuadrant,
}: {
  activeTimeHorizon: TimeHorizon | 'all';
  setActiveTimeHorizon: (v: TimeHorizon | 'all') => void;
  activeQuadrant: Quadrant | 'all';
  setActiveQuadrant: (v: Quadrant | 'all') => void;
}) {
  const horizons: Array<TimeHorizon | 'all'>  = ['all', 'now', 'next', 'later'];
  const quadrants: Array<Quadrant | 'all'>    = ['all', 'quick_win', 'big_bet', 'fill_in', 'money_pit'];

  const baseBtn = 'px-3 py-1.5 rounded-lg text-xs font-medium transition-all border';

  return (
    <div className="flex flex-wrap items-center gap-4">

      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-xs text-slate-400 font-semibold">Time:</span>
        {horizons.map(h => {
          const active = activeTimeHorizon === h;
          return (
            <button
              key={h}
              onClick={() => setActiveTimeHorizon(h)}
              className={`${baseBtn} ${active ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}
            >
              {h === 'all' ? 'All' : TIME_LABEL[h]}
            </button>
          );
        })}
      </div>

      <div className="w-px h-4 bg-slate-200" />

      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-xs text-slate-400 font-semibold">Quadrant:</span>
        {quadrants.map(q => {
          const active = activeQuadrant === q;
          const color  = q !== 'all' ? QUADRANT_META[q].color : undefined;
          return (
            <button
              key={q}
              onClick={() => setActiveQuadrant(q)}
              className={`${baseBtn} ${
                active && q !== 'all'
                  ? 'text-white border-transparent'
                  : active
                  ? 'bg-slate-800 text-white border-slate-800'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
              }`}
              style={active && q !== 'all' ? { background: color, borderColor: color } : {}}
            >
              {q === 'all' ? 'All' : QUADRANT_META[q].label}
            </button>
          );
        })}
      </div>

    </div>
  );
}

// ── Derive a chart point from a real use case + its localStorage scores ───────

function computePoint(id: string, name: string, fn: string | null | undefined, stored: any): UseCasePoint | null {
  const cfg = readRoadmapConfig();
  const pvBV: number | null = stored?.pvBV ?? null;
  const pvTC: number | null = stored?.pvTC ?? null;
  const pvDR: number | null = stored?.pvDR ?? null;
  const riskScores: Record<string, number | null> = stored?.riskScores ?? {};
  const riskWeights = cfg.riskWeights;

  // Need at minimum TC + at least one risk score to place on the chart
  if (pvTC === null) return null;
  const riskEntries = (Object.entries(riskScores) as [string, number | null][]).filter(([, s]) => s !== null) as [string, number][];
  if (riskEntries.length === 0) return null;

  const rw = riskWeights as unknown as Record<string, number>;
  const wTotal = riskEntries.reduce((sum, [k]) => sum + (rw[k] ?? 20), 0);
  const riskComposite = wTotal > 0
    ? +(riskEntries.reduce((sum, [k, s]) => sum + s * (rw[k] ?? 20), 0) / wTotal).toFixed(2)
    : null;
  if (riskComposite === null) return null;

  const highCost = pvTC > 3;
  const highRisk = riskComposite > 3;
  const quadrant: Quadrant = !highCost && !highRisk ? 'quick_win'
    : !highCost &&  highRisk ? 'fill_in'
    :  highCost && !highRisk ? 'big_bet'
    : 'money_pit';

  const readiness: DataReadiness = pvDR === null ? 'not_ready' : pvDR >= 5 ? 'fully_ready' : pvDR >= 3 ? 'partially_ready' : 'not_ready';
  const timeHorizon: TimeHorizon = quadrant === 'quick_win' ? 'now' : quadrant === 'big_bet' ? 'next' : 'later';

  return {
    id,
    name,
    cost: pvTC,
    risk: riskComposite,
    value: pvBV ?? 3,
    readiness,
    timeHorizon,
    businessFunction: fn ?? 'Unknown',
    quadrant,
  };
}

// ── Page ───────────────────────────────────────────────────────────────────────

const RoadmapPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams]    = useSearchParams();
  const highlightId       = searchParams.get('highlight');
  const { useCases }      = useUseCases();

  const [activeTimeHorizon, setActiveTimeHorizon] = useState<TimeHorizon | 'all'>('all');
  const [activeQuadrant,    setActiveQuadrant]    = useState<Quadrant | 'all'>('all');
  const [tooltip,           setTooltip]           = useState<TooltipState | null>(null);
  const [showSample,        setShowSample]        = useState(false);

  // Build live data from real use cases + localStorage scores
  const liveData = useMemo(() =>
    useCases.flatMap(uc => {
      try {
        const raw = localStorage.getItem(`tavro_prio_${uc.identifier}`);
        const stored = raw ? JSON.parse(raw) : {};
        const pt = computePoint(uc.identifier, uc.name ?? uc.identifier, (uc as any).function, stored);
        return pt ? [pt] : [];
      } catch { return []; }
    }),
  [useCases]);

  const activeData = (showSample || liveData.length === 0) ? SAMPLE_DATA : liveData;
  const isLive     = !showSample && liveData.length > 0;

  const counts = useMemo(() =>
    activeData.reduce((acc, uc) => {
      acc[uc.quadrant] = (acc[uc.quadrant] ?? 0) + 1;
      return acc;
    }, {} as Partial<Record<Quadrant, number>>),
  [activeData]);

  const filtered = useMemo(() =>
    activeData.filter(uc => {
      if (activeTimeHorizon !== 'all' && uc.timeHorizon !== activeTimeHorizon) return false;
      if (activeQuadrant    !== 'all' && uc.quadrant    !== activeQuadrant)    return false;
      return true;
    }),
  [activeData, activeTimeHorizon, activeQuadrant]);

  return (
    <div className="flex flex-col gap-6 p-6 max-w-[1400px] mx-auto animate-fade-in pb-10">

      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-violet-600 text-white rounded-xl shadow-sm">
            <Map size={20} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Roadmap</h1>
            <p className="text-sm text-slate-500">AI use case portfolio — strategic prioritization view</p>
          </div>
        </div>

        {/* Live / Sample toggle */}
        <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1">
          <button
            type="button"
            onClick={() => setShowSample(false)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${!showSample ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${liveData.length > 0 ? 'bg-emerald-500' : 'bg-slate-300'}`} />
            Live data {useCases.length > 0 && `(${liveData.length}/${useCases.length})`}
          </button>
          <button
            type="button"
            onClick={() => setShowSample(true)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${showSample ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            Sample data
          </button>
        </div>
      </div>

      {/* Status banner */}
      {isLive && liveData.length < useCases.length && (
        <div className="flex items-center gap-2.5 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
          <AlertTriangle size={13} className="flex-shrink-0" />
          <span>
            <strong>{liveData.length} of {useCases.length}</strong> use cases scored.
            Open a use case → <strong>Prioritization</strong> tab to score and add it here.
          </span>
          <button type="button" onClick={() => navigate('/use-cases')} className="ml-auto shrink-0 text-xs font-bold text-amber-700 underline underline-offset-2 hover:text-amber-900">
            View all use cases →
          </button>
        </div>
      )}
      {isLive && liveData.length === useCases.length && useCases.length > 0 && (
        <div className="flex items-center gap-2.5 px-4 py-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800">
          <CheckCircle2 size={13} className="flex-shrink-0" />
          All {useCases.length} use cases scored and plotted.
        </div>
      )}
      {!isLive && showSample && (
        <div className="flex items-center gap-2.5 px-4 py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-xs text-slate-500">
          Showing 12 illustrative sample use cases. Switch to <button type="button" onClick={() => setShowSample(false)} className="mx-1 font-bold text-violet-600 underline underline-offset-2">Live data</button> to see your scored use cases.
        </div>
      )}
      {!isLive && !showSample && liveData.length === 0 && useCases.length > 0 && (
        <div className="flex items-center gap-2.5 px-4 py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-xs text-slate-500">
          <AlertTriangle size={13} className="flex-shrink-0" />
          No use cases scored yet — showing sample data. Open a use case → <strong className="mx-1">Prioritization</strong> tab to score it.
          <button type="button" onClick={() => navigate('/use-cases')} className="ml-auto shrink-0 font-bold text-violet-600 underline underline-offset-2">Go to use cases →</button>
        </div>
      )}

      {/* Portfolio summary cards */}
      <SummaryCards counts={counts} activeQuadrant={activeQuadrant} onSelect={setActiveQuadrant} />

      {/* Chart + legend */}
      <div className="flex gap-4 items-start">
        <div className="flex-1 bg-white border border-slate-200 rounded-2xl p-4 shadow-sm min-w-0">
          <BubbleChart
            data={filtered}
            highlightId={highlightId}
            onHover={(uc, x, y) => setTooltip({ uc, x, y })}
            onLeave={() => setTooltip(null)}
            onClick={(uc) => isLive ? navigate(`/use-case/${uc.id}?tab=prioritization`) : undefined}
          />
        </div>
        <div className="w-60 flex-shrink-0">
          <Legend />
        </div>
      </div>

      {/* Filter controls */}
      <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-sm">
        <FilterBar
          activeTimeHorizon={activeTimeHorizon}
          setActiveTimeHorizon={setActiveTimeHorizon}
          activeQuadrant={activeQuadrant}
          setActiveQuadrant={setActiveQuadrant}
        />
      </div>

      {/* Tooltip */}
      {tooltip && <Tooltip state={tooltip} />}
    </div>
  );
};

export default RoadmapPage;
