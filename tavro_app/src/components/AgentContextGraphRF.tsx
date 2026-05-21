// ── src/components/AgentContextGraphRF.tsx ────────────────────────────────────
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Panel,
  useNodesState, useEdgesState, useReactFlow,
  MarkerType, BackgroundVariant, Handle, Position,
  type Node, type Edge, type NodeProps, type FitViewOptions,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { AgentData } from '../types/agent';
import { Cpu, Wrench, Building2, ShieldAlert } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface LeafNodeData { id: string; label: string; sublabel?: string; badgeText?: string; badgeColor?: string; }
interface ContextGroup {
  id: string; label: string; bgColor: string; strokeColor: string; textColor: string;
  leaves: LeafNodeData[];
}

// ── Layout constants ──────────────────────────────────────────────────────────

const CTX_R = 200;
const LEAF_R1 = 340;
const LEAF_R2 = 440;
const MAX_INNER = 4;
const NW = 112, NH = 46;        // context node size
const LW = 126, LH = 36;        // leaf node size
const AW = 140, AH = 64;        // agent node size

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

  const techLeaves: LeafNodeData[] = [
    id.role && { id: 'role', label: 'Role', sublabel: id.role },
    id.environment && { id: 'env', label: 'Environment', sublabel: id.environment },
    id.owner && { id: 'owner', label: 'Owner', sublabel: id.owner },
    cfg.autonomy_level && { id: 'auto', label: 'Autonomy', sublabel: cfg.autonomy_level },
    cfg.access_scope && { id: 'scope', label: 'Access Scope', sublabel: cfg.access_scope },
    cfg.memory_type && { id: 'mem', label: 'Memory', sublabel: cfg.memory_type },
    cfg.reasoning_model && { id: 'llm', label: 'LLM Model', sublabel: cfg.reasoning_model },
  ].filter(Boolean) as LeafNodeData[];

  const toolArr = Array.isArray(agent.tool) ? agent.tool : (agent.tool && typeof agent.tool === 'object' ? [agent.tool] : []);
  const dsArr = Array.isArray(agent.data_source) ? agent.data_source : (agent.data_source && typeof agent.data_source === 'object' ? [agent.data_source] : []);
  const funcLeaves: LeafNodeData[] = [
    ...toolArr.slice(0, 5).map((t: any) => ({ id: `t-${t.name ?? t.tool_name ?? 'tool'}`, label: String(t.name ?? t.tool_name ?? 'Tool'), sublabel: 'Tool' })),
    ...dsArr.slice(0, 4).map((ds: any, i: number) => ({
      id: `ds-${i}`, label: String(ds.source_object_name ?? ds.source_name ?? ds.source ?? 'Data Source'), sublabel: String(ds.source_object_type ?? ds.type ?? ''),
    })),
  ];
  if (!funcLeaves.length) funcLeaves.push({ id: 'fn0', label: 'No tools/sources', sublabel: 'configured' });

  const bizLeaves: LeafNodeData[] = [
    ...(agent.application ?? []).slice(0, 5).map((a, i) => ({
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
  return { x: CTX_R * Math.cos(a) - NW / 2, y: CTX_R * Math.sin(a) - NH / 2 };
}

function leafPos(ci: number, cn: number, li: number, ln: number) {
  const base = (2 * Math.PI * ci) / cn - Math.PI / 2;
  const MAX_SPREAD = Math.PI * 0.4;
  const MIN_STEP = 0.28;

  const innerCount = Math.min(ln, MAX_INNER);
  const outerCount = ln - innerCount;
  
  const isOuter = li >= innerCount;
  const items = isOuter ? outerCount : innerCount;
  const index = isOuter ? li - innerCount : li;
  const radius = isOuter ? LEAF_R2 : LEAF_R1;

  const spread = items === 1 ? 0 : Math.min(MAX_SPREAD, (items - 1) * MIN_STEP);
  const a = items === 1 ? base : base - spread / 2 + (spread / (items - 1)) * index;
  
  return { x: radius * Math.cos(a) - LW / 2, y: radius * Math.sin(a) - LH / 2 };
}

// ── Node components ───────────────────────────────────────────────────────────

const AgentNode: React.FC<NodeProps> = ({ data }) => {
  const d = data as { label: string };
  return (
    <div style={{
      width: AW, height: AH, background: '#0f172a', borderRadius: 14, border: '2px solid #1e293b',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      cursor: 'default', userSelect: 'none', boxShadow: '0 4px 16px rgba(15,23,42,0.3)',
      position: 'relative'
    }}>
      <Handle type="target" position={Position.Top} style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)', opacity: 0 }} />
      <Handle type="source" position={Position.Top} style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)', opacity: 0 }} />
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: '#ffffff', opacity: 0.06, borderRadius: 12, pointerEvents: 'none' }} />
      <p style={{ fontSize: 11, fontWeight: 800, color: '#f1f5f9', margin: 0, textAlign: 'center', padding: '0 10px', lineHeight: 1.3 }}>{d.label}</p>
      <p style={{ fontSize: 9, color: '#64748b', margin: '2px 0 0', letterSpacing: '0.05em' }}>Agent</p>
    </div>
  );
};

