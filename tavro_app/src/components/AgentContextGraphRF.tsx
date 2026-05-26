// ── src/components/AgentContextGraphRF.tsx ────────────────────────────────────
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Panel,
  useNodesState, useEdgesState, useReactFlow,
  BackgroundVariant, Handle, Position,
  type Node, type Edge, type NodeProps, type FitViewOptions,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { AgentData } from '../types/agent';

// ── Types ─────────────────────────────────────────────────────────────────────

interface LeafNodeData { id: string; label: string; sublabel?: string; badgeText?: string; badgeColor?: string; }
interface SubContextGroup { id: string; label: string; leaves: LeafNodeData[]; count?: number; }
interface ContextGroup {
  id: string; label: string; bgColor: string; strokeColor: string; textColor: string;
  leaves: LeafNodeData[];
  subGroups?: SubContextGroup[];
}

const hasNonBlankText = (value: unknown): boolean =>
  typeof value === 'string' ? value.trim().length > 0 : value !== null && value !== undefined;

const normalizedLinkedUseCases = (agent: AgentData): any[] => {
  if (Array.isArray(agent.ai_use_cases) && agent.ai_use_cases.length) {
    return agent.ai_use_cases;
  }
  const fallback = (agent as any).ai_use_case;
  if (Array.isArray(fallback)) return fallback;
  return fallback ? [fallback] : [];
};

// ── Layout constants ──────────────────────────────────────────────────────────

const CAT_RING_R = 220; const LEAF_RING_R = 390;
const CAT_W = 120;  const CAT_H = 44;
const LEAF_W = 180; const LEAF_H = 48;
const CO_W = 160;   const CO_H = 56;
const SUBCTX_RING_R = 340; const SUBLEAF_RING_R = 520;
const SUBCTX_W = 128; const SUBCTX_H = 44;

function centerLabelFontSize(label: string) {
  const len = label.trim().length;
  if (len > 48) return 8.5;
  if (len > 36) return 9.5;
  if (len > 24) return 10.5;
  return 13;
}

// ── Colours ───────────────────────────────────────────────────────────────────

const TECH = { bg: '#eff6ff', stroke: '#3b82f6', text: '#1d4ed8' };
const FUNC = { bg: '#f5f3ff', stroke: '#8b5cf6', text: '#6d28d9' };
const BIZ = { bg: '#fff7ed', stroke: '#f97316', text: '#c2410c' };
const RISK = { bg: '#fff1f2', stroke: '#f43f5e', text: '#be123c' };

function critColor(v: string) { const l = v.toLowerCase(); return l.includes('high') || l.includes('critical') ? '#ef4444' : l.includes('medium') ? '#f59e0b' : '#10b981'; }
function riskColor(v: string) { const l = v.toLowerCase(); return (l === 'critical' || l === 'high') ? '#ef4444' : l === 'medium' ? '#f59e0b' : '#10b981'; }

// ── Data builder ──────────────────────────────────────────────────────────────

