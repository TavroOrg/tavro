import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AgentData } from '../types/agent';
import { mcpClient } from '../services/mcpClient';
import { hasResolvedAgentRisk } from '../utils/agentRisk';
import { agentApi, RiskWorkflowStatus } from '../services/agentApi';

const AGENT_CACHE_KEY = 'tavro_catalog_agents_cache';
const AGENT_CACHE_TS_KEY = 'tavro_catalog_agents_cache_ts';
const AGENT_CACHE_MAX_AGE_MS = 5 * 60 * 1000;
const TEMPORAL_WORKFLOW_KEY = 'tavro_temporal_workflows';
const TEMPORAL_HANDLED_KEY = 'tavro_temporal_workflows_handled';

interface CatalogState {
    agents: AgentData[];
    loading: boolean;
    error: string | null;
    lastFetched: Date | null;
    refresh: () => void;
    upsertAgent: (agent: AgentData) => void;
}

const CatalogContext = createContext<CatalogState>({
    agents: [],
    loading: false,
    error: null,
    lastFetched: null,
    refresh: () => { },
    upsertAgent: () => { },
});

const hasRiskClassification = (agent: AgentData): boolean => hasResolvedAgentRisk(agent);

const isPendingAssessment = (agent: AgentData): boolean => {
    const status = agent.identification?.governance_status ?? (agent as any).latest_event_status;
    return status === 'Risk Assessment is running' && !hasRiskClassification(agent);
};

const mergeAgent = (fresh: AgentData, previous: AgentData): AgentData => ({
    ...previous,
    ...fresh,
    name: fresh.name || previous.name,
    description: fresh.description || previous.description,
    identification: {
        ...previous.identification,
        ...fresh.identification,
        governance_status: fresh.identification?.governance_status ?? previous.identification?.governance_status,
    },
    risk_assessment: { ...previous.risk_assessment, ...fresh.risk_assessment },
});

const identityKey = (a: AgentData): string => (a.identification?.agent_id || a.name || '').toLowerCase();

const mapByIdentity = (list: AgentData[]): Map<string, AgentData> => {
    const map = new Map<string, AgentData>();
    for (const a of list) {
        const key = identityKey(a);
        if (key) map.set(key, a);
    }
    return map;
};

type TemporalWorkflowStatus = 'running' | 'completed' | 'failed';

type TemporalWorkflowRecord = {
    workflow_id: string;
    agent_internal_id?: string;
    agent_id: string;
    name: string;
    description: string;
    status: TemporalWorkflowStatus;
    updated_at?: string;
    error?: string;
};

const norm = (value: string | null | undefined): string => String(value ?? '').trim().toLowerCase();

function workflowMatchesAgent(workflow: TemporalWorkflowRecord, agent: AgentData): boolean {
    const wfAgentId = norm(workflow.agent_id);
    const wfName = norm(workflow.name);
    const agAgentId = norm(agent.identification?.agent_id);
    const agName = norm(agent.name);
    if (!wfAgentId && !wfName) return false;
    return Boolean(
        (wfAgentId && (wfAgentId === agAgentId || wfAgentId === agName)) ||
        (wfName && (wfName === agAgentId || wfName === agName))
    );
}

function sameLogicalAgent(a: AgentData, b: AgentData): boolean {
    const aId = norm(a.identification?.agent_id);
    const aName = norm(a.name);
    const bId = norm(b.identification?.agent_id);
    const bName = norm(b.name);
    return Boolean(
        (aId && (aId === bId || aId === bName)) ||
        (aName && (aName === bId || aName === bName))
    );
}

function findLogicalMatch(target: AgentData, pool: AgentData[]): AgentData | undefined {
    return pool.find(item => sameLogicalAgent(target, item));
}

function dedupeLogicalAgents(list: AgentData[]): AgentData[] {
    const out: AgentData[] = [];
    for (const candidate of list) {
        const idx = out.findIndex(existing => sameLogicalAgent(existing, candidate));
        if (idx < 0) {
            out.push(candidate);
            continue;
        }
        const existing = out[idx];
        const keepCandidate =
            (isPendingAssessment(existing) && !isPendingAssessment(candidate)) ||
            (isPendingAssessment(existing) === isPendingAssessment(candidate) &&
                hasRiskClassification(candidate) &&
                !hasRiskClassification(existing));
        if (keepCandidate) out[idx] = candidate;
    }
    return out;
}