const ContextNode: React.FC<NodeProps> = ({ data }) => {
  const d = data as { label: string; count: number; expanded: boolean; bgColor: string; strokeColor: string; textColor: string };
  return (
    <div style={{
      width: NW, height: NH, background: d.bgColor,
      border: `${d.expanded ? 2.5 : 1.5}px solid ${d.strokeColor}`, borderRadius: 12,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      cursor: 'pointer', userSelect: 'none',
      boxShadow: d.expanded ? `0 0 0 3px ${d.strokeColor}30` : '0 2px 8px rgba(0,0,0,0.05)', transition: 'box-shadow .15s',
    }}>
      <Handle type="target" position={Position.Top} style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)', opacity: 0 }} />
      <Handle type="source" position={Position.Top} style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)', opacity: 0 }} />
      <p style={{ fontSize: 11, fontWeight: 800, color: d.textColor, margin: 0 }}>{d.label}</p>
      <p style={{ fontSize: 8.5, color: '#94a3b8', margin: '2px 0 0' }}>{d.expanded ? `▴ ${d.count} items` : `▾ tap to expand`}</p>
    </div>
  );
};

const LeafNode: React.FC<NodeProps> = ({ data }) => {
  const d = data as { label: string; sublabel?: string; badgeText?: string; badgeColor?: string; bgColor: string; strokeColor: string; textColor: string };
  return (
    <div style={{
      width: LW, height: LH, background: d.bgColor,
      border: `1.2px solid ${d.strokeColor}`, borderRadius: 9,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      cursor: 'default', userSelect: 'none', position: 'relative'
    }}>
      <Handle type="target" position={Position.Top} style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)', opacity: 0 }} />
      <Handle type="source" position={Position.Top} style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)', opacity: 0 }} />
      <p style={{ fontSize: 9.5, fontWeight: 700, color: d.textColor, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%', textAlign: 'center', padding: '0 4px' }}>{d.label}</p>
      
      {d.badgeText ? (
        <div style={{ background: `${d.badgeColor}1e`, padding: '1px 8px', borderRadius: 5, marginTop: 2 }}>
          <p style={{ fontSize: 7.5, fontWeight: 700, color: d.badgeColor, margin: 0 }}>{d.badgeText}</p>
        </div>
      ) : (
        <p style={{ fontSize: 8.5, color: '#94a3b8', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%', textAlign: 'center', padding: '0 4px' }}>{d.sublabel}</p>
      )}
    </div>
  );
};

const nodeTypes = { agent: AgentNode, context: ContextNode, leaf: LeafNode };

// ── Build flow ────────────────────────────────────────────────────────────────

function buildFlow(groups: ContextGroup[], agentName: string, expanded: Set<string>) {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  nodes.push({ id: '__agent', type: 'agent', position: { x: -AW / 2, y: -AH / 2 }, data: { label: agentName }, draggable: false, selectable: false });

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
    <div className="flex flex-col h-full bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden" style={{ height: 540 }}>
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
              className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-slate-200 text-slate-400 hover:text-slate-700 transition-colors ml-1">
              Collapse all
            </button>
          )}
        </div>
      </div>
      
      <div className="flex-1 min-h-0 relative" style={{ background: 'radial-gradient(ellipse at 50% 50%, #f8fafc 0%, #f1f5f9 100%)' }}>
        <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          onNodeClick={handleClick} nodeTypes={nodeTypes} fitView fitViewOptions={FIT}
          minZoom={0.1} maxZoom={2.5} proOptions={{ hideAttribution: true }}>
          <Controls showInteractive={false} style={{ background: '#fff', border: '0.5px solid #e2e8f0' }} />
          <MiniMap nodeColor={n => n.type === 'agent' ? '#0f172a' : ((n.data as any).strokeColor ?? '#cbd5e1')}
            pannable zoomable style={{ background: '#fff', border: '0.5px solid #e2e8f0', borderRadius: 8 }} />
          <Panel position="top-right">
            <button onClick={() => fitView(FIT)} className="text-[10px] font-bold text-slate-500 bg-white border border-slate-200 hover:bg-slate-50 px-2.5 py-1.5 rounded-lg shadow-sm">
              Fit view
            </button>
          </Panel>
        </ReactFlow>
      </div>
    </div>
  );
};

const AgentContextGraphRF: React.FC<{ agent: AgentData }> = ({ agent }) => (
  <ReactFlowProvider><Inner agent={agent} /></ReactFlowProvider>
);

export default AgentContextGraphRF;
