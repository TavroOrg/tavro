import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate } from 'react-router-dom';
import { AgentData } from '../types/agent';
import { mcpClient } from '../services/mcpClient';
import AgentView from '../components/AgentView';
import type { AgentBusinessImpactSnapshot } from '../components/AgentRelatedTab';
import { ArrowLeft, Code2, X, Copy, Check, ShieldAlert, Loader2, FlaskConical, ShieldCheck, Pencil, Trash2 } from 'lucide-react';
import { useChatSync } from '../hooks/useChatSync';
import AuditInitModal from '../components/audit/AuditInitModal';
import EditAgentModal from '../components/EditAgentModal';
import { agentApi } from '../services/agentApi';
import { useCatalog } from '../context/CatalogContext';

const hasNonBlankText = (value: unknown): boolean =>
    typeof value === 'string' ? value.trim().length > 0 : value !== null && value !== undefined;

const EMPTY_APPLICATION_CARD = {
    identifier: null,
    name: null,
    description: null,
    business_criticality: null,
    emergency_tier: null,
};

const EMPTY_PROCESS_CARD = {
    identifier: null,
    name: null,
    description: null,
    business_criticality: null,
};

const EMPTY_USE_CASE_CARD = {
    identifier: null,
    name: null,
    description: null,
    proposed_by: null,
    owner: null,
    business_function: null,
    problem_statement: null,
    expected_benefits: null,
    priority: null,
    status: null,
};

const normalizeUseCasesForCard = (agent: AgentData): any[] => {
    if (Array.isArray(agent.ai_use_cases) && agent.ai_use_cases.length) return agent.ai_use_cases;
    const fallback = (agent as any).ai_use_case;
    if (Array.isArray(fallback) && fallback.length) return fallback;
    return fallback ? [fallback] : [];
};

const normalizeSkillsFromPayload = (payload: any): NonNullable<AgentData['skills']> => {
    const rawSkills = Array.isArray(payload?.skills) ? payload.skills : [];
    return rawSkills
        .map((skill: any) => {
            if (typeof skill === 'string') {
                return {
                    id: skill,
                    name: skill,
                    description: null,
                    tags: [],
                    inputModes: [],
                    outputModes: [],
                };
            }

            const id = skill?.id ?? skill?.identifier ?? skill?.skill_id ?? skill?.name ?? null;
            const name = skill?.name ?? skill?.skill_name ?? skill?.id ?? skill?.skill_id ?? null;
            const inputModes = Array.isArray(skill?.inputModes)
                ? skill.inputModes
                : (Array.isArray(skill?.input_modes) ? skill.input_modes : []);
            const outputModes = Array.isArray(skill?.outputModes)
                ? skill.outputModes
                : (Array.isArray(skill?.output_modes) ? skill.output_modes : []);

            return {
                id,
                identifier: skill?.identifier ?? id,
                skill_id: skill?.skill_id ?? id,
                name,
                skill_name: skill?.skill_name ?? name,
                description: skill?.description ?? null,
                tags: Array.isArray(skill?.tags) ? skill.tags : [],
                inputModes,
                outputModes,
                input_modes: inputModes,
                output_modes: outputModes,
            };
        })
        .filter((skill: any) => hasNonBlankText(skill.id ?? skill.skill_id ?? skill.identifier ?? skill.name));
};

const firstNonEmptySkills = (...payloads: any[]): NonNullable<AgentData['skills']> => {
    for (const payload of payloads) {
        const skills = normalizeSkillsFromPayload(payload);
        if (skills.length) return skills;
    }
    return [];
};

