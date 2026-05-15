import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link, useLocation } from 'react-router-dom';
import { UseCaseDetail } from '../types/useCase';
import { AgentData } from '../types/agent';
import { mcpClient } from '../services/mcpClient';
import UseCaseView from '../components/UseCaseView';
import { ArrowLeft, RefreshCw, AlertCircle, Search, Loader2, Unlink2, PlusCircle, ShieldCheck, Pencil, Trash2 } from 'lucide-react';
import { useCatalog } from '../context/CatalogContext';
import { useUseCases } from '../context/UseCaseContext';
import { useChatSync } from '../hooks/useChatSync';
import AuditInitModal from '../components/audit/AuditInitModal';
import EditUseCaseModal from '../components/EditUseCaseModal';
import { useCaseApi } from '../services/useCaseApi';

interface AgentsSectionProps {
  useCase: UseCaseDetail;
  agents: AgentData[];
  onSilentRefetch: () => void;
}

const AgentsSection: React.FC<AgentsSectionProps> = ({ useCase, agents, onSilentRefetch }) => {
  const { refresh: refreshUC } = useUseCases();
  const useCaseId = useCase.identifier;
  const rawLinked: any[] = (useCase as any).agents ?? (useCase as any).of_associated_agents ?? [];

  const resolveAgentId = (a: any): string => {
    const rawId = a?.agent_id ?? a?.identification?.agent_id ?? a?.sys_id ?? a?.id ?? a?.value;
    if (!rawId) return '';
    const found = agents.find(catA =>
      catA.identification?.agent_id === rawId || catA.sys_id === rawId || catA.id === rawId
    );
    return found?.identification?.agent_id ?? found?.sys_id ?? found?.id ?? rawId;
  };

  const resolveAgentLabel = (a: any): string => {
    if (!a || typeof a !== 'object') return 'Unknown Agent';
    const nameFields = ['name', 'display_value', 'title', 'u_name', 'agent_name'];
    for (const f of nameFields) {
      if (a[f] && typeof a[f] === 'string' && a[f] !== (a.value ?? a.sys_id)) return a[f];
    }
    const aId = resolveAgentId(a);
    if (aId) {
      const found = agents.find(catA =>
        catA.identification?.agent_id === aId || catA.sys_id === aId || catA.name === aId || catA.id === aId
      );
      if (found?.name) return found.name;
    }
    for (const key of Object.keys(a)) {
      const v = a[key];
      if (v && typeof v === 'object' && v.display_value && v.display_value !== v.value) return v.display_value;
    }
    return aId || 'Unknown Agent';
  };

  // Optimistic state: agents added/removed before server confirms
  const [pendingLinks, setPendingLinks] = useState<AgentData[]>([]);
  const [pendingUnlinkIds, setPendingUnlinkIds] = useState<Set<string>>(new Set());

  const serverLinkedIds = useMemo(() => {
    const ids = new Set<string>();
    rawLinked.forEach((a: any) => {
      const id = resolveAgentId(a);
      if (id) ids.add(id);
    });
    return ids;
  }, [rawLinked, agents]);

  // Clear pending state when server data catches up
  useEffect(() => {
    setPendingLinks(prev => prev.filter(a => {
      const id = a.identification?.agent_id || a.name;
      return id && !serverLinkedIds.has(id);
    }));
    setPendingUnlinkIds(prev => {
      const next = new Set(prev);
      for (const id of prev) {
        if (!serverLinkedIds.has(id)) next.delete(id);
      }
      return next;
    });
  }, [serverLinkedIds]);

  // Combined linked list for display
  const displayLinked = useMemo(() => {
    const serverFiltered = rawLinked.filter((a: any) => {
      const id = resolveAgentId(a);
      return !id || !pendingUnlinkIds.has(id);
    });
    const serverIds = new Set(rawLinked.map((a: any) => resolveAgentId(a)).filter(Boolean));
    const newLinks = pendingLinks.filter(a => {
      const id = a.identification?.agent_id || a.name;
      return id && !serverIds.has(id);
    });
    return [...serverFiltered, ...newLinks];
  }, [rawLinked, pendingLinks, pendingUnlinkIds, agents]);

  // All linked IDs (server + optimistic) for filtering available list
  const allLinkedIds = useMemo(() => {
    const ids = new Set(serverLinkedIds);
    pendingLinks.forEach(a => {
      const id = a.identification?.agent_id || a.name;
      if (id) ids.add(id);
    });
    pendingUnlinkIds.forEach(id => ids.delete(id));
    return ids;
  }, [serverLinkedIds, pendingLinks, pendingUnlinkIds]);

  const [searchTerm, setSearchTerm] = useState('');
  const [acting, setActing] = useState<string | null>(null);
  const [relationError, setRelationError] = useState<string | null>(null);

  const availableAgents = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return agents.filter(a => {
      const id = a.identification?.agent_id || a.sys_id || a.id || a.name || '';
      if (id && allLinkedIds.has(id)) return false;
      if (!q) return true;
      return (
        a.name?.toLowerCase().includes(q) ||
        id.toLowerCase().includes(q) ||
        (a.identification?.environment ?? '').toLowerCase().includes(q)
      );
    });
  }, [agents, allLinkedIds, searchTerm]);

  const handleLink = async (agent: AgentData) => {
    const aId = agent.identification?.agent_id || agent.name;
    if (!aId || allLinkedIds.has(aId)) return;
    setActing(aId);
    setRelationError(null);
    // Optimistic update
    setPendingLinks(prev => [...prev, agent]);
    try {
      await mcpClient.createAiUseCaseAgentRelationship(useCaseId, aId);
      refreshUC();
      onSilentRefetch();
    } catch (err: any) {
      setPendingLinks(prev => prev.filter(a => (a.identification?.agent_id || a.name) !== aId));
      setRelationError(err.message || 'Failed to link agent. Please try again.');
    } finally {
      setActing(null);
    }
  };

  const handleUnlink = async (linkedAgentId: string) => {
    if (!linkedAgentId) return;
    setActing(linkedAgentId);
    setRelationError(null);
    // Optimistic update
    setPendingUnlinkIds(prev => new Set([...prev, linkedAgentId]));
    try {
      await mcpClient.removeAiUseCaseAgentRelationship(useCaseId, linkedAgentId);
      refreshUC();
      onSilentRefetch();
    } catch (err: any) {
      setPendingUnlinkIds(prev => { const next = new Set(prev); next.delete(linkedAgentId); return next; });
      setRelationError(err.message || 'Failed to unlink agent. Please try again.');
    } finally {
      setActing(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {relationError && (
        <div className="flex items-start gap-2 text-red-600 text-xs bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          {relationError}
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100">
          <p className="text-sm font-bold text-slate-700">Currently Related Agents ({displayLinked.length})</p>
        </div>
        <div className="divide-y divide-slate-100">
          {displayLinked.length === 0 && (
            <div className="p-5 text-sm text-slate-500">No agents linked.</div>
          )}
          {displayLinked.map((a: any, i: number) => {
            const name = resolveAgentLabel(a);
            const id = resolveAgentId(a) || (a.identification?.agent_id) || (a.name);
            const isPendingUnlink = id && pendingUnlinkIds.has(id);
            return (
              <div key={id ?? i} className={`px-5 py-3 flex items-center justify-between gap-3 transition-opacity ${isPendingUnlink ? 'opacity-40' : ''}`}>
                <div className="min-w-0">
                  {id ? (
                    <Link to={`/agent/${encodeURIComponent(id)}`} className="text-sm font-semibold text-blue-600 hover:underline">
                      {name}
                    </Link>
                  ) : (
                    <p className="text-sm font-semibold text-slate-700">{name}</p>
                  )}
                </div>
                {id && (
                  <button
                    onClick={() => handleUnlink(id)}
                    disabled={acting === id}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {acting === id ? <Loader2 size={12} className="animate-spin" /> : <Unlink2 size={12} />}
                    Remove
                  </button>
                )}
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
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Filter agents..."
              className="w-full pl-7 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
        </div>
        <div className="divide-y divide-slate-100 max-h-[320px] overflow-y-auto">
          {availableAgents.length === 0 && (
            <div className="p-5 text-sm text-slate-500">
              {searchTerm ? `No agents found for "${searchTerm}".` : 'No available agents to link.'}
            </div>
          )}
          {availableAgents.map(agent => {
            const agentId = agent.identification?.agent_id || '';
            const busy = acting === agentId;
            return (
              <div key={agentId} className="px-5 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-700 truncate">{agent.name}</p>
                  <p className="text-[11px] font-mono text-slate-400 truncate">{agentId}</p>
                </div>
                <button
                  onClick={() => handleLink(agent)}
                  disabled={!agentId || busy}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {busy ? <Loader2 size={12} className="animate-spin" /> : <PlusCircle size={12} />}
                  Link
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const UseCaseViewPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [useCase, setUseCase] = useState<UseCaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [auditModalOpen, setAuditModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { agents } = useCatalog();
  const { refresh: refreshUseCases } = useUseCases();

  const handleDelete = async () => {
    if (!id) return;
    setDeleting(true);
    try {
      await useCaseApi.deleteUseCase(id);
      refreshUseCases();
      navigate('/use-cases');
    } catch (err: any) {
      setError(err.message || 'Failed to delete use case.');
      setDeleteConfirm(false);
    } finally {
      setDeleting(false);
    }
  };

  async function fetchUseCase() {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await mcpClient.getUseCaseDetails(id);
      if (!data) throw new Error('Use Case not found');
      setUseCase(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load use case details');
    } finally {
      setLoading(false);
    }
  }

  async function fetchUseCaseSilently() {
    if (!id) return;
    try {
      const data = await mcpClient.getUseCaseDetails(id);
      if (data) setUseCase(data);
    } catch {
      // silent — don't disrupt the UI
    }
  }

  useEffect(() => {
    fetchUseCase();
  }, [id]);

  const handleUseCaseSaved = (updated: {
    title: string;
    description: string;
    problemStatement: string;
    expectedBenefits: string;
    priority: string;
    solutionApproach: string;
    owner: string;
  }) => {
    setUseCase(prev => {
      if (!prev) return prev;
      const next: UseCaseDetail = {
        ...prev,
        description: updated.description,
        priority: updated.priority,
      } as UseCaseDetail;
      (next as any).name = updated.title || (next as any).name;
      (next as any).title = updated.title || (next as any).title;
      (next as any).problem_statement = updated.problemStatement;
      (next as any).business_problem_statement = updated.problemStatement;
      (next as any).expected_benefits = updated.expectedBenefits;
      (next as any).solution_approach = updated.solutionApproach;
      (next as any).owner = updated.owner;
      (next as any).use_case_owner = updated.owner;
      return next;
    });
    fetchUseCase();
    refreshUseCases();
  };

  useChatSync('use_case_detail', useCase ? {
    useCaseId: useCase.identifier ?? (useCase as any).id ?? '',
    title: (useCase as any).name ?? (useCase as any).title ?? '',
    description: useCase.description ?? undefined,
    status: (useCase as any).status,
    priority: (useCase as any).priority,
    linkedAgents: ((useCase as any).agents ?? []).map((a: any) => a.name ?? a).filter(Boolean),
  } : null);

  return (
    <div className="flex flex-col gap-6 w-full animate-fade-in pb-12">
      <div className="flex items-center justify-between">
        <button
          onClick={() => {
            const page = (location.state as any)?.page;
            if (Number.isFinite(Number(page)) && Number(page) > 0) {
              navigate('/use-cases', { state: { page: Number(page) } });
              return;
            }
            if (window.history.length > 1) {
              navigate(-1);
              return;
            }
            navigate('/use-cases');
          }}
          className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-800 transition-all bg-transparent border-none cursor-pointer"
        >
          <ArrowLeft size={16} /> Back to Use Cases
        </button>
        {useCase && (
          <div className="flex items-center gap-3">
            <button
              onClick={() => setDeleteConfirm(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold bg-white border border-red-200 text-red-600 hover:bg-red-50 transition-all shadow-sm"
            >
              <Trash2 size={15} /> Delete
            </button>
            <button
              onClick={() => setEditOpen(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition-all shadow-sm"
            >
              <Pencil size={15} /> Edit
            </button>
            <button
              onClick={() => setAuditModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold bg-indigo-600 hover:bg-indigo-700 text-white transition-all shadow-sm"
            >
              <ShieldCheck size={15} /> Run Compliance Audit
            </button>
          </div>
        )}
      </div>

      {loading && (
        <div className="flex flex-col justify-center items-center min-h-[50vh] gap-3 text-slate-400">
          <RefreshCw size={22} className="animate-spin" />
          <span className="text-sm">Loading use case details...</span>
        </div>
      )}

      {!loading && error && (
        <div className="flex flex-col justify-center items-center min-h-[50vh] gap-4">
          <div className="flex items-start gap-3 text-red-500 bg-red-50 border border-red-200 rounded-xl px-6 py-4 max-w-lg">
            <AlertCircle size={20} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-bold text-sm">Could not load use case</p>
              <p className="text-xs mt-1 text-red-400">{error}</p>
            </div>
          </div>
          <button onClick={() => navigate('/use-cases')} className="text-sm font-medium text-violet-600 hover:underline">
            Return to Use Case Catalog
          </button>
        </div>
      )}

      {!loading && !error && useCase && (
        <UseCaseView
          useCase={useCase}
          agentsComponent={<AgentsSection useCase={useCase} agents={agents} onSilentRefetch={fetchUseCaseSilently} />}
        />
      )}

      {useCase && (
        <EditUseCaseModal
          useCase={useCase}
          open={editOpen}
          onClose={() => setEditOpen(false)}
          onSaved={handleUseCaseSaved}
        />
      )}

      <AuditInitModal
        open={auditModalOpen}
        onClose={() => setAuditModalOpen(false)}
        onLaunched={(runId) => navigate(`/audit/${runId}`)}
        prefillUseCaseId={useCase?.identifier ?? (useCase as any)?.id ?? ''}
        prefillUseCaseName={(useCase as any)?.name ?? (useCase as any)?.title ?? ''}
        mode="use_case"
      />

      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm flex flex-col overflow-hidden border border-slate-200 p-6 gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-base font-bold text-slate-800">Delete AI Use Case?</span>
              <span className="text-sm text-slate-500">
                This will permanently delete <span className="font-semibold text-slate-700">{(useCase as any)?.name ?? (useCase as any)?.title ?? id}</span> and all linked agent relationships. This action cannot be undone.
              </span>
            </div>
            {error && (
              <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</div>
            )}
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setDeleteConfirm(false)}
                disabled={deleting}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold bg-red-600 text-white hover:bg-red-700 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {deleting ? <><Loader2 size={14} className="animate-spin" /> Deleting…</> : <><Trash2 size={14} /> Delete</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UseCaseViewPage;
