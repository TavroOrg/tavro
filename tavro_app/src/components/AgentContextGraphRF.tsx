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
interface ContextGroup {
  id: string; label: string; bgColor: string; strokeColor: string; textColor: string;
  leaves: LeafNodeData[];
}

// ── Layout constants ──────────────────────────────────────────────────────────

const CAT_RING_R = 220; const LEAF_RING_R = 390;
const CAT_W = 120;  const CAT_H = 44;
const LEAF_W = 156; const LEAF_H = 48;
const CO_W = 160;   const CO_H = 56;

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
  const id = agent.identification ?? {} as any;
  const cfg = agent.configuration ?? {} as any;
  const linkedUseCases = Array.isArray(agent.ai_use_cases) && agent.ai_use_cases.length
    ? agent.ai_use_cases
    : (agent.ai_use_case ? [agent.ai_use_case] : []);

  const toolLeaves: LeafNodeData[] = (agent.tool ?? []).slice(0, 5).map((t, i) => ({
    id: `t-${i}-${t.name ?? 'tool'}`,
    label: t.name ?? `Tool ${i + 1}`,
    sublabel: 'Tool',
  }));

  const techLeaves: LeafNodeData[] = [
    id.role && { id: 'role', label: 'Role', sublabel: id.role },
    id.environment && { id: 'env', label: 'Environment', sublabel: id.environment },
    id.owner && { id: 'owner', label: 'Owner', sublabel: id.owner },
    cfg.autonomy_level && { id: 'auto', label: 'Autonomy', sublabel: cfg.autonomy_level },
    cfg.access_scope && { id: 'scope', label: 'Access Scope', sublabel: cfg.access_scope },
    cfg.memory_type && { id: 'mem', label: 'Memory', sublabel: cfg.memory_type },
    cfg.reasoning_model && { id: 'llm', label: 'LLM Model', sublabel: cfg.reasoning_model },
    ...toolLeaves,
  ].filter(Boolean) as LeafNodeData[];

  const funcLeaves: LeafNodeData[] = [
    ...(agent.data_source ?? []).slice(0, 4).map((ds, i) => ({
      id: `ds-${i}`, label: ds.source_object_name ?? 'Data Source', sublabel: ds.source_object_type,
    })),
  ];
  if (!funcLeaves.length) funcLeaves.push({ id: 'fn0', label: 'No data sources', sublabel: 'configured' });

  const bizLeaves: LeafNodeData[] = [
    ...(agent.application ?? []).slice(0, 5).map((a, i) => ({
      id: `app-${i}-${a.identifier ?? a.name ?? 'unknown'}`,
      label: a.name ?? `Application ${i + 1}`,
      sublabel: a.business_criticality ?? undefined,
      badgeText: a.business_criticality ?? undefined,
      badgeColor: a.business_criticality ? critColor(a.business_criticality) : undefined,
    })),
    ...(agent.business_process ?? []).slice(0, 3).map((p, i) => ({
      id: `proc-${i}-${p.identifier ?? 'unknown'}`,
      label: p.name ?? `Process ${i + 1}`,
      sublabel: 'Process',
    })),
    ...linkedUseCases.slice(0, 3).map((u, i) => {
      const uc = u as any;
      return {
        id: `uc-${i}-${uc.identifier ?? uc.use_case_id ?? uc.id ?? 'unknown'}`,
        label: uc.name ?? uc.title ?? `AI Use Case ${i + 1}`,
        sublabel: 'AI Use Case',
      };
    }),
  ];
  if (!bizLeaves.length) bizLeaves.push({ id: 'bz0', label: 'No business context', sublabel: 'recorded' });

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
    { id: 'tech', label: 'Technical', bgColor: TECH.bg, strokeColor: TECH.stroke, textColor: TECH.text, leaves: techLeaves },
    { id: 'func', label: 'Functional', bgColor: FUNC.bg, strokeColor: FUNC.stroke, textColor: FUNC.text, leaves: funcLeaves },
    { id: 'biz', label: 'Business', bgColor: BIZ.bg, strokeColor: BIZ.stroke, textColor: BIZ.text, leaves: bizLeaves },
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

