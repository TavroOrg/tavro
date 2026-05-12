import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  PlusCircle,
  Search,
  Unlink2,
  Workflow,
} from 'lucide-react';
import { businessRelationsApi } from '../services/businessRelationsApi';
import type { BusinessProcessRecord } from '../types/businessRelations';
import { useCatalog } from '../context/CatalogContext';

type Tab = 'overview' | 'related';

const BusinessProcessViewPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { agents } = useCatalog();

  const [process, setProcess] = useState<BusinessProcessRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [searchAgents, setSearchAgents] = useState('');
  const [actingAgent, setActingAgent] = useState<string | null>(null);
  const [relationError, setRelationError] = useState<string | null>(null);

  const load = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await businessRelationsApi.getProcess(id);
      setProcess(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load business process');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [id]);

  const linkedAgentIds = useMemo(() => {
    const set = new Set<string>();
    for (const rel of process?.related_agents ?? []) {
      if (rel.agent_id) set.add(rel.agent_id);
    }
    return set;
  }, [process]);

  const availableAgents = useMemo(() => {
    const q = searchAgents.trim().toLowerCase();
    return agents.filter(agent => {
      const agentId = agent.identification?.agent_id || '';
      if (!agentId || linkedAgentIds.has(agentId)) return false;
      if (!q) return true;
      return (
        agentId.toLowerCase().includes(q) ||
        agent.name.toLowerCase().includes(q) ||
        (agent.identification?.environment ?? '').toLowerCase().includes(q)
      );
    });
  }, [agents, linkedAgentIds, searchAgents]);

  const addAgent = async (agentId: string) => {
    if (!process) return;
    setActingAgent(agentId);
    setRelationError(null);
    try {
      await businessRelationsApi.linkAgentToProcess(agentId, process.business_process_id);
      await load();
    } catch (err: any) {
      setRelationError(err.message || 'Failed to add relation');
    } finally {
      setActingAgent(null);
    }
  };

  const removeAgent = async (agentId: string) => {
    if (!process) return;
    setActingAgent(agentId);
    setRelationError(null);
    try {
      await businessRelationsApi.unlinkAgentFromProcess(agentId, process.business_process_id);
      await load();
    } catch (err: any) {
      setRelationError(err.message || 'Failed to remove relation');
    } finally {
      setActingAgent(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-slate-500">
        <Loader2 size={16} className="animate-spin" />
        Loading process details...
      </div>
    );
  }

  if (error || !process) {
    return (
      <div className="flex flex-col gap-4">
        <button
          onClick={() => navigate('/processes')}
          className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft size={16} /> Back to Processes
        </button>
        <div className="flex items-start gap-3 text-red-500 bg-red-50 border border-red-200 rounded-xl px-6 py-4">
          <AlertCircle size={20} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-bold text-sm">Could not load process</p>
            <p className="text-xs mt-1 text-red-400">{error || 'Unknown error'}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 w-full animate-fade-in max-w-[1400px] mx-auto pb-10">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button
          onClick={() => navigate('/processes')}
          className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft size={16} /> Back to Processes
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="h-2 bg-gradient-to-r from-emerald-600 to-teal-500" />
        <div className="p-6">
          <h2 className="text-xl font-bold text-slate-800">
            {process.process_name || process.business_process_id}
          </h2>
          <p className="text-xs font-mono text-slate-400 mt-1">{process.business_process_id}</p>
          <p className="text-sm text-slate-600 mt-3">
            {process.process_description || 'No description available.'}
          </p>
          <div className="flex items-center gap-2 mt-4 flex-wrap">
            {process.business_criticality && (
              <span className="text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full">
                {process.business_criticality}
              </span>
            )}
            <span className="text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full">
              {process.related_agent_count} related agents
            </span>
            <span className="text-[10px] font-semibold bg-cyan-50 text-cyan-700 border border-cyan-200 px-2 py-0.5 rounded-full inline-flex items-center gap-1">
              <Workflow size={10} />
              {process.related_processes.length} related processes
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 border-b border-slate-200">
        <button
          onClick={() => setTab('overview')}
          className={`px-4 py-2.5 text-sm font-bold border-b-2 transition-colors ${
            tab === 'overview'
              ? 'border-emerald-600 text-emerald-700'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Overview
        </button>
        <button
          onClick={() => setTab('related')}
          className={`px-4 py-2.5 text-sm font-bold border-b-2 transition-colors ${
            tab === 'related'
              ? 'border-emerald-600 text-emerald-700'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Related Agents
        </button>
      </div>

      {tab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Owner</p>
            <p className="text-sm text-slate-700 mt-1">{process.owner || 'N/A'}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Parent Process</p>
            <p className="text-sm text-slate-700 mt-1">
              {process.parent_process_name || process.parent_process_id || 'N/A'}
            </p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Operators</p>
            <p className="text-sm text-slate-700 mt-1">{process.operators || 'N/A'}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Stakeholders</p>
            <p className="text-sm text-slate-700 mt-1">{process.stakeholders || 'N/A'}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Agent Risk Tier</p>
            <p className="text-sm text-slate-700 mt-1">{process.agent_risk_tier || 'N/A'}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Regulatory Impact</p>
            <p className="text-sm text-slate-700 mt-1">{process.regulatory_impact || 'N/A'}</p>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-4 md:col-span-2">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Related Processes</p>
            {process.related_processes.length === 0 && (
              <p className="text-sm text-slate-500">No process relationships recorded.</p>
            )}
            {process.related_processes.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {process.related_processes.map(rel => (
                  <Link
                    key={`${rel.business_process_id}-${rel.relationship_type ?? 'RELATED'}`}
                    to={`/processes/${encodeURIComponent(rel.business_process_id)}`}
                    className="text-xs bg-cyan-50 text-cyan-700 border border-cyan-200 rounded-full px-2.5 py-1 inline-flex items-center gap-1 hover:bg-cyan-100"
                  >
                    <Workflow size={11} />
                    {rel.process_name || rel.business_process_id}
                    <span className="font-semibold">
                      ({rel.relationship_type || 'RELATED'})
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'related' && (
        <div className="flex flex-col gap-4">
          {relationError && (
            <div className="flex items-start gap-2 text-red-600 text-xs bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              {relationError}
            </div>
          )}

          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100">
              <p className="text-sm font-bold text-slate-700">Currently Related Agents</p>
            </div>
            <div className="divide-y divide-slate-100">
              {process.related_agents.length === 0 && (
                <div className="p-5 text-sm text-slate-500">No agents linked.</div>
              )}
              {process.related_agents.map((rel, idx) => {
                const relId = rel.agent_id || `missing-${idx}`;
                return (
                  <div key={`${relId}-${idx}`} className="px-5 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      {rel.agent_id ? (
                        <Link to={`/agent/${encodeURIComponent(rel.agent_id)}`} className="text-sm font-semibold text-emerald-700 hover:underline">
                          {rel.agent_name || rel.agent_id}
                        </Link>
                      ) : (
                        <p className="text-sm font-semibold text-slate-700">{rel.agent_name || 'Unknown Agent'}</p>
                      )}
                      <p className="text-[11px] font-mono text-slate-400">{rel.agent_id || 'No agent_id on relation'}</p>
                    </div>
                    <button
                      onClick={() => rel.agent_id && removeAgent(rel.agent_id)}
                      disabled={!rel.agent_id || actingAgent === rel.agent_id}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {actingAgent === rel.agent_id ? <Loader2 size={12} className="animate-spin" /> : <Unlink2 size={12} />}
                      Remove
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
              <p className="text-sm font-bold text-slate-700">Add Agent Relation</p>
              <div className="relative w-full max-w-sm">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={searchAgents}
                  onChange={(e) => setSearchAgents(e.target.value)}
                  placeholder="Filter agents..."
                  className="w-full pl-7 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                />
              </div>
            </div>
            <div className="divide-y divide-slate-100 max-h-[320px] overflow-y-auto">
              {availableAgents.length === 0 && (
                <div className="p-5 text-sm text-slate-500">No available agents to link.</div>
              )}
              {availableAgents.map(agent => {
                const agentId = agent.identification?.agent_id || '';
                const busy = actingAgent === agentId;
                return (
                  <div key={agentId} className="px-5 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-700 truncate">{agent.name}</p>
                      <p className="text-[11px] font-mono text-slate-400 truncate">{agentId}</p>
                    </div>
                    <button
                      onClick={() => addAgent(agentId)}
                      disabled={!agentId || busy}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {busy ? <Loader2 size={12} className="animate-spin" /> : <PlusCircle size={12} />}
                      Link
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
            <CheckCircle2 size={13} />
            Relation changes are persisted in `core.agent_business_processes` and synchronized to `core.business_processes`.
          </div>
        </div>
      )}
    </div>
  );
};

export default BusinessProcessViewPage;
