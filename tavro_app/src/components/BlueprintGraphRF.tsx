// ── src/components/BlueprintGraphRF.tsx ──────────────────────────────────────
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Panel,
  useNodesState, useEdgesState, useReactFlow,
  MarkerType, BackgroundVariant, Handle, Position,
  type Node, type Edge, type NodeProps, type FitViewOptions,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { GraphData, DimCategory } from '../types/blueprint';
import { CATEGORY_PALETTE, CATEGORY_LABELS } from '../types/blueprint';

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

const CAT_RANK: Record<DimCategory, number> = {
  profile:0, strategy:1, organisation:2, process:3,
  application:4, technology:5, risk:6, finance:7, integration:8, custom:9,
};

function catPos(i: number, n: number) {
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

// ── Node components — all use NodeProps so NodeTypes is satisfied ─────────────

const CompanyNode: React.FC<NodeProps> = ({ data }) => {
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
      <p style={{ fontSize: 8, color: '#93c5fd', margin: '1px 0 0', letterSpacing: '0.04em' }}>COMPANY BLUEPRINT</p>
    </div>
  );
};

const CategoryNode: React.FC<NodeProps> = ({ data }) => {
  const d = data as { category: DimCategory; count: number; expanded: boolean };
  const p = CATEGORY_PALETTE[d.category] ?? CATEGORY_PALETTE.custom;
  return (
    <div style={{
      width: CAT_W, height: CAT_H, background: p.bg,
      border: `${d.expanded ? 2 : 1.5}px solid ${p.stroke}`, borderRadius: 12,
      display: 'flex', alignItems: 'center', padding: '0 10px', gap: 7,
      cursor: 'pointer', userSelect: 'none',
      boxShadow: d.expanded ? `0 0 0 3px ${p.stroke}30` : 'none', transition: 'box-shadow .15s',
    }}>
      <Handle type="target" position={Position.Top} style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)', opacity: 0 }} />
      <Handle type="source" position={Position.Top} style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)', opacity: 0 }} />
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: p.stroke, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 11, fontWeight: 600, color: p.text, margin: 0, lineHeight: 1.2 }}>
          {CATEGORY_LABELS[d.category] ?? d.category}
        </p>
        <p style={{ fontSize: 9, color: p.stroke, margin: 0, opacity: 0.8 }}>
          {d.count} dim{d.count !== 1 ? 's' : ''} {d.expanded ? '▴' : '▾'}
        </p>
      </div>
    </div>
  );
};

const LeafNode: React.FC<NodeProps> = ({ data, selected }) => {
  const d = data as { label: string; category: DimCategory };
  const p = CATEGORY_PALETTE[d.category] ?? CATEGORY_PALETTE.custom;
  return (
    <div style={{
      width: LEAF_W, height: LEAF_H, background: p.bg,
      border: `${selected ? 2 : 1}px solid ${selected ? p.stroke : p.badge}`, borderRadius: 10,
      display: 'flex', alignItems: 'center', padding: '0 10px', gap: 8,
      cursor: 'pointer', userSelect: 'none',
      boxShadow: selected ? `0 0 0 3px ${p.stroke}25` : 'none', transition: 'box-shadow .15s',
    }}>
      <Handle type="target" position={Position.Top} style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)', opacity: 0 }} />
      <Handle type="source" position={Position.Top} style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)', opacity: 0 }} />
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: p.stroke, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 11, fontWeight: 600, color: p.text, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3 }}>{d.label}</p>
        <p style={{ fontSize: 9, color: p.stroke, margin: 0, opacity: 0.75 }}>{CATEGORY_LABELS[d.category] ?? d.category}</p>
      </div>
    </div>
  );
};

const nodeTypes = { company: CompanyNode, category: CategoryNode, leaf: LeafNode };

// ── Build graph ───────────────────────────────────────────────────────────────