function readTemporalRecords(): TemporalWorkflowRecord[] {
    try {
        const raw = localStorage.getItem(TEMPORAL_WORKFLOW_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) return [];
        const rows = parsed
            .map((item: any, index: number): TemporalWorkflowRecord | null => {
                const rawStatus = String(item?.status ?? item?.state ?? item?.workflow_status ?? '').toLowerCase();
                const status: TemporalWorkflowStatus =
                    (rawStatus === 'completed' || rawStatus === 'success' || rawStatus === 'succeeded')
                        ? 'completed'
                        : (rawStatus === 'failed' || rawStatus === 'error')
                            ? 'failed'
                            : 'running';
                const workflowId = String(item?.workflow_id ?? item?.workflowId ?? item?.id ?? `wf_${index}`);
                const agentInternalId = String(item?.agent_internal_id ?? item?.agentInternalId ?? '').trim();
                const agentId = String(item?.agent_id ?? item?.agentId ?? item?.name ?? item?.agent_name ?? '').trim();
                const name = String((item?.name ?? item?.agent_name ?? item?.title ?? agentId) || 'Unnamed Agent').trim();
                const description = String(item?.description ?? item?.agent_description ?? '').trim();
                if (!agentId && !name) return null;
                return {
                    workflow_id: workflowId,
                    agent_internal_id: agentInternalId || undefined,
                    agent_id: agentId || name,
                    name: name || agentId,
                    description,
                    status,
                    updated_at: item?.updated_at ? String(item.updated_at) : undefined,
                    error: item?.error ? String(item.error) : undefined,
                };
            })
            .filter(Boolean) as TemporalWorkflowRecord[];
        rows.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
        const seenIds = new Set<string>();
        const seenNames = new Set<string>();
        return rows.filter(row => {
            const nameKey = row.name.toLowerCase();
            const idKey = row.agent_id.toLowerCase();
            // Deduplicate by name first (stable across workflow runs), then by id.
            if (nameKey && seenNames.has(nameKey)) return false;
            if (idKey && seenIds.has(idKey)) return false;
            if (nameKey) seenNames.add(nameKey);
            if (idKey) seenIds.add(idKey);
            return true;
        });
    } catch {
        return [];
    }
}