function buildGroups(agent: AgentData): ContextGroup[] {

  const linkedUseCases = normalizedLinkedUseCases(agent).filter((u: any) =>
    hasNonBlankText(u?.identifier ?? u?.use_case_id ?? u?.id ?? u?.name ?? u?.title),
  );

  const toolLeaves: LeafNodeData[] = (agent.tool ?? []).map((t, i) => ({
    id: `t-${i}-${t.name ?? 'tool'}`,
    label: t.name ?? `Tool ${i + 1}`,
    sublabel: 'Tool',
  }));


  const dsArr = Array.isArray(agent.data_source) ? agent.data_source : (agent.data_source && typeof agent.data_source === 'object' ? [agent.data_source] : []);

  const tableLeaves: LeafNodeData[] = dsArr
    .filter((ds: any) => (ds.target_object_type ?? '').toLowerCase() === 'table')
    .map((ds: any, i: number) => ({
      id: `ds-t-${i}-${ds.target_object_id ?? i}`,
      label: String(ds.target_object_name ?? 'Data Source'),
      sublabel: 'Table',
    }));

  const colLeaves: LeafNodeData[] = dsArr
    .filter((ds: any) => (ds.target_object_type ?? '').toLowerCase() === 'column')
    .map((ds: any, i: number) => ({
      id: `col-${i}-${ds.target_object_id ?? i}`,
      label: String(ds.target_object_name ?? 'Column'),
      sublabel: String(ds.source_object_name ?? ''),
    }));

  const funcLeaves = [...tableLeaves, ...colLeaves];

  // Business: split into three sub-groups
  const appLeaves: LeafNodeData[] = (agent.application ?? [])
    .filter((a) => hasNonBlankText(a?.identifier ?? a?.name))
    .map((a, i) => ({
      id: `app-${i}-${a.identifier ?? a.name ?? 'unknown'}`,
      label: a.name ?? `Application ${i + 1}`,
      sublabel: 'Application',
    }));

  const procLeaves: LeafNodeData[] = (agent.business_process ?? [])
    .filter((p) => hasNonBlankText(p?.identifier ?? p?.name))
    .map((p, i) => ({
      id: `proc-${i}-${p.identifier ?? 'unknown'}`,
      label: p.name ?? `Process ${i + 1}`,
      sublabel: 'Process',
    }));

  const ucLeaves: LeafNodeData[] = linkedUseCases.map((u, i) => {
    const uc = u as any;
    return {
      id: `uc-${i}-${uc.identifier ?? uc.use_case_id ?? uc.id ?? 'unknown'}`,
      label: uc.name ?? uc.title ?? `AI Use Case ${i + 1}`,
      sublabel: 'AI Use Case',
    };
  });

  const bizLeaves = [...appLeaves, ...procLeaves, ...ucLeaves];

  const ra = agent.risk_assessment;
  const riskLeaves: LeafNodeData[] = [];
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
    {
      id: 'tech', label: 'Technical', bgColor: TECH.bg, strokeColor: TECH.stroke, textColor: TECH.text,
      leaves: toolLeaves,
      subGroups: [
        { id: 'tool', label: 'Tool', leaves: toolLeaves.length ? toolLeaves : [{ id: 'tool0', label: 'No tools', sublabel: 'configured' }], count: toolLeaves.length },
      ],
    },
    {
      id: 'func', label: 'Functional', bgColor: FUNC.bg, strokeColor: FUNC.stroke, textColor: FUNC.text,
      leaves: funcLeaves,
      subGroups: [
        { id: 'ds',  label: 'Table',        leaves: tableLeaves.length ? tableLeaves : [{ id: 'ds0',  label: 'No tables', sublabel: 'configured' }], count: tableLeaves.length },
        { id: 'col', label: 'Column',      leaves: colLeaves.length  ? colLeaves   : [{ id: 'col0', label: 'No columns',       sublabel: 'configured' }], count: colLeaves.length },
      ],
    },
    {
      id: 'biz', label: 'Business', bgColor: BIZ.bg, strokeColor: BIZ.stroke, textColor: BIZ.text,
      leaves: bizLeaves,
      subGroups: [
        { id: 'app',  label: 'Application', leaves: appLeaves, count: appLeaves.length },
        { id: 'proc', label: 'Process',     leaves: procLeaves, count: procLeaves.length },
        { id: 'uc',   label: 'AI Use Case', leaves: ucLeaves, count: ucLeaves.length },
      ],
    },
    { id: 'risk', label: 'Risk', bgColor: RISK.bg, strokeColor: RISK.stroke, textColor: RISK.text, leaves: riskLeaves },
  ];
}

// ── Geometry ──────────────────────────────────────────────────────────────────

function ctxPos(i: number, n: number) {
  const a = (2 * Math.PI * i) / n - Math.PI / 2;
  return { x: CAT_RING_R * Math.cos(a) - CAT_W / 2, y: CAT_RING_R * Math.sin(a) - CAT_H / 2 };
}

function leafPos(ci: number, cn: number, li: number, ln: number) {
  const base = (2 * Math.PI * ci) / cn - Math.PI / 2;
  const t = ln === 1 ? 0 : (li / (ln - 1) - 0.5);
  const a = base + t * Math.min(Math.PI / (cn * 0.9), 0.65);
  const r = ln > 5 ? LEAF_RING_R + 40 : LEAF_RING_R;
  return { x: r * Math.cos(a) - LEAF_W / 2, y: r * Math.sin(a) - LEAF_H / 2 };
}