function buildFlow(graph: GraphData, companyName: string, expanded: Set<string>) {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const groups = new Map<string, typeof graph.nodes>();
  graph.nodes.forEach(n => { if (!groups.has(n.type)) groups.set(n.type, []); groups.get(n.type)!.push(n); });
  const cats = Array.from(groups.keys()).sort((a, b) => (CAT_RANK[a as DimCategory] ?? 99) - (CAT_RANK[b as DimCategory] ?? 99));

  nodes.push({ id: '__co', type: 'company', position: { x: -CO_W / 2, y: -CO_H / 2 }, data: { label: companyName }, draggable: false, selectable: false });

  cats.forEach((cat, ci) => {
    const catNodes = groups.get(cat)!;
    const cid = `__cat_${cat}`;
    const p = CATEGORY_PALETTE[cat as DimCategory] ?? CATEGORY_PALETTE.custom;
    const isExp = expanded.has(cat);
    nodes.push({ id: cid, type: 'category', position: catPos(ci, cats.length), data: { category: cat, count: catNodes.length, expanded: isExp }, draggable: false });
    edges.push({ id: `eco_${cat}`, source: '__co', target: cid, type: 'straight', style: { stroke: p.stroke, strokeWidth: isExp ? 2 : 1, opacity: isExp ? 0.5 : 0.2 } });
    if (isExp) {
      catNodes.forEach((dn, li) => {
        nodes.push({ id: dn.id, type: 'leaf', position: leafPos(ci, cats.length, li, catNodes.length), data: { label: dn.label, category: cat } });
        edges.push({ id: `ecat_${dn.id}`, source: cid, target: dn.id, type: 'straight', style: { stroke: p.stroke, strokeWidth: 1, strokeDasharray: '4 3', opacity: 0.35 } });
      });
      graph.edges.forEach(e => {
        if (catNodes.some(n => n.id === e.source) && catNodes.some(n => n.id === e.target)) {
          edges.push({ id: `erel_${e.id}`, source: e.source, target: e.target, type: 'smoothstep',
            label: e.rel_type.replace(/_/g, ' '), labelStyle: { fontSize: 9, fill: p.text },
            labelBgStyle: { fill: p.bg, fillOpacity: 0.9 }, labelBgPadding: [2, 4] as [number, number],
            style: { stroke: p.stroke, strokeWidth: 1.5, opacity: 0.7 },
            markerEnd: { type: MarkerType.ArrowClosed, color: p.stroke, width: 10, height: 10 } });
        }
      });
    }
  });
  return { nodes, edges };
}

// ── Inner ─────────────────────────────────────────────────────────────────────
const FIT: FitViewOptions = { padding: 0.18, maxZoom: 1.4 };

const Inner: React.FC<{ graph: GraphData; companyName: string; onNodeClick?: (id: string) => void }> = ({ graph, companyName, onNodeClick }) => {
  const { fitView } = useReactFlow();
  const [exp, setExp] = useState<Set<string>>(new Set());
  useEffect(() => { setExp(new Set()); }, [companyName]);

  const { nodes: bn, edges: be } = useMemo(() => buildFlow(graph, companyName, exp), [graph, companyName, exp]);
  const [nodes, setNodes, onNodesChange] = useNodesState(bn);
  const [edges, setEdges, onEdgesChange] = useEdgesState(be);

  useEffect(() => {
    setNodes(bn);
    setEdges(be);
  }, [bn, be, setNodes, setEdges]);

  useEffect(() => { setTimeout(() => fitView(FIT), 80); }, [exp, fitView]);

  const toggle = useCallback((cat: string) => setExp(p => { const s = new Set(p); s.has(cat) ? s.delete(cat) : s.add(cat); return s; }), []);

  const handleClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (node.type === 'category') toggle((node.data as any).category);
    else if (node.type === 'leaf') onNodeClick?.(node.id);
  }, [toggle, onNodeClick]);

  const catSummary = useMemo(() => {
    const m = new Map<string, number>();
    graph.nodes.forEach(n => m.set(n.type, (m.get(n.type) ?? 0) + 1));
    return Array.from(m.entries()).sort(([a], [b]) => (CAT_RANK[a as DimCategory] ?? 99) - (CAT_RANK[b as DimCategory] ?? 99));
  }, [graph]);

  if (!graph.nodes.length) return (
    <div className="flex flex-col items-center justify-center h-full gap-2 text-slate-400">
      <p className="font-semibold">No dimensions yet</p>
      <p className="text-sm">Add dimensions to see the blueprint graph.</p>
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex-shrink-0 gap-3 flex-wrap">
        <div>
          <p className="font-bold text-slate-800 dark:text-slate-100 text-sm">{companyName} Blueprint</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">{graph.nodes.length} dimensions · click a category to expand</p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {catSummary.map(([cat, count]) => {
            const p = CATEGORY_PALETTE[cat as DimCategory] ?? CATEGORY_PALETTE.custom;
            const on = exp.has(cat);
            return (
              <button key={cat} onClick={() => toggle(cat)}
                className="text-[10px] font-bold px-2 py-0.5 rounded-full border transition-all"
                style={on ? { background: p.stroke, color: '#fff', borderColor: p.stroke } : { background: p.bg, color: p.text, borderColor: p.badge }}>
                {CATEGORY_LABELS[cat as DimCategory]} {count}
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
          <MiniMap nodeColor={n => n.type === 'company' ? '#1e40af' : (CATEGORY_PALETTE[(n.data as any).category as DimCategory]?.stroke ?? '#cbd5e1')}
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

// ── Export ────────────────────────────────────────────────────────────────────
interface Props { graph: GraphData; companyName: string; onNodeClick?: (nodeId: string) => void; }

const BlueprintGraphRF: React.FC<Props> = (props) => (
  <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden transition-colors" style={{ height: 580 }}>
    <ReactFlowProvider><Inner {...props} /></ReactFlowProvider>
  </div>
);

export default BlueprintGraphRF;
