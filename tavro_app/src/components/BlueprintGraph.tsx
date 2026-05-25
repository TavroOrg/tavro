// ── src/components/BlueprintGraph.tsx ────────────────────────────────────────
// SVG graph visualiser for the Company Blueprint.
// Reuses the exact same SVG engine as AgentContextGraph:
//   hub-and-spoke radial layout, pan/zoom, tooltips, expand/collapse groups.
// Groups = dim categories; leaves = individual dim nodes.

import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { ZoomIn, ZoomOut, Maximize2, ChevronDown, ChevronUp } from 'lucide-react';
import type { GraphData, DimCategory } from '../types/blueprint';
import { CATEGORY_PALETTE, CATEGORY_LABELS } from '../types/blueprint';

// ── Layout constants (identical to AgentContextGraph) ────────────────────────
const SVG_W = 1000;
const SVG_H = 760;
const CX = SVG_W / 2;
const CY = SVG_H / 2;
const CTX_R  = 240; // context node ring radius
const LEAF_R1 = 360; // inner leaf ring
const LEAF_R2 = 420; // outer leaf ring
const NW = 110; const NH = 44; // context node size
const LW = 96;  const LH = 36; // leaf node size

function trunc(s: string, n: number) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

function ctxPos(i: number, total: number) {
  const angle = (2 * Math.PI * i) / total - Math.PI / 2;
  return { x: CX + CTX_R * Math.cos(angle), y: CY + CTX_R * Math.sin(angle) };
}

function leafPositions(groupIdx: number, count: number, total: number) {
  const baseAngle = (2 * Math.PI * groupIdx) / total - Math.PI / 2;
  const spread = Math.min(Math.PI / 3, (count * 0.18));
  return Array.from({ length: count }, (_, i) => {
    const t = count === 1 ? 0 : (i / (count - 1) - 0.5);
    const angle = baseAngle + t * spread;
    const r = count > 4 ? LEAF_R2 : LEAF_R1;
    return { x: CX + r * Math.cos(angle), y: CY + r * Math.sin(angle) };
  });
}

function quadratic(x1: number, y1: number, x2: number, y2: number) {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2 - 30;
  return `M${x1},${y1} Q${mx},${my} ${x2},${y2}`;
}

// ── Build groups from graph data ──────────────────────────────────────────────
interface Group {
  id: DimCategory;
  label: string;
  strokeColor: string;
  bgColor: string;
  textColor: string;
  leaves: { id: string; label: string; sublabel?: string }[];
}