// Sub-context node positioned between context ring and leaf ring.
// Spread is dynamic: guarantees at least (SUBCTX_W + 30)px arc-gap between siblings.
function subctxPos(groupIdx: number, subIdx: number, subCount: number, groupCount: number) {
  const base = (2 * Math.PI * groupIdx) / groupCount - Math.PI / 2;
  const t = subCount <= 1 ? 0 : (subIdx / (subCount - 1) - 0.5);
  const minSpread = subCount <= 1 ? 0 : ((SUBCTX_W + 30) * (subCount - 1)) / SUBCTX_RING_R;
  const spread = Math.max(0.55, minSpread);
  const a = base + t * spread;
  return { x: SUBCTX_RING_R * Math.cos(a) - SUBCTX_W / 2, y: SUBCTX_RING_R * Math.sin(a) - SUBCTX_H / 2 };
}

// Leaf node for sub-context, fanned out from the sub-context angle.
function subLeafPos(groupIdx: number, subIdx: number, subCount: number, leafIdx: number, leafCount: number, groupCount: number) {
  const base = (2 * Math.PI * groupIdx) / groupCount - Math.PI / 2;
  const subT = subCount <= 1 ? 0 : (subIdx / (subCount - 1) - 0.5);
  const minSpread = subCount <= 1 ? 0 : ((SUBCTX_W + 30) * (subCount - 1)) / SUBCTX_RING_R;
  const spread = Math.max(0.55, minSpread);
  const subAngle = base + subT * spread;
  const t = leafCount <= 1 ? 0 : (leafIdx / (leafCount - 1) - 0.5);
  const a = subAngle + t * 0.45;
  return { x: SUBLEAF_RING_R * Math.cos(a) - LEAF_W / 2, y: SUBLEAF_RING_R * Math.sin(a) - LEAF_H / 2 };
}

// ── Node components ───────────────────────────────────────────────────────────

const AgentNode: React.FC<NodeProps> = ({ data }) => {
  const d = data as { label: string };
  const labelFontSize = centerLabelFontSize(d.label);
  return (
    <div style={{
      width: CO_W, height: CO_H, background: '#1e40af', borderRadius: 14,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      cursor: 'default', userSelect: 'none', boxShadow: '0 4px 16px rgba(30,64,175,0.3)',
    }}>
      <Handle type="target" position={Position.Top} style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)', opacity: 0 }} />
      <Handle type="source" position={Position.Top} style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)', opacity: 0 }} />
      <p title={d.label} style={{
        width: '100%', fontSize: labelFontSize, fontWeight: 700, color: '#f1f5f9', margin: 0,
        textAlign: 'center', padding: '0 8px', lineHeight: 1.05, overflow: 'hidden',
        display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
        wordBreak: 'normal',
      }}>{d.label}</p>
      <p style={{ fontSize: 8, color: '#93c5fd', margin: '1px 0 0', letterSpacing: '0.04em' }}>AGENT</p>
    </div>
  );
};

const ContextNode: React.FC<NodeProps> = ({ data }) => {
  const d = data as { label: string; count: number; expanded: boolean; bgColor: string; strokeColor: string; textColor: string };
  return (
    <div style={{
      width: CAT_W, height: CAT_H, background: d.bgColor,
      border: `${d.expanded ? 2 : 1.5}px solid ${d.strokeColor}`, borderRadius: 12,
      display: 'flex', alignItems: 'center', padding: '0 10px', gap: 7,
      cursor: 'pointer', userSelect: 'none',
      boxShadow: d.expanded ? `0 0 0 3px ${d.strokeColor}30` : 'none', transition: 'box-shadow .15s',
    }}>
      <Handle type="target" position={Position.Top} style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)', opacity: 0 }} />
      <Handle type="source" position={Position.Top} style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)', opacity: 0 }} />
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: d.strokeColor, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 11, fontWeight: 600, color: d.textColor, margin: 0, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.label}</p>
        <p style={{ fontSize: 9, color: d.strokeColor, margin: 0, opacity: 0.8 }}>{d.count} item{d.count !== 1 ? 's' : ''} {d.expanded ? '▴' : '▾'}</p>
      </div>
    </div>
  );
};