function readHandledWorkflowIds(): Set<string> {
    try {
        const raw = sessionStorage.getItem(TEMPORAL_HANDLED_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
    } catch {
        return new Set<string>();
    }
}

function persistHandledWorkflowIds(ids: Set<string>): void {
    sessionStorage.setItem(TEMPORAL_HANDLED_KEY, JSON.stringify(Array.from(ids)));
}

function toPendingAgentFromWorkflow(record: TemporalWorkflowRecord): AgentData {
    return {
        name: record.name,
        description: record.description || record.name,
        version: '1.0',
        identification: {
            // Keep the real agent id visible while the assessment is running.
            agent_id: record.agent_internal_id || record.agent_id || record.name,
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
}

export const CatalogProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [agents, setAgents] = useState<AgentData[]>(() => {
        try {
            const raw = sessionStorage.getItem(AGENT_CACHE_KEY);
            return raw ? JSON.parse(raw) as AgentData[] : [];
        } catch {
            return [];
        }
    });
    const [loading, setLoading] = useState(agents.length === 0);
    const [error, setError] = useState<string | null>(null);
    const [lastFetched, setLastFetched] = useState<Date | null>(() => {
        const ts = sessionStorage.getItem(AGENT_CACHE_TS_KEY);
        if (!ts) return null;
        const num = Number(ts);
        return Number.isFinite(num) ? new Date(num) : null;
    });

    const fetchingRef = useRef(false);
    const pendingInvalidateRef = useRef(false);
    const lastWorkflowSnapshotRef = useRef('');

    const fetchAgents = useCallback(async (invalidate = false) => {
        if (fetchingRef.current) {
            if (invalidate) pendingInvalidateRef.current = true;
            return;
        }

        const shouldInvalidate = invalidate || pendingInvalidateRef.current;
        pendingInvalidateRef.current = false;
        fetchingRef.current = true;
        setError(null);
        // Only block the UI if there is no data yet or the user explicitly synced.
        // Background auto-refreshes should be silent when cached data is already showing.
        const hasExistingData = Boolean(sessionStorage.getItem(AGENT_CACHE_KEY));
        if (!hasExistingData || shouldInvalidate) setLoading(true);
        if (shouldInvalidate) mcpClient.invalidateCache();

        try {
            const data = await mcpClient.getAllAgents();
            const temporalRecords = readTemporalRecords();
            const runningRecords = temporalRecords.filter(r => r.status === 'running');

            setAgents(prev => {
                const prevMap = mapByIdentity(prev);
                const merged = data.map(agent => {
                    const key = identityKey(agent);
                    const old = key ? prevMap.get(key) : undefined;
                    const base = old ? mergeAgent(agent, old) : agent;
                    const runningForAgent = runningRecords.some(wf => workflowMatchesAgent(wf, base));
                    if (!runningForAgent) return base;
                    return {
                        ...base,
                        latest_risk_score: null,
                        latest_risk_class: null,
                        risk_assessment: null,
                        identification: {
                            ...base.identification,
                            governance_status: 'Risk Assessment is running',
                        },
                    };
                });

                const mergedMap = mapByIdentity(merged);
                const pendingCarryOver = prev.filter(a => {
                    if (merged.some(m => sameLogicalAgent(a, m))) return false;
                    const key = identityKey(a);
                    if (!key && !a.name) return false;
                    if (key && mergedMap.has(key)) return false;
                    return isPendingAssessment(a);
                });

                const temporalPending = runningRecords
                    .map(toPendingAgentFromWorkflow)
                    .filter(a => {
                        const matched = findLogicalMatch(a, merged);
                        if (!matched) return true;
                        // If the matched catalog record already has resolved risk, do not show a stale running pill.
                        return !hasRiskClassification(matched);
                    });

                const next = dedupeLogicalAgents([...temporalPending, ...pendingCarryOver, ...merged]);
                const now = Date.now();
                sessionStorage.setItem(AGENT_CACHE_KEY, JSON.stringify(next));
                sessionStorage.setItem(AGENT_CACHE_TS_KEY, String(now));
                setLastFetched(new Date(now));
                return next;
            });
        } catch (err: any) {
            setError(err.message ?? 'Failed to load agent catalog');
        } finally {
            setLoading(false);
            fetchingRef.current = false;
            if (pendingInvalidateRef.current) {
                pendingInvalidateRef.current = false;
                fetchAgents(true);
            }
        }
    }, []);

    useEffect(() => {
        const ts = sessionStorage.getItem(AGENT_CACHE_TS_KEY);
        const ageMs = ts ? Date.now() - Number(ts) : Number.POSITIVE_INFINITY;
        const shouldInvalidate = ageMs > AGENT_CACHE_MAX_AGE_MS;
        fetchAgents(shouldInvalidate);
    }, [fetchAgents]);

    useEffect(() => {
        let timer: number | null = null;
        let active = true;

        const syncTemporalWorkflows = async () => {
            try {
                const workflows = await agentApi.getRiskWorkflows();
                if (!active) return;
                const normalized = workflows.map((w: RiskWorkflowStatus) => ({
                    workflow_id: w.workflow_id,
                    agent_internal_id: w.agent_internal_id || undefined,
                    agent_id: w.agent_id || w.agent_internal_id,
                    name: w.agent_name || w.agent_id || w.agent_internal_id,
                    description: w.agent_description || '',
                    status: String(w.status || '').toLowerCase(),
                    error: w.error || undefined,
                }));
                const snapshot = JSON.stringify(normalized);
                if (snapshot !== lastWorkflowSnapshotRef.current) {
                    lastWorkflowSnapshotRef.current = snapshot;
                    localStorage.setItem(TEMPORAL_WORKFLOW_KEY, snapshot);
                    window.dispatchEvent(new Event('tavro_temporal_workflow_update'));
                }
            } catch {
                // ignore transient endpoint errors
            }
        };

        syncTemporalWorkflows();
        timer = window.setInterval(syncTemporalWorkflows, 5000);

        return () => {
            active = false;
            if (timer) window.clearInterval(timer);
        };
    }, []);

    useEffect(() => {
        const handleTemporalWorkflowUpdate = () => {
            const workflows = readTemporalRecords();
            const handled = readHandledWorkflowIds();
            let shouldRefresh = false;

            const pendingMetaRaw = localStorage.getItem('tavro_pending_assessment_agent_meta');
            const pendingMeta = pendingMetaRaw
                ? JSON.parse(pendingMetaRaw) as Array<{ agent_id: string; name: string; description: string; created_at: string; }>
                : [];
            const pendingIdsRaw = localStorage.getItem('tavro_pending_assessment_agents');
            const pendingIds = pendingIdsRaw ? JSON.parse(pendingIdsRaw) as string[] : [];
            let nextMeta = [...pendingMeta];
            let nextIds = [...pendingIds];

            for (const wf of workflows) {
                const wfKey = `${wf.workflow_id}:${wf.agent_id}`;
                const wasHandled = handled.has(wfKey);
                const hasMeta = nextMeta.some(item =>
                    norm(item.agent_id) === norm(wf.agent_id) ||
                    norm(item.name) === norm(wf.name)
                );
                const hadPendingId = nextIds.some(id =>
                    norm(id) === norm(wf.agent_id) || norm(id) === norm(wf.name)
                );
                if (wf.status === 'running') {
                    if (!hasMeta) {
                        nextMeta.unshift({
                            agent_id: wf.agent_id,
                            name: wf.name,
                            description: wf.description || wf.name,
                            created_at: new Date().toISOString(),
                        });
                    }
                    if (!nextIds.includes(wf.agent_id)) nextIds.push(wf.agent_id);
                    continue;
                }

                nextMeta = nextMeta.filter(item =>
                    norm(item.agent_id) !== norm(wf.agent_id) &&
                    norm(item.name) !== norm(wf.name)
                );
                nextIds = nextIds.filter(id =>
                    norm(id) !== norm(wf.agent_id) &&
                    norm(id) !== norm(wf.name)
                );
                // Refresh only when a terminal workflow is newly observed or when
                // we actually cleared a running/pending marker from local state.
                if (!wasHandled || hasMeta || hadPendingId) shouldRefresh = true;

                if (wasHandled) continue;
                handled.add(wfKey);

                if (wf.status === 'failed') {
                    window.dispatchEvent(new CustomEvent('tavro_notice', {
                        detail: {
                            key: 'tavro_catalog_notice',
                            message: `Workflow failed for ${wf.name || wf.agent_id}.${wf.error ? ` ${wf.error}` : ''}`,
                        },
                    }));
                } else if (wf.status === 'completed') {
                    window.dispatchEvent(new CustomEvent('tavro_notice', {
                        detail: {
                            key: 'tavro_catalog_notice',
                            message: `Workflow completed for ${wf.name || wf.agent_id}.`,
                        },
                    }));
                }
            }

            localStorage.setItem('tavro_pending_assessment_agent_meta', JSON.stringify(nextMeta));
            localStorage.setItem('tavro_pending_assessment_agents', JSON.stringify(nextIds));
            persistHandledWorkflowIds(handled);

            fetchAgents(shouldRefresh);
        };

        const onStorage = (event: StorageEvent) => {
            if (event.key === TEMPORAL_WORKFLOW_KEY) {
                handleTemporalWorkflowUpdate();
            }
        };

        window.addEventListener('storage', onStorage);
        window.addEventListener('tavro_temporal_workflow_update', handleTemporalWorkflowUpdate as EventListener);
        handleTemporalWorkflowUpdate();
        return () => {
            window.removeEventListener('storage', onStorage);
            window.removeEventListener('tavro_temporal_workflow_update', handleTemporalWorkflowUpdate as EventListener);
        };
    }, [fetchAgents]);

    const refresh = useCallback(() => fetchAgents(true), [fetchAgents]);

    const upsertAgent = useCallback((agent: AgentData) => {
        setAgents(prev => {
            const next = [...prev];
            const targetKey = identityKey(agent);
            const idx = next.findIndex(a => identityKey(a) === targetKey || sameLogicalAgent(a, agent));
            if (idx >= 0) next[idx] = { ...next[idx], ...agent };
            else next.unshift(agent);

            const now = Date.now();
            sessionStorage.setItem(AGENT_CACHE_KEY, JSON.stringify(next));
            sessionStorage.setItem(AGENT_CACHE_TS_KEY, String(now));
            setLastFetched(new Date(now));
            return next;
        });
    }, []);

    return (
        <CatalogContext.Provider value={{ agents, loading, error, lastFetched, refresh, upsertAgent }}>
            {children}
        </CatalogContext.Provider>
    );
};

export function useCatalog(): CatalogState {
    return useContext(CatalogContext);
}
