/**
 * AgentContextGraph — interactive radial context graph.
 *
 * Performance fixes vs v1:
 *  • Starts collapsed (only 4 context nodes + centre = minimal DOM on mount)
 *  • SVG is deferred via useEffect so the rest of the agent detail page renders first
 *  • Wheel zoom handled via React's onWheel (passive-friendly) instead of a manual
 *    non-passive addEventListener that blocked the browser
 *  • All geometry is memoized so pan/zoom updates don't recompute positions
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ZoomIn, ZoomOut, Maximize2, ChevronDown, ChevronUp, Cpu, Wrench, Building2, ShieldAlert } from 'lucide-react';
import { AgentData } from '../types/agent';

// ── Types ─────────────────────────────────────────────────────────────────────

interface LeafNode { id: string; label: string; sublabel?: string; badgeText?: string; badgeColor?: string; }
interface ContextGroup {
    id: string; label: string; bgColor: string; strokeColor: string; textColor: string;
    icon: React.ReactNode; leaves: LeafNode[];
}
interface XY { x: number; y: number; }

// ── Layout constants ──────────────────────────────────────────────────────────

const CX = 520, CY = 420;       // canvas centre (shifted to give outer ring room)
const CTX_R = 155;             // context node orbit radius
const LEAF_R1 = 275;            // inner leaf ring (first 4 leaves)
const LEAF_R2 = 375;            // outer leaf ring (overflow leaves)
const MAX_INNER = 4;            // max leaves on inner ring
const NW = 112, NH = 46;        // context node size
const LW = 126, LH = 36;        // leaf node size
const SVG_W = 1040, SVG_H = 840;

// ── Colours ───────────────────────────────────────────────────────────────────

const TECH = { bg: '#eff6ff', stroke: '#3b82f6', text: '#1d4ed8' };
const FUNC = { bg: '#f5f3ff', stroke: '#8b5cf6', text: '#6d28d9' };
const BIZ = { bg: '#fff7ed', stroke: '#f97316', text: '#c2410c' };
const RISK = { bg: '#fff1f2', stroke: '#f43f5e', text: '#be123c' };

function critColor(v: string) { const l = v.toLowerCase(); return l.includes('high') || l.includes('critical') ? '#ef4444' : l.includes('medium') ? '#f59e0b' : '#10b981'; }
function riskColor(v: string) { const l = v.toLowerCase(); return (l === 'critical' || l === 'high') ? '#ef4444' : l === 'medium' ? '#f59e0b' : '#10b981'; }

// ── Data builder ──────────────────────────────────────────────────────────────

function buildGroups(agent: AgentData): ContextGroup[] {
    const id = agent.identification ?? {} as any;
    const cfg = agent.configuration ?? {} as any;

    const techLeaves: LeafNode[] = [
        id.role && { id: 'role', label: 'Role', sublabel: id.role },
        id.environment && { id: 'env', label: 'Environment', sublabel: id.environment },
        id.owner && { id: 'owner', label: 'Owner', sublabel: id.owner },
        cfg.autonomy_level && { id: 'auto', label: 'Autonomy', sublabel: cfg.autonomy_level },
        cfg.access_scope && { id: 'scope', label: 'Access Scope', sublabel: cfg.access_scope },
        cfg.memory_type && { id: 'mem', label: 'Memory', sublabel: cfg.memory_type },
        cfg.reasoning_model && { id: 'llm', label: 'LLM Model', sublabel: cfg.reasoning_model },
    ].filter(Boolean) as LeafNode[];

    const funcLeaves: LeafNode[] = [
        ...(agent.tool ?? []).slice(0, 5).map(t => ({ id: `t-${t.name}`, label: t.name, sublabel: 'Tool' })),
        ...(agent.data_source ?? []).slice(0, 4).map((ds, i) => ({
            id: `ds-${i}`, label: ds.source_object_name ?? 'Data Source', sublabel: ds.source_object_type,
        })),
    ];
    if (!funcLeaves.length) funcLeaves.push({ id: 'fn0', label: 'No tools/sources', sublabel: 'configured' });

    const bizLeaves: LeafNode[] = [
        ...(agent.application ?? []).slice(0, 5).map((a, i) => ({
            // Always include index `i` in the key to prevent duplicates when
            // multiple apps share a null identifier/name.
            id: `app-${i}-${a.identifier ?? a.name ?? 'unknown'}`,
            label: a.name ?? `App ${i + 1}`,
            sublabel: a.business_criticality ?? undefined,
            badgeText: a.business_criticality ?? undefined,
            badgeColor: a.business_criticality ? critColor(a.business_criticality) : undefined,
        })),
        ...(agent.business_process ?? []).slice(0, 3).map((p, i) => ({
            id: `proc-${i}-${p.identifier ?? 'unknown'}`,
            label: p.name ?? `Process ${i + 1}`,
            sublabel: 'Process',
        })),
    ];
    if (!bizLeaves.length) bizLeaves.push({ id: 'bz0', label: 'No business context', sublabel: 'recorded' });

    // Risk: show only Blended Risk, AIVSS, and Regulatory
    const ra = agent.risk_assessment;
    const riskLeaves: LeafNode[] = [];
    if (ra) {
        if (ra.blended_risk_classification) riskLeaves.push({
            id: 'rbl', label: 'Blended Risk',
            sublabel: `Score ${ra.blended_risk_score ?? '?'}`,
            badgeText: ra.blended_risk_classification,
            badgeColor: riskColor(ra.blended_risk_classification),
        });
        if (ra.aivss_classification) riskLeaves.push({
            id: 'rav', label: 'AIVSS',
            sublabel: `Score ${ra.aivss_score ?? '?'}`,
            badgeText: ra.aivss_classification,
            badgeColor: riskColor(ra.aivss_classification),
        });
        if (ra.regulatory_risk_classification) riskLeaves.push({
            id: 'rrg', label: 'Regulatory',
            sublabel: ra.regulatory_risk_classification,
        });
    }
    if (!riskLeaves.length) riskLeaves.push({ id: 'rk0', label: 'No risk assessment', sublabel: 'on file' });

    return [
        { id: 'tech', label: 'Technical', bgColor: TECH.bg, strokeColor: TECH.stroke, textColor: TECH.text, icon: <Cpu size={13} />, leaves: techLeaves },
        { id: 'func', label: 'Functional', bgColor: FUNC.bg, strokeColor: FUNC.stroke, textColor: FUNC.text, icon: <Wrench size={13} />, leaves: funcLeaves },
        { id: 'biz', label: 'Business', bgColor: BIZ.bg, strokeColor: BIZ.stroke, textColor: BIZ.text, icon: <Building2 size={13} />, leaves: bizLeaves },
        { id: 'risk', label: 'Risk', bgColor: RISK.bg, strokeColor: RISK.stroke, textColor: RISK.text, icon: <ShieldAlert size={13} />, leaves: riskLeaves },
    ];
}

// ── Geometry (all memoized) ───────────────────────────────────────────────────

function ctxPos(idx: number): XY {
    const a = (idx / 4) * 2 * Math.PI - Math.PI / 2;
    return { x: CX + Math.cos(a) * CTX_R, y: CY + Math.sin(a) * CTX_R };
}

/**
 * Returns leaf node positions using a two-ring layout:
 *  – up to MAX_INNER leaves on the inner ring (LEAF_R1)
 *  – overflow leaves on the outer ring (LEAF_R2)
 * Each ring fans out within a 72-degree arc centred on the context angle,
 * preventing overlap with neighbouring context sectors.
 */