const buildAgentCardPayload = (agent: AgentData): Record<string, any> => {
    const applications = (agent.application ?? [])
        .map((app: any) => ({
            identifier: app?.identifier ?? null,
            name: app?.name ?? null,
            description: app?.description ?? null,
            business_criticality: app?.business_criticality ?? null,
            emergency_tier: app?.emergency_tier ?? null,
        }))
        .filter((app: any) => hasNonBlankText(app.identifier ?? app.name));

    const processes = (agent.business_process ?? [])
        .map((proc: any) => ({
            identifier: proc?.identifier ?? null,
            name: proc?.name ?? null,
            description: proc?.description ?? null,
            business_criticality: proc?.business_criticality ?? null,
        }))
        .filter((proc: any) => hasNonBlankText(proc.identifier ?? proc.name));

    const aiUseCases = normalizeUseCasesForCard(agent)
        .map((uc: any) => ({
            identifier: uc?.identifier ?? uc?.use_case_id ?? uc?.id ?? null,
            name: uc?.name ?? uc?.title ?? null,
            description: uc?.description ?? null,
            proposed_by: uc?.proposed_by ?? null,
            owner: uc?.owner ?? uc?.use_case_owner ?? null,
            business_function: uc?.business_function ?? uc?.function ?? null,
            problem_statement: uc?.problem_statement ?? null,
            expected_benefits: uc?.expected_benefits ?? null,
            priority: uc?.priority ?? null,
            status: uc?.status ?? null,
        }))
        .filter((uc: any) => hasNonBlankText(uc.identifier ?? uc.name));

    const normalizedApplications = applications.length ? applications : [EMPTY_APPLICATION_CARD];
    const normalizedProcesses = processes.length ? processes : [EMPTY_PROCESS_CARD];
    const normalizedUseCases = aiUseCases.length ? aiUseCases : [EMPTY_USE_CASE_CARD];

    return {
        ...agent,
        application: normalizedApplications,
        business_process: normalizedProcesses,
        ai_use_case: normalizedUseCases,
        ai_use_cases: normalizedUseCases,
        skills: normalizeSkillsFromPayload(agent),
    };
};