const SubContextNode: React.FC<NodeProps> = ({ data }: NodeProps) => {
  const d = data as { label: string; count: number; expanded: boolean; bgColor: string; strokeColor: string; textColor: string };
  return (
    <div className="rf-subctx" style={{
      width: SUBCTX_W, height: SUBCTX_H, background: d.bgColor,
      border: `${d.expanded ? 2 : 1.5}px solid ${d.strokeColor}`, borderRadius: 10,
      display: 'flex', alignItems: 'center', padding: '0 9px', gap: 7,
      cursor: 'pointer', userSelect: 'none',
      boxShadow: d.expanded ? `0 0 0 3px ${d.strokeColor}28` : '0 1px 4px rgba(0,0,0,0.07)', transition: 'box-shadow .15s',
    }}>
      <Handle type="target" position={Position.Top} style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)', opacity: 0 }} />
      <Handle type="source" position={Position.Top} style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)', opacity: 0 }} />
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: d.strokeColor, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 10.5, fontWeight: 600, color: d.textColor, margin: 0, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.label}</p>
        <p style={{ fontSize: 8.5, color: d.strokeColor, margin: 0, opacity: 0.75 }}>{d.count} item{d.count !== 1 ? 's' : ''} {d.expanded ? '▴' : '▾'}</p>
      </div>
    </div>
  );
};

const LeafNode: React.FC<NodeProps> = ({ data }) => {
  const d = data as { label: string; sublabel?: string; badgeText?: string; badgeColor?: string; bgColor: string; strokeColor: string; textColor: string };
  return (
    <div className="rf-leaf" style={{
      width: LEAF_W, minHeight: LEAF_H, background: d.bgColor,
      border: `1px solid ${d.strokeColor}45`, borderRadius: 10,
      display: 'flex', alignItems: 'flex-start', padding: '8px 10px', gap: 8,
      cursor: 'default', userSelect: 'none', position: 'relative',
      boxShadow: `0 1px 4px rgba(0,0,0,0.07), 0 0 0 0px ${d.strokeColor}`,
      transition: 'box-shadow .15s, border-color .15s',
    }}>
      <Handle type="target" position={Position.Top} style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)', opacity: 0 }} />
      <Handle type="source" position={Position.Top} style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)', opacity: 0 }} />
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: d.strokeColor, flexShrink: 0, marginTop: 3 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 11, fontWeight: 600, color: d.textColor, margin: 0, lineHeight: 1.4, wordBreak: 'break-word' }}>{d.label}</p>
        {d.badgeText ? (
          <div style={{ background: `${d.badgeColor}1e`, padding: '1px 7px', borderRadius: 5, marginTop: 3, width: 'fit-content', maxWidth: '100%' }}>
            <p style={{ fontSize: 7.5, fontWeight: 700, color: d.badgeColor, margin: 0 }}>{d.badgeText}</p>
          </div>
        ) : (
          <p style={{ fontSize: 9, color: d.strokeColor, margin: 0, opacity: 0.75, marginTop: 1 }}>{d.sublabel}</p>
        )}
      </div>
    </div>
  );
};

const nodeTypes = { agent: AgentNode, context: ContextNode, subctx: SubContextNode, leaf: LeafNode };

// ── Build flow ────────────────────────────────────────────────────────────────