function leafPositions(ctxIdx: number, count: number): XY[] {
    const baseAngle = (ctxIdx / 4) * 2 * Math.PI - Math.PI / 2;
    const MAX_SPREAD = Math.PI * 0.4;   // 72° per ring — stays within the 90° sector
    const MIN_STEP = 0.28;            // min angular gap between nodes on the same ring

    function ring(items: number, radius: number): XY[] {
        const spread = items === 1 ? 0 : Math.min(MAX_SPREAD, (items - 1) * MIN_STEP);
        return Array.from({ length: items }, (_, i) => {
            const a = items === 1 ? baseAngle : baseAngle - spread / 2 + (spread / (items - 1)) * i;
            return { x: CX + Math.cos(a) * radius, y: CY + Math.sin(a) * radius };
        });
    }

    const innerCount = Math.min(count, MAX_INNER);
    const outerCount = count - innerCount;
    return [...ring(innerCount, LEAF_R1), ...ring(outerCount, LEAF_R2)];
}

function quadratic(ax: number, ay: number, bx: number, by: number): string {
    const cx = (ax + bx) / 2 + (ay - by) * 0.1;
    const cy = (ay + by) / 2 + (bx - ax) * 0.1;
    return `M${ax},${ay} Q${cx},${cy} ${bx},${by}`;
}

function trunc(s: string, n: number) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

// ── Component ─────────────────────────────────────────────────────────────────