const AgentViewPage: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [agent, setAgent] = useState<AgentData | null>(null);
    const [loading, setLoading] = useState(true);
    const [assessing, setAssessing] = useState(false);
    const [editOpen, setEditOpen] = useState(false);
    const [deleteConfirm, setDeleteConfirm] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [jsonOpen, setJsonOpen] = useState(false);
    const [copied, setCopied] = useState(false);
    const [auditModalOpen, setAuditModalOpen] = useState(false);
    const { agents: catalogAgents, refresh: refreshCatalog, upsertAgent } = useCatalog();
    const recentEditRef = useRef<{
        name: string;
        description: string;
        instruction: string;
        until: number;
    } | null>(null);

    const applyRecentEditOverlay = (base: AgentData): AgentData => {
        const recent = recentEditRef.current;
        if (!recent) return base;

        const serverCaughtUp =
            (base.name ?? '') === recent.name &&
            (base.description ?? '') === recent.description &&
            (base.identification?.instruction ?? '') === recent.instruction;

        if (serverCaughtUp) {
            recentEditRef.current = null;
            return base;
        }

        if (Date.now() > recent.until) {
            recentEditRef.current = null;
            return base;
        }

        return {
            ...base,
            name: recent.name || base.name,
            description: recent.description,
            identification: {
                ...base.identification,
                instruction: recent.instruction,
            },
        };
    };

    const getPendingFallbackAgent = (targetId: string): AgentData | null => {
        const raw = localStorage.getItem('tavro_pending_assessment_agent_meta');
        const pendingMeta = raw ? JSON.parse(raw) as Array<{ agent_id: string; name: string; description: string; created_at: string; }> : [];
        const found = pendingMeta.find(item => item.agent_id === targetId || item.name === targetId);
        if (!found) return null;
        return {
            name: found.name,
            description: found.description,
            version: '1.0',
            identification: {
                agent_id: found.agent_id,
                role: null,
                instruction: null,
                governance_status: 'Risk Assessment is running',
            },
            configuration: { autonomy_level: null },
            tool: [],
            data_source: [],
            skills: [],
            application: [],
            business_process: [],
            risk_assessment: null,
        };
    };

    const handleBusinessImpactChange = useCallback((snapshot: AgentBusinessImpactSnapshot) => {
        setAgent(prev => {
            if (!prev) return prev;

            const fallbackUseCase = (prev as any).ai_use_case;
            const currentUseCases = Array.isArray(prev.ai_use_cases) && prev.ai_use_cases.length
                ? prev.ai_use_cases
                : (Array.isArray(fallbackUseCase)
                    ? fallbackUseCase
                    : (fallbackUseCase ? [fallbackUseCase] : []));
            const currentSignature = JSON.stringify({
                applications: prev.application ?? [],
                processes: prev.business_process ?? [],
                useCases: currentUseCases,
            });
            const nextSignature = JSON.stringify(snapshot);
            if (currentSignature === nextSignature) return prev;

            const next: AgentData = {
                ...prev,
                application: snapshot.applications,
                business_process: snapshot.processes,
                ai_use_cases: snapshot.useCases,
                ai_use_case: snapshot.useCases[0] ?? null,
            };
            upsertAgent(next);
            return next;
        });
    }, [upsertAgent]);

    const fetchAgent = async () => {
        if (!id) return;
        setLoading(true);
        try {
            const [mcpResult, apiResult] = await Promise.allSettled([
                mcpClient.getAgentDetails(id),
                agentApi.getAgentCard(id),
            ]);

            const mcpData = mcpResult.status === 'fulfilled' ? mcpResult.value : undefined;
            const apiData = apiResult.status === 'fulfilled' ? apiResult.value : null;
            const existingCatalog = catalogAgents.find(a =>
                (a.identification?.agent_id && a.identification.agent_id === id) || a.name === id
            );

            let resolved: AgentData | null = null;

            if (mcpData) {
                // Overlay fresh DB values onto the richer MCP card structure
                resolved = {
                    ...mcpData,
                    name: apiData?.agent_name ?? mcpData.name,
                    description: apiData?.agent_description ?? mcpData.description,
                    identification: {
                        ...mcpData.identification,
                        instruction: apiData?.instruction ?? mcpData.identification?.instruction,
                        governance_status: apiData?.governance_status ?? mcpData.identification?.governance_status,
                    },
                    latest_risk_score: mcpData.latest_risk_score ?? existingCatalog?.latest_risk_score,
                    latest_risk_class: mcpData.latest_risk_class ?? existingCatalog?.latest_risk_class,
                    skills: firstNonEmptySkills(apiData, mcpData, existingCatalog),
                };
            } else if (apiData) {
                // Preserve governance/risk snapshot from existing catalog entry if REST API returns null
                // (happens for agents created before governance_status was persisted to DB)
                const apiCatalog = catalogAgents.find(a =>
                    (a.identification?.agent_id && a.identification.agent_id === (apiData.agent_id ?? id)) ||
                    a.name === (apiData.agent_name ?? id)
                );
                resolved = {
                    name: apiData.agent_name ?? '',
                    description: apiData.agent_description ?? '',
                    version: '1.0',
                    identification: {
                        agent_id: apiData.agent_id ?? id,
                        role: apiData.role ?? null,
                        instruction: apiData.instruction ?? null,
                        governance_status: apiData.governance_status ??
                            apiCatalog?.identification?.governance_status ?? null,
                    },
                    configuration: { autonomy_level: null },
                    tool: apiCatalog?.tool ?? [],
                    data_source: apiCatalog?.data_source ?? [],
                    skills: firstNonEmptySkills(apiData, apiCatalog),
                    application: apiCatalog?.application ?? [],
                    business_process: apiCatalog?.business_process ?? [],
                    risk_assessment: apiCatalog?.risk_assessment ?? null,
                    latest_risk_score: apiCatalog?.latest_risk_score ?? null,
                    latest_risk_class: apiCatalog?.latest_risk_class ?? null,
                };
            } else {
                const fromCatalog = catalogAgents.find(a =>
                    (a.identification?.agent_id && a.identification.agent_id === id) || a.name === id
                );
                if (fromCatalog) {
                    resolved = fromCatalog;
                } else {
                    const fallback = getPendingFallbackAgent(id);
                    if (fallback) resolved = fallback;
                }
            }

            if (resolved) {
                const overlaid = applyRecentEditOverlay(resolved);
                setAgent(overlaid);
                upsertAgent(overlaid);
            }
        } catch (error) {
            console.error("Error fetching agent details", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchAgent();
    // Only re-fetch when the agent ID changes (navigation).
    // catalogAgents.length is intentionally omitted — catalog background
    // refreshes should not trigger concurrent detail fetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]);

    useEffect(() => {
        if (!agent?.identification?.agent_id) return;
        if (agent.identification.governance_status !== 'Risk Assessment is running') return;
        const handleWorkflowUpdate = () => { fetchAgent(); };
        window.addEventListener('tavro_temporal_workflow_update', handleWorkflowUpdate);
        return () => window.removeEventListener('tavro_temporal_workflow_update', handleWorkflowUpdate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [agent?.identification?.agent_id, agent?.identification?.governance_status]);

    // ── Chat sync — passes agent data to chat as context ────────────────────
    useChatSync('agent_detail', agent ? {
        agentId:     agent.identification?.agent_id ?? agent.name,
        agentName:   agent.name,
        description: agent.description,
        status:      (agent as any).status,
        riskLevel:   (agent as any).riskLevel ?? (agent as any).risk_level,
        framework:   (agent as any).framework,
    } : null);

    useEffect(() => {
        if (!jsonOpen) return;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = previousOverflow;
        };
    }, [jsonOpen]);

    const handleCopyJson = () => {
        if (!agent) return;
        navigator.clipboard.writeText(JSON.stringify(agent, null, 2));
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleDelete = async () => {
        if (!agent || !id) return;
        setDeleting(true);
        try {
            await agentApi.deleteAgent(agent.identification?.agent_id ?? id);
            refreshCatalog();
            navigate('/catalog');
        } catch (err: any) {
            alert(err.message || 'Failed to delete agent.');
        } finally {
            setDeleting(false);
            setDeleteConfirm(false);
        }
    };

    const handleRequestRiskAssessment = async () => {
        if (!agent || !id) return;
        setAssessing(true);
        try {
            await mcpClient.createRiskAssessment(id);
            // Refresh agent data to show the new assessment status
            await fetchAgent();
        } catch (error) {
            console.error("Error requesting risk assessment:", error);
            alert("Failed to request risk assessment.");
        } finally {
            setAssessing(false);
        }
    };

    const handleAgentSaved = (updated: { name: string; description: string; instruction: string }) => {
        recentEditRef.current = {
            name: updated.name,
            description: updated.description,
            instruction: updated.instruction,
            until: Date.now() + 30000,
        };
        setAgent(prev => {
            if (!prev) return prev;
            const next: AgentData = {
                ...prev,
                name: updated.name || prev.name,
                description: updated.description,
                identification: {
                    ...prev.identification,
                    instruction: updated.instruction,
                },
            };
            upsertAgent(next);
            return next;
        });
        // Avoid immediately overwriting optimistic UI with stale cached details.
        window.setTimeout(() => {
            mcpClient.invalidateCache();
            fetchAgent();
            refreshCatalog();
        }, 500);
    };

    if (loading && !agent) {
        return <div className="flex-row justify-center items-center h-64 text-secondary">Loading Agent Details...</div>;
    }

    if (!agent) {
        return (
            <div className="flex-col items-center gap-4 mt-12">
                <p className="text-secondary">Agent not found.</p>
                <button onClick={() => navigate('/')} className="btn btn-secondary">Return to Catalog</button>
            </div>
        );
    }

    const prettyJson = JSON.stringify(buildAgentCardPayload(agent), null, 2);

    return (
        <div className="flex-col gap-6 w-full animate-fade-in relative">
            {/* Top bar */}
            <div className="flex items-center justify-between mb-2">
                <button
                    onClick={() => {
                        if (window.history.length > 2) {
                            navigate(-1);
                        } else {
                            navigate('/');
                        }
                    }}
                    className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-800 transition-all bg-transparent border-none cursor-pointer"
                >
                    <ArrowLeft size={16} /> Back
                </button>

                <div className="flex items-center gap-3">
                    <button
                        onClick={() => navigate(
                            `/playground?useCase=${encodeURIComponent(agent.identification?.agent_id ?? agent.name)}&title=${encodeURIComponent(agent.name)}&desc=${encodeURIComponent(agent.description ?? '')}&instruction=${encodeURIComponent(agent.identification?.instruction ?? '')}`
                        )}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold bg-blue-600 text-white hover:bg-blue-700 dark:hover:bg-blue-500 transition-all shadow-sm"
                    >
                        <FlaskConical size={15} /> Playground
                    </button>
                    <button
                        onClick={() => setAuditModalOpen(true)}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold bg-blue-600 text-white hover:bg-blue-700 transition-all shadow-sm"
                    >
                        <ShieldCheck size={15} /> Audit
                    </button>
                    <button
                        onClick={handleRequestRiskAssessment}
                        disabled={assessing}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold bg-blue-600 text-white hover:bg-blue-700 transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {assessing ? <Loader2 size={16} className="animate-spin" /> : <ShieldAlert size={16} />}
                        {assessing ? 'Assessing...' : 'Risk Assessment'}
                    </button>

                    <button
                        onClick={() => setJsonOpen(true)}
                        title="Agent Card"
                        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold bg-slate-800 text-slate-100 hover:bg-slate-700 transition-all border border-slate-700 shadow-sm"
                    >
                        <Code2 size={14} />
                        Agent Card
                    </button>
                    <button
                        onClick={() => setEditOpen(true)}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition-all shadow-sm"
                    >
                        <Pencil size={15} /> Edit
                    </button>
                    <button
                        onClick={() => setDeleteConfirm(true)}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold bg-red-600 text-white hover:bg-red-700 transition-all shadow-sm"
                    >
                        <Trash2 size={15} /> Delete
                    </button>
                </div>
            </div>

            {loading && agent && (
                <div className="absolute top-0 right-0 bg-white/80 backdrop-blur-sm z-10 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 shadow-sm border border-slate-200">
                    <Loader2 size={16} className="animate-spin text-blue-500" />
                    Refreshing...
                </div>
            )}

            <AgentView agent={agent} onBusinessImpactChange={handleBusinessImpactChange} />

            {/* JSON Inspector Modal */}
            {jsonOpen && createPortal(
                <div
                    className="fixed z-[100] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm border border-slate-200 shadow-sm"
                    style={{
                        top: '24px',
                        bottom: '56px',
                        left: 'calc(var(--tavro-left-rail-width, 280px) + 24px)',
                        right: 'calc(var(--tavro-right-rail-width, 72px) + 24px)',
                    }}
                    onClick={(e) => { if (e.target === e.currentTarget) setJsonOpen(false); }}
                >
                    <div className="relative bg-slate-900 rounded-2xl shadow-2xl w-full max-w-4xl h-full max-h-[760px] flex flex-col overflow-hidden border border-slate-700">
                        {/* Modal header */}
                        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
                            <div className="flex items-center gap-2">
                                <Code2 size={16} className="text-blue-400" />
                                <span className="font-bold text-slate-100 text-sm">Agent Card</span>
                                <span className="text-xs text-slate-400 font-mono ml-2 bg-slate-800 px-2 py-0.5 rounded">
                                    {agent.name}
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={handleCopyJson}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 transition-all border border-slate-700"
                                >
                                    {copied ? <><Check size={12} className="text-emerald-400" /> Copied!</> : <><Copy size={12} /> Copy</>}
                                </button>
                                <button
                                    onClick={() => setJsonOpen(false)}
                                    className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-all"
                                >
                                    <X size={16} />
                                </button>
                            </div>
                        </div>

                        {/* JSON content */}
                        <div className="overflow-auto flex-1 p-5">
                            <pre className="text-xs text-slate-300 font-mono leading-relaxed whitespace-pre-wrap break-words">
                                {prettyJson}
                            </pre>
                        </div>

                        {/* Footer size info */}
                        <div className="px-5 py-2.5 border-t border-slate-700 flex justify-between text-xs text-slate-500">
                            <span>{prettyJson.split('\n').length} lines</span>
                            <span>{(new TextEncoder().encode(prettyJson).length / 1024).toFixed(1)} KB</span>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* Delete confirmation modal */}
            {deleteConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm border border-slate-200 overflow-hidden">
                        <div className="px-5 py-4 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
                            <Trash2 size={16} className="text-red-500" />
                            <span className="font-bold text-slate-800 text-sm">Delete Agent</span>
                        </div>
                        <div className="px-5 py-4">
                            <p className="text-sm text-slate-700">
                                Permanently delete <span className="font-semibold">{agent.name}</span> and all associated records (tools, risk assessments, use case links)?
                            </p>
                            <p className="text-xs text-red-500 mt-2">This action cannot be undone.</p>
                        </div>
                        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-slate-100 bg-slate-50">
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

            {/* Edit modal */}
            <EditAgentModal
                agent={agent}
                open={editOpen}
                onClose={() => setEditOpen(false)}
                onSaved={handleAgentSaved}
            />

            {/* Audit modal */}
            <AuditInitModal
                open={auditModalOpen}
                onClose={() => setAuditModalOpen(false)}
                onLaunched={(runId) => navigate(`/audit/${runId}`)}
                prefillAgentId={agent.identification?.agent_id ?? agent.name}
                prefillAgentName={agent.name}
                mode="agent"
            />
        </div>
    );
};

export default AgentViewPage;