function buildFlow(groups: ContextGroup[], agentName: string, expanded: Set<string>, subExpanded: Set<string>) {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  nodes.push({ id: '__agent', type: 'agent', position: { x: -CO_W / 2, y: -CO_H / 2 }, data: { label: agentName }, draggable: false, selectable: false });

  groups.forEach((g, gi) => {
    const isExp = expanded.has(g.id);
    const contextCount = g.subGroups ? g.subGroups.length : g.leaves.length;
    nodes.push({
      id: `ctx_${g.id}`, type: 'context', position: ctxPos(gi, groups.length),
      data: { label: g.label, count: contextCount, expanded: isExp, bgColor: g.bgColor, strokeColor: g.strokeColor, textColor: g.textColor },
      draggable: false
    });

    edges.push({
      id: `e_ag_${g.id}`, source: '__agent', target: `ctx_${g.id}`, type: 'straight',
      style: { stroke: g.strokeColor, strokeWidth: isExp ? 2.5 : 1.5, opacity: isExp ? 0.5 : 0.25 }
    });

    if (isExp) {
      if (g.subGroups) {
        // Business: render Application, Process, AI Use Case as intermediate nodes
        g.subGroups.forEach((sg, si) => {
          const subNodeId = `sub_${g.id}_${sg.id}`;
          const isSubExp = subExpanded.has(subNodeId);
          nodes.push({
            id: subNodeId, type: 'subctx',
            position: subctxPos(gi, si, g.subGroups!.length, groups.length),
            data: { label: sg.label, count: sg.count ?? sg.leaves.length, expanded: isSubExp, bgColor: g.bgColor, strokeColor: g.strokeColor, textColor: g.textColor },
          });
          edges.push({
            id: `e_ctx_${subNodeId}`, source: `ctx_${g.id}`, target: subNodeId, type: 'straight',
            style: { stroke: g.strokeColor, strokeWidth: isSubExp ? 2 : 1.2, strokeDasharray: isSubExp ? undefined : '5 3', opacity: isSubExp ? 0.45 : 0.3 },
          });

          if (isSubExp) {
            sg.leaves.forEach((lf, li) => {
              const lid = `lf_${subNodeId}_${lf.id}`;
              nodes.push({
                id: lid, type: 'leaf',
                position: subLeafPos(gi, si, g.subGroups!.length, li, sg.leaves.length, groups.length),
                data: { ...lf, bgColor: g.bgColor, strokeColor: g.strokeColor, textColor: g.textColor },
              });
              edges.push({
                id: `e_sub_${lid}`, source: subNodeId, target: lid, type: 'straight',
                style: { stroke: g.strokeColor, strokeWidth: 1, strokeDasharray: '4 3', opacity: 0.35 },
              });
            });
          }
        });
      } else {
        // Standard flat leaf expansion for Tech, Functional, Risk
        g.leaves.forEach((lf, li) => {
          const lid = `lf_${g.id}_${lf.id}`;
          nodes.push({
            id: lid, type: 'leaf', position: leafPos(gi, groups.length, li, g.leaves.length),
            data: { ...lf, bgColor: g.bgColor, strokeColor: g.strokeColor, textColor: g.textColor }
          });
          edges.push({
            id: `e_ctx_${lid}`, source: `ctx_${g.id}`, target: lid, type: 'straight',
            style: { stroke: g.strokeColor, strokeWidth: 1, strokeDasharray: '4 3', opacity: 0.35 }
          });
        });
      }
    }
  });

  return { nodes, edges };
}

// ── Component ─────────────────────────────────────────────────────────────────

const FIT: FitViewOptions = { padding: 0.18, maxZoom: 1.4 };