const LeafNode: React.FC<NodeProps> = ({ data }) => {
  const d = data as { label: string; sublabel?: string; badgeText?: string; badgeColor?: string; bgColor: string; strokeColor: string; textColor: string };
  return (
    <div style={{
      width: LEAF_W, height: LEAF_H, background: d.bgColor,
      border: `1px solid ${d.strokeColor}80`, borderRadius: 10,
      display: 'flex', alignItems: 'center', padding: '0 10px', gap: 8,
      cursor: 'default', userSelect: 'none', position: 'relative'
    }}>
      <Handle type="target" position={Position.Top} style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)', opacity: 0 }} />
      <Handle type="source" position={Position.Top} style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)', opacity: 0 }} />
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: d.strokeColor, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 11, fontWeight: 600, color: d.textColor, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3 }}>{d.label}</p>
        {d.badgeText ? (
          <div style={{ background: `${d.badgeColor}1e`, padding: '1px 7px', borderRadius: 5, marginTop: 2, width: 'fit-content', maxWidth: '100%' }}>
            <p style={{ fontSize: 7.5, fontWeight: 700, color: d.badgeColor, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.badgeText}</p>
          </div>
        ) : (
          <p style={{ fontSize: 9, color: d.strokeColor, margin: 0, opacity: 0.75, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.sublabel}</p>
        )}
      </div>
    </div>
  );
};

const nodeTypes = { agent: AgentNode, context: ContextNode, leaf: LeafNode };

// ── Build flow ────────────────────────────────────────────────────────────────

function buildFlow(groups: ContextGroup[], agentName: string, expanded: Set<string>) {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  nodes.push({ id: '__agent', type: 'agent', position: { x: -CO_W / 2, y: -CO_H / 2 }, data: { label: agentName }, draggable: false, selectable: false });

  groups.forEach((g, gi) => {
    const isExp = expanded.has(g.id);
    nodes.push({ 
      id: `ctx_${g.id}`, type: 'context', position: ctxPos(gi, groups.length), 
      data: { label: g.label, count: g.leaves.length, expanded: isExp, bgColor: g.bgColor, strokeColor: g.strokeColor, textColor: g.textColor }, 
      draggable: false 
    });
    
    edges.push({ 
      id: `e_ag_${g.id}`, source: '__agent', target: `ctx_${g.id}`, type: 'straight', 
      style: { stroke: g.strokeColor, strokeWidth: isExp ? 2.5 : 1.5, opacity: isExp ? 0.5 : 0.25 } 
    });

    if (isExp) {
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
  });

  return { nodes, edges };
}

// ── Component ─────────────────────────────────────────────────────────────────

const FIT: FitViewOptions = { padding: 0.18, maxZoom: 1.4 };

const Inner: React.FC<{ agent: AgentData }> = ({ agent }) => {
  const { fitView } = useReactFlow();
  const [exp, setExp] = useState<Set<string>>(new Set());
  
  const groups = useMemo(() => buildGroups(agent), [agent]);
  const agentName = agent.name ?? 'Unknown Agent';

  useEffect(() => { setExp(new Set()); }, [agentName]);

  const { nodes: bn, edges: be } = useMemo(() => buildFlow(groups, agentName, exp), [groups, agentName, exp]);
  const [nodes, setNodes, onNodesChange] = useNodesState(bn);
  const [edges, setEdges, onEdgesChange] = useEdgesState(be);

  useEffect(() => {
    setNodes(bn);
    setEdges(be);
  }, [bn, be, setNodes, setEdges]);

  useEffect(() => { setTimeout(() => fitView(FIT), 80); }, [exp, fitView]);

  const toggle = useCallback((cat: string) => setExp(p => { const s = new Set(p); s.has(cat) ? s.delete(cat) : s.add(cat); return s; }), []);

  const handleClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (node.type === 'context') toggle(node.id.replace('ctx_', ''));
  }, [toggle]);

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
          {exp.size > 0 && (
            <button onClick={() => setExp(new Set())}
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
  <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden transition-colors" style={{ height: 580 }}>
    <ReactFlowProvider><Inner agent={agent} /></ReactFlowProvider>
  </div>
);

export default AgentContextGraphRF;
