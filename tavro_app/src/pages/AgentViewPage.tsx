import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AgentData } from '../types/agent';
import { mcpClient } from '../services/mcpClient';
import AgentView from '../components/AgentView';
import { ArrowLeft, Code2, X, Copy, Check, ShieldAlert, Loader2, FlaskConical, ShieldCheck } from 'lucide-react';
import { useInspectJson } from '../hooks/useInspectJson';
import { useChatSync } from '../hooks/useChatSync';
import AuditInitModal from '../components/audit/AuditInitModal';
import { useCatalog } from '../context/CatalogContext';

const AgentViewPage: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [agent, setAgent] = useState<AgentData | null>(null);
    const [loading, setLoading] = useState(true);
    const [assessing, setAssessing] = useState(false);
    const [inspectJson] = useInspectJson();
    const [jsonOpen, setJsonOpen] = useState(false);
    const [copied, setCopied] = useState(false);
    const [auditModalOpen, setAuditModalOpen] = useState(false);
    const { agents: catalogAgents } = useCatalog();

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
            application: [],
            business_process: [],
            risk_assessment: null,
        };
    };

    const fetchAgent = async () => {
        if (!id) return;
        setLoading(true);
        try {
            const data = await mcpClient.getAgentDetails(id);
            if (data) {
                setAgent(data);
            } else {
                const fromCatalog = catalogAgents.find(a =>
                    (a.identification?.agent_id && a.identification.agent_id === id) || a.name === id
                );
                if (fromCatalog) {
                    setAgent(fromCatalog);
                } else {
                    const fallback = getPendingFallbackAgent(id);
                    if (fallback) setAgent(fallback);
                }
            }
        } catch (error) {
            console.error("Error fetching agent details", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchAgent();
    }, [id, catalogAgents.length]);

    useEffect(() => {
        if (!agent?.identification?.agent_id) return;
        if (agent.identification.governance_status !== 'Risk Assessment is running') return;
        const timer = window.setInterval(() => {
            fetchAgent();
        }, 10000);
        return () => window.clearInterval(timer);
    }, [agent?.identification?.agent_id, agent?.identification?.governance_status, id, catalogAgents.length]);

    // ── Chat sync — passes agent data to chat as context ────────────────────
    useChatSync('agent_detail', agent ? {
        agentId:     agent.identification?.agent_id ?? agent.name,
        agentName:   agent.name,
        description: agent.description,
        status:      (agent as any).status,
        riskLevel:   (agent as any).riskLevel ?? (agent as any).risk_level,
        framework:   (agent as any).framework,
    } : null);

    const handleCopyJson = () => {
        if (!agent) return;
        navigator.clipboard.writeText(JSON.stringify(agent, null, 2));
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
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

    const prettyJson = JSON.stringify(agent, null, 2);

    return (
        <div className="flex-col gap-6 w-full animate-fade-in pb-12 relative">
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
                            `/playground?useCase=${encodeURIComponent(agent.identification?.agent_id ?? agent.name)}&title=${encodeURIComponent(agent.name)}&desc=${encodeURIComponent(agent.description ?? '')}`
                        )}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold bg-violet-600 text-white hover:bg-violet-700 dark:hover:bg-violet-500 transition-all shadow-sm"
                    >
                        <FlaskConical size={15} /> Launch in Playground
                    </button>
                    <button
                        onClick={() => setAuditModalOpen(true)}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold bg-indigo-600 text-white hover:bg-indigo-700 transition-all shadow-sm"
                    >
                        <ShieldCheck size={15} /> Run Compliance Audit
                    </button>
                    <button
                        onClick={handleRequestRiskAssessment}
                        disabled={assessing}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold bg-blue-600 text-white hover:bg-blue-700 transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {assessing ? <Loader2 size={16} className="animate-spin" /> : <ShieldAlert size={16} />}
                        {assessing ? 'Assessing...' : 'Request Risk Assessment'}
                    </button>

                    {/* JSON Inspector button — only shown if enabled */}
                    {inspectJson && (
                        <button
                            onClick={() => setJsonOpen(true)}
                            title="Inspect raw JSON"
                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-800 text-slate-100 hover:bg-slate-700 transition-all border border-slate-700 shadow-sm"
                        >
                            <Code2 size={14} />
                            Inspect JSON
                        </button>
                    )}
                </div>
            </div>

            {loading && agent && (
                <div className="absolute top-0 right-0 bg-white/80 backdrop-blur-sm z-10 px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 shadow-sm border border-slate-200">
                    <Loader2 size={16} className="animate-spin text-blue-500" />
                    Refreshing...
                </div>
            )}

            <AgentView agent={agent} />

            {/* JSON Inspector Modal */}
            {jsonOpen && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
                    onClick={(e) => { if (e.target === e.currentTarget) setJsonOpen(false); }}
                >
                    <div className="relative bg-slate-900 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden border border-slate-700">
                        {/* Modal header */}
                        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
                            <div className="flex items-center gap-2">
                                <Code2 size={16} className="text-blue-400" />
                                <span className="font-bold text-slate-100 text-sm">Raw Agent JSON</span>
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
                </div>
            )}

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