const AgentContextGraph: React.FC<{ agent: AgentData }> = ({ agent }) => {
    // Defer SVG mount so the rest of the page renders first
    const [mounted, setMounted] = useState(false);
    useEffect(() => { const id = setTimeout(() => setMounted(true), 80); return () => clearTimeout(id); }, []);

    const groups = useMemo(() => buildGroups(agent), [agent]);

    // All contexts start COLLAPSED — avoids large initial paint
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});

    // Pre-compute all geometry once
    const ctxPositions = useMemo(() => groups.map((_, i) => ctxPos(i)), [groups]);
    const leafPositionsMap = useMemo(() =>
        groups.map((g, i) => leafPositions(i, g.leaves.length)),
        [groups]);

    // Pan / zoom
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

    // Tooltip
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
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 flex items-center justify-center text-slate-400 text-sm gap-2" style={{ height: 120 }}>
                <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" strokeOpacity="0.25" /><path d="M12 2a10 10 0 0 1 10 10" /></svg>
                Building context graph…
            </div>
        );
    }

    return (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">

            {/* ── Header ───────────────────────────────────────────────────── */}
            <div className="px-5 py-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-2.5">
                    <div className="p-2 bg-indigo-50 rounded-lg border border-indigo-100">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2.2">
                            <circle cx="12" cy="12" r="3" /><circle cx="3" cy="12" r="2" /><circle cx="21" cy="12" r="2" />
                            <circle cx="12" cy="3" r="2" /><circle cx="12" cy="21" r="2" />
                            <line x1="5" y1="12" x2="9" y2="12" /><line x1="15" y1="12" x2="19" y2="12" />
                            <line x1="12" y1="5" x2="12" y2="9" /><line x1="12" y1="15" x2="12" y2="19" />
                        </svg>
                    </div>
                    <div>
                        <p className="font-bold text-slate-800 text-sm">Context Graph</p>
                        <p className="text-[11px] text-slate-500">Click a context node to expand · scroll to zoom · drag to pan</p>
                    </div>
                </div>

                <div className="flex items-center gap-1">
                    <button onClick={() => setExpanded(Object.fromEntries(groups.map(g => [g.id, true])))}
                        className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-slate-800 hover:bg-slate-100 px-2.5 py-1.5 rounded-lg transition-colors">
                        <ChevronDown size={12} /> Expand all
                    </button>
                    <button onClick={() => setExpanded({})}
                        className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-slate-800 hover:bg-slate-100 px-2.5 py-1.5 rounded-lg transition-colors">
                        <ChevronUp size={12} /> Collapse all
                    </button>
                    <div className="w-px h-4 bg-slate-200 mx-1" />
                    <button onClick={() => setVp(v => ({ ...v, scale: Math.min(2.5, v.scale * 1.2) }))}
                        className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors" title="Zoom in"><ZoomIn size={14} /></button>
                    <button onClick={() => setVp(v => ({ ...v, scale: Math.max(0.3, v.scale * 0.83) }))}
                        className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors" title="Zoom out"><ZoomOut size={14} /></button>
                    <button onClick={() => setVp({ x: 0, y: 0, scale: 1 })}
                        className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors" title="Reset"><Maximize2 size={14} /></button>
                </div>
            </div>

            {/* ── Legend ───────────────────────────────────────────────────── */}
            <div className="flex items-center gap-5 px-5 py-2 border-b border-slate-100 bg-white text-[11px] font-semibold flex-wrap">
                {groups.map(g => (
                    <span key={g.id} className="flex items-center gap-1.5 text-slate-600">
                        <span className="w-2 h-2 rounded-full" style={{ background: g.strokeColor }} />
                        {g.label}
                        <span className="font-normal text-slate-400">({g.leaves.length})</span>
                    </span>
                ))}
            </div>

            {/* ── Canvas ───────────────────────────────────────────────────── */}
            <div className="relative" style={{ height: 540, background: 'radial-gradient(ellipse at 50% 50%, #f8fafc 0%, #f1f5f9 100%)' }}>
                <svg
                    ref={svgRef}
                    width="100%" height="100%"
                    viewBox={`0 0 ${SVG_W} ${SVG_H}`}
                    preserveAspectRatio="xMidYMid meet"
                    onMouseDown={onMouseDown}
                    onMouseMove={onMouseMove}
                    onMouseUp={onMouseUp}
                    onMouseLeave={() => { onMouseUp(); hideTip(); }}
                    onWheel={onWheel}
                    style={{ userSelect: 'none', cursor: 'grab' }}
                >
                    <defs>
                        <filter id="cgShadow">
                            <feDropShadow dx="0" dy="2" stdDeviation="4" floodColor="#00000015" />
                        </filter>
                    </defs>

                    <g transform={`translate(${vp.x},${vp.y}) scale(${vp.scale})`}
                        style={{ transformOrigin: '500px 380px' }}>

                        {/* Guide rings — inner and outer leaf rings */}
                        {[CTX_R + 8, LEAF_R1 + 8, LEAF_R2 + 8].map(r => (
                            <circle key={r} cx={CX} cy={CY} r={r}
                                fill="none" stroke="#cbd5e1" strokeWidth="1"
                                strokeDasharray="5 4" opacity="0.4" />
                        ))}

                        {/* Edges: centre → context */}
                        {groups.map((g, i) => {
                            const cp = ctxPositions[i];
                            return <path key={`ce-${g.id}`} d={quadratic(CX, CY, cp.x, cp.y)}
                                fill="none" stroke={g.strokeColor} strokeWidth="2" opacity="0.25" />;
                        })}

                        {/* Edges: context → leaves (only when expanded) */}
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

                        {/* Leaf nodes (only when expanded) */}
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
                                                onMouseEnter={e => showTip(e, lf.label, lf.sublabel)}
                                                onMouseLeave={hideTip}
                                                data-node="1"
                                            >
                                                <rect width={LW} height={LH} rx={9}
                                                    fill={g.bgColor} stroke={g.strokeColor} strokeWidth="1.2" />
                                                <text x={LW / 2} y={13} textAnchor="middle"
                                                    fontSize="9.5" fontWeight="700" fill={g.textColor} fontFamily="system-ui,sans-serif">
                                                    {trunc(lf.label, 16)}
                                                </text>
                                                {lf.badgeText ? (
                                                    <>
                                                        <rect x={(LW - 52) / 2} y={17} width={52} height={13} rx={5}
                                                            fill={lf.badgeColor} opacity="0.12" />
                                                        <text x={LW / 2} y={27} textAnchor="middle"
                                                            fontSize="7.5" fontWeight="700" fill={lf.badgeColor} fontFamily="system-ui,sans-serif">
                                                            {trunc(lf.badgeText, 10)}
                                                        </text>
                                                    </>
                                                ) : (
                                                    <text x={LW / 2} y={28} textAnchor="middle"
                                                        fontSize="8.5" fill="#94a3b8" fontFamily="system-ui,sans-serif">
                                                        {trunc(lf.sublabel ?? '', 16)}
                                                    </text>
                                                )}
                                            </g>
                                        );
                                    })}
                                </React.Fragment>
                            );
                        })}

                        {/* Context nodes */}
                        {groups.map((g, gi) => {
                            const { x, y } = ctxPositions[gi];
                            const isExp = !!expanded[g.id];
                            return (
                                <g key={g.id}
                                    transform={`translate(${x - NW / 2},${y - NH / 2})`}
                                    onClick={() => toggleGroup(g.id)}
                                    onMouseEnter={e => showTip(e, g.label, `${g.leaves.length} items · ${isExp ? 'click to collapse' : 'click to expand'}`)}
                                    onMouseLeave={hideTip}
                                    data-node="1"
                                    style={{ cursor: 'pointer' }}
                                    filter="url(#cgShadow)"
                                >
                                    <rect width={NW} height={NH} rx={12}
                                        fill={g.bgColor}
                                        stroke={g.strokeColor}
                                        strokeWidth={isExp ? 2.5 : 1.5} />
                                    <text x={NW / 2} y={17} textAnchor="middle"
                                        fontSize="11" fontWeight="800" fill={g.textColor} fontFamily="system-ui,sans-serif">
                                        {g.label}
                                    </text>
                                    <text x={NW / 2} y={32} textAnchor="middle"
                                        fontSize="8.5" fill="#94a3b8" fontFamily="system-ui,sans-serif">
                                        {isExp ? `▴ ${g.leaves.length} items` : `▾ tap to expand`}
                                    </text>
                                </g>
                            );
                        })}

                        {/* Centre — Agent node */}
                        <g filter="url(#cgShadow)">
                            <rect x={CX - 70} y={CY - 32} width={140} height={64} rx={14}
                                fill="#0f172a" stroke="#1e293b" strokeWidth="2" />
                            <rect x={CX - 70} y={CY - 32} width={140} height={28} rx={14}
                                fill="#ffffff" fillOpacity="0.06" />
                        </g>
                        <text x={CX} y={CY - 8} textAnchor="middle"
                            fontSize="11" fontWeight="800" fill="#f1f5f9" fontFamily="system-ui,sans-serif">
                            {trunc(agent.name, 19)}
                        </text>
                        <text x={CX} y={CY + 12} textAnchor="middle"
                            fontSize="9" fill="#64748b" fontFamily="system-ui,sans-serif">
                            Agent
                        </text>
                    </g>
                </svg>

                {/* Tooltip */}
                {tip && (
                    <div className="absolute z-20 pointer-events-none"
                        style={{ left: tip.x + 8, top: tip.y - 44 }}>
                        <div className="bg-slate-900 text-white text-xs rounded-xl px-3 py-2 shadow-2xl max-w-[200px]">
                            <p className="font-bold">{tip.text}</p>
                            {tip.sub && <p className="text-slate-400 mt-0.5 text-[10px]">{tip.sub}</p>}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default AgentContextGraph;