const Inner: React.FC<{ agent: AgentData }> = ({ agent }) => {
  const { fitView } = useReactFlow();
  const [exp, setExp] = useState<Set<string>>(new Set());
  const [subExp, setSubExp] = useState<Set<string>>(new Set());

  const groups = useMemo(() => buildGroups(agent), [agent]);
  const agentName = agent.name ?? 'Unknown Agent';

  useEffect(() => { setExp(new Set()); setSubExp(new Set()); }, [agentName]);

  const { nodes: bn, edges: be } = useMemo(() => buildFlow(groups, agentName, exp, subExp), [groups, agentName, exp, subExp]);
  const [nodes, setNodes, onNodesChange] = useNodesState(bn);
  const [edges, setEdges, onEdgesChange] = useEdgesState(be);

  useEffect(() => {
    setNodes(bn);
    setEdges(be);
  }, [bn, be, setNodes, setEdges]);

  useEffect(() => { setTimeout(() => fitView(FIT), 80); }, [exp, subExp, fitView]);

  const toggle = useCallback((cat: string) => setExp(p => { const s = new Set(p); s.has(cat) ? s.delete(cat) : s.add(cat); return s; }), []);
  const toggleSub = useCallback((subId: string) => setSubExp((p: Set<string>) => { const s = new Set(p); s.has(subId) ? s.delete(subId) : s.add(subId); return s; }), []);

  const handleClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (node.type === 'context') toggle(node.id.replace('ctx_', ''));
    if (node.type === 'subctx') toggleSub(node.id);
  }, [toggle, toggleSub]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex-shrink-0 gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-indigo-50 dark:bg-indigo-950/50 rounded-lg border border-indigo-100 dark:border-indigo-900/60 text-indigo-600 dark:text-indigo-300">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <circle cx="12" cy="12" r="3" />
              <circle cx="4" cy="6" r="2" />
              <circle cx="20" cy="6" r="2" />
              <circle cx="4" cy="18" r="2" />
              <circle cx="20" cy="18" r="2" />
              <path d="M6 7.2 9.5 10" />
              <path d="M18 7.2 14.5 10" />
              <path d="M6 16.8 9.5 14" />
              <path d="M18 16.8 14.5 14" />
            </svg>
          </div>
          <div>
            <p className="font-bold text-slate-800 dark:text-slate-100 text-sm">Context Graph</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">Click a context node to expand · scroll to zoom · drag to pan</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {groups.map((g) => {
            const on = exp.has(g.id);
            return (
              <button key={g.id} onClick={() => toggle(g.id)}
                className="text-[10px] font-bold px-2 py-0.5 rounded-full border transition-all"
                style={on ? { background: g.strokeColor, color: '#fff', borderColor: g.strokeColor } : { background: g.bgColor, color: g.textColor, borderColor: g.strokeColor + '50' }}>
                {g.label} {g.leaves.length}
              </button>
            );
          })}
          {(exp.size > 0 || subExp.size > 0) && (
            <button onClick={() => { setExp(new Set()); setSubExp(new Set()); }}
              className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-slate-700 transition-colors">
              Collapse all
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          onNodeClick={handleClick} nodeTypes={nodeTypes} fitView fitViewOptions={FIT}
          minZoom={0.1} maxZoom={2.5} proOptions={{ hideAttribution: true }}>
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#cbd5e1" />
          <Controls showInteractive={false} style={{ background: 'var(--color-background-primary)', border: '0.5px solid var(--color-border-tertiary)' }} />
          <MiniMap nodeColor={n => n.type === 'agent' ? '#1e40af' : ((n.data as any).strokeColor ?? '#cbd5e1')}
            pannable zoomable style={{ background: 'var(--color-background-primary)', border: '0.5px solid var(--color-border-tertiary)', borderRadius: 8 }} />
          <Panel position="top-right">
            <button onClick={() => fitView(FIT)} className="text-[10px] font-bold text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 px-2.5 py-1.5 rounded-lg shadow-sm">
              Fit view
            </button>
          </Panel>
          <Panel position="bottom-center">
            <p className="text-[10px] text-slate-400 bg-white/70 dark:bg-slate-900/70 px-2 py-0.5 rounded">
              Click category to expand · drag to pan · scroll to zoom
            </p>
          </Panel>
        </ReactFlow>
      </div>
    </div>
  );
};

const AgentContextGraphRF: React.FC<{ agent: AgentData }> = ({ agent }) => (
  <>
    <style>{`
      @keyframes rfNodeIn {
        from { opacity: 0; transform: scale(0.82); }
        to   { opacity: 1; transform: scale(1); }
      }
      .rf-leaf   { animation: rfNodeIn 0.18s cubic-bezier(0.34,1.56,0.64,1) both; }
      .rf-subctx { animation: rfNodeIn 0.15s cubic-bezier(0.34,1.56,0.64,1) both; }
      .rf-leaf:hover   { box-shadow: 0 0 0 2px var(--leaf-stroke, #94a3b8) !important; }
    `}</style>
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden transition-colors" style={{ height: 580 }}>
      <ReactFlowProvider><Inner agent={agent} /></ReactFlowProvider>
    </div>
  </>
);

export default AgentContextGraphRF;