function buildGroups(graph: GraphData): Group[] {
  const byCategory = new Map<DimCategory, Group>();
  for (const node of graph.nodes) {
    const cat = node.type as DimCategory;
    if (!byCategory.has(cat)) {
      const p = CATEGORY_PALETTE[cat];
      byCategory.set(cat, {
        id: cat,
        label: CATEGORY_LABELS[cat],
        strokeColor: p.stroke,
        bgColor: p.bg,
        textColor: p.text,
        leaves: [],
      });
    }
    byCategory.get(cat)!.leaves.push({ id: node.id, label: node.label });
  }
  // Sort by category name for stable layout
  return Array.from(byCategory.values()).sort((a, b) => a.label.localeCompare(b.label));
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface BlueprintGraphProps {
  graph: GraphData;
  companyName: string;
  onNodeClick?: (nodeId: string) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────
const BlueprintGraph: React.FC<BlueprintGraphProps> = ({ graph, companyName, onNodeClick }) => {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { const id = setTimeout(() => setMounted(true), 80); return () => clearTimeout(id); }, []);

  const groups = useMemo(() => buildGroups(graph), [graph]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const ctxPositions    = useMemo(() => groups.map((_, i) => ctxPos(i, groups.length)), [groups]);
  const leafPositionsMap = useMemo(() =>
    groups.map((g, i) => leafPositions(i, g.leaves.length, groups.length)), [groups]);

  // ── Pan / zoom (identical to AgentContextGraph) ──────────────────────────
  const [vp, setVp] = useState({ x: 0, y: 0, scale: 1 });
  const drag = useRef<{ sx: number; sy: number; tx: number; ty: number } | null>(null);

  const onMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if ((e.target as Element).closest('[data-node]')) return;
    drag.current = { sx: e.clientX, sy: e.clientY, tx: vp.x, ty: vp.y };
  };
  const onMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!drag.current) return;
    setVp(v => ({ ...v, x: drag.current!.tx + e.clientX - drag.current!.sx, y: drag.current!.ty + e.clientY - drag.current!.sy }));
  };
  const onMouseUp = () => { drag.current = null; };
  const onWheel = useCallback((e: React.WheelEvent<SVGSVGElement>) => {
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    setVp(v => ({ ...v, scale: Math.min(2.5, Math.max(0.3, v.scale * factor)) }));
  }, []);

  // ── Tooltip ──────────────────────────────────────────────────────────────
  const [tip, setTip] = useState<{ x: number; y: number; text: string; sub?: string } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const showTip = useCallback((e: React.MouseEvent, text: string, sub?: string) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (r) setTip({ x: e.clientX - r.left, y: e.clientY - r.top, text, sub });
  }, []);
  const hideTip = useCallback(() => setTip(null), []);
  const toggleGroup = useCallback((id: string) =>
    setExpanded(p => ({ ...p, [id]: !p[id] })), []);

  if (!mounted) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-8 flex items-center justify-center text-slate-400 text-sm gap-2" style={{ height: 120 }}>
        <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" strokeOpacity="0.25" /><path d="M12 2a10 10 0 0 1 10 10" />
        </svg>
        Building blueprint graph…
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-12 flex flex-col items-center justify-center gap-3 text-slate-400">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="12" cy="12" r="3" /><circle cx="3" cy="12" r="2" /><circle cx="21" cy="12" r="2" />
          <circle cx="12" cy="3" r="2" /><circle cx="12" cy="21" r="2" />
          <line x1="5" y1="12" x2="9" y2="12" /><line x1="15" y1="12" x2="19" y2="12" />
        </svg>
        <p className="font-medium text-slate-500 dark:text-slate-400">No dimensions yet</p>
        <p className="text-sm text-slate-400 dark:text-slate-500">Add dimensions to your blueprint to see the graph.</p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden transition-colors">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-blue-50 dark:bg-blue-900/30 rounded-lg border border-blue-100 dark:border-blue-800">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2.2">
              <circle cx="12" cy="12" r="3" /><circle cx="3" cy="12" r="2" /><circle cx="21" cy="12" r="2" />
              <circle cx="12" cy="3" r="2" /><circle cx="12" cy="21" r="2" />
              <line x1="5" y1="12" x2="9" y2="12" /><line x1="15" y1="12" x2="19" y2="12" />
              <line x1="12" y1="5" x2="12" y2="9" /><line x1="12" y1="15" x2="12" y2="19" />
            </svg>
          </div>
          <div>
            <p className="font-bold text-slate-800 dark:text-slate-100 text-sm">Blueprint Graph</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">Click a category to expand · scroll to zoom · drag to pan</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setExpanded(Object.fromEntries(groups.map(g => [g.id, true])))}
            className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700 px-2.5 py-1.5 rounded-lg transition-colors">
            <ChevronDown size={12} /> Expand all
          </button>
          <button onClick={() => setExpanded({})}
            className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700 px-2.5 py-1.5 rounded-lg transition-colors">
            <ChevronUp size={12} /> Collapse all
          </button>
          <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-1" />
          <button onClick={() => setVp(v => ({ ...v, scale: Math.min(2.5, v.scale * 1.2) }))}
            className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors" title="Zoom in"><ZoomIn size={14} /></button>
          <button onClick={() => setVp(v => ({ ...v, scale: Math.max(0.3, v.scale * 0.83) }))}
            className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors" title="Zoom out"><ZoomOut size={14} /></button>
          <button onClick={() => setVp({ x: 0, y: 0, scale: 1 })}
            className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors" title="Reset view"><Maximize2 size={14} /></button>
        </div>
      </div>

      {/* ── Legend ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 px-5 py-2 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 text-[11px] font-semibold flex-wrap">
        {groups.map(g => (
          <span key={g.id} className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
            <span className="w-2 h-2 rounded-full" style={{ background: g.strokeColor }} />
            {g.label}
            <span className="font-normal text-slate-400 dark:text-slate-500">({g.leaves.length})</span>
          </span>
        ))}
      </div>

      {/* ── SVG Canvas ─────────────────────────────────────────────────────── */}
      <div className="relative" style={{ height: 540, background: 'radial-gradient(ellipse at 50% 50%, #f8fafc 0%, #f1f5f9 100%)' }}>
        <svg
          ref={svgRef}
          width="100%" height="100%"
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          preserveAspectRatio="xMidYMid meet"
          onMouseDown={onMouseDown} onMouseMove={onMouseMove}
          onMouseUp={onMouseUp} onMouseLeave={() => { onMouseUp(); hideTip(); }}
          onWheel={onWheel}
          style={{ userSelect: 'none', cursor: 'grab' }}
        >
          <defs>
            <filter id="bpShadow">
              <feDropShadow dx="0" dy="2" stdDeviation="4" floodColor="#00000015" />
            </filter>
          </defs>

          <g transform={`translate(${vp.x},${vp.y}) scale(${vp.scale})`}>

            {/* Guide rings */}
            {[CTX_R + 8, LEAF_R1 + 8, LEAF_R2 + 8].map(r => (
              <circle key={r} cx={CX} cy={CY} r={r}
                fill="none" stroke="#cbd5e1" strokeWidth="1"
                strokeDasharray="5 4" opacity="0.4" />
            ))}

            {/* Centre → context edges */}
            {groups.map((g, i) => {
              const cp = ctxPositions[i];
              return <path key={`ce-${g.id}`} d={quadratic(CX, CY, cp.x, cp.y)}
                fill="none" stroke={g.strokeColor} strokeWidth="2" opacity="0.25" />;
            })}

            {/* Context → leaf edges (expanded only) */}
            {groups.map((g, gi) => {
              if (!expanded[g.id]) return null;
              const cp = ctxPositions[gi];
              const lps = leafPositionsMap[gi];
              return (
                <React.Fragment key={`edges-${g.id}`}>
                  {g.leaves.map((lf, li) => (
                    <path key={`le-${gi}-${lf.id}`}
                      d={quadratic(cp.x, cp.y, lps[li].x, lps[li].y)}
                      fill="none" stroke={g.strokeColor} strokeWidth="1"
                      strokeDasharray="4 3" opacity="0.2" />
                  ))}
                </React.Fragment>
              );
            })}

            {/* Leaf nodes (expanded only) */}
            {groups.map((g, gi) => {
              if (!expanded[g.id]) return null;
              const lps = leafPositionsMap[gi];
              return (
                <React.Fragment key={`leaves-${g.id}`}>
                  {g.leaves.map((lf, li) => {
                    const { x, y } = lps[li];
                    return (
                      <g key={`${gi}-${lf.id}`}
                        transform={`translate(${x - LW / 2},${y - LH / 2})`}
                        onMouseEnter={e => showTip(e, lf.label)}
                        onMouseLeave={hideTip}
                        onClick={() => onNodeClick?.(lf.id)}
                        data-node="1"
                        style={{ cursor: onNodeClick ? 'pointer' : 'default' }}
                      >
                        <rect width={LW} height={LH} rx={9}
                          fill={g.bgColor} stroke={g.strokeColor} strokeWidth="1.2" />
                        <text x={LW / 2} y={13} textAnchor="middle"
                          fontSize="9.5" fontWeight="700" fill={g.textColor} fontFamily="system-ui,sans-serif">
                          {trunc(lf.label, 14)}
                        </text>
                        <text x={LW / 2} y={27} textAnchor="middle"
                          fontSize="8" fill="#94a3b8" fontFamily="system-ui,sans-serif">
                          {g.label}
                        </text>
                      </g>
                    );
                  })}
                </React.Fragment>
              );
            })}

            {/* Context (category) nodes */}
            {groups.map((g, gi) => {
              const { x, y } = ctxPositions[gi];
              const isExp = !!expanded[g.id];
              return (
                <g key={g.id}
                  transform={`translate(${x - NW / 2},${y - NH / 2})`}
                  onClick={() => toggleGroup(g.id)}
                  onMouseEnter={e => showTip(e, g.label, `${g.leaves.length} dimensions · ${isExp ? 'click to collapse' : 'click to expand'}`)}
                  onMouseLeave={hideTip}
                  data-node="1"
                  style={{ cursor: 'pointer' }}
                  filter="url(#bpShadow)"
                >
                  <rect width={NW} height={NH} rx={12}
                    fill={g.bgColor} stroke={g.strokeColor}
                    strokeWidth={isExp ? 2.5 : 1.5} />
                  <text x={NW / 2} y={17} textAnchor="middle"
                    fontSize="11" fontWeight="800" fill={g.textColor} fontFamily="system-ui,sans-serif">
                    {g.label}
                  </text>
                  <text x={NW / 2} y={32} textAnchor="middle"
                    fontSize="8.5" fill="#94a3b8" fontFamily="system-ui,sans-serif">
                    {isExp ? `▴ ${g.leaves.length} dims` : `▾ tap to expand`}
                  </text>
                </g>
              );
            })}

            {/* Centre — Company node */}
            <g filter="url(#bpShadow)">
              <rect x={CX - 72} y={CY - 32} width={144} height={64} rx={14}
                fill="#1e40af" stroke="#1d4ed8" strokeWidth="2" />
              <rect x={CX - 72} y={CY - 32} width={144} height={28} rx={14}
                fill="#ffffff" fillOpacity="0.08" />
            </g>
            <text x={CX} y={CY - 9} textAnchor="middle"
              fontSize="11" fontWeight="800" fill="#f1f5f9" fontFamily="system-ui,sans-serif">
              {trunc(companyName, 18)}
            </text>
            <text x={CX} y={CY + 11} textAnchor="middle"
              fontSize="9" fill="#93c5fd" fontFamily="system-ui,sans-serif">
              Company Blueprint
            </text>
          </g>
        </svg>

        {/* Tooltip */}
        {tip && (
          <div className="absolute z-20 pointer-events-none"
            style={{ left: tip.x + 8, top: tip.y - 44 }}>
            <div className="bg-slate-900 dark:bg-slate-700 text-white text-[11px] font-semibold rounded-lg px-2.5 py-1.5 shadow-xl max-w-[200px]">
              {tip.text}
              {tip.sub && <div className="text-slate-400 font-normal mt-0.5">{tip.sub}</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default BlueprintGraph;
