// ── src/context/PlaygroundContext.tsx ─────────────────────────────────────────
// Stateful agent sessions via FastAPI backend.
// All LLM calls run server-side — no API keys in the browser.

import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { toUserMessage } from '../utils/errorUtils';
import { appLogger } from '../services/logger';
import type {
  PlaygroundAgentSkill, PlaygroundConfig, PlaygroundMessage, PlaygroundObservation, InfraProvider,
} from '../types/playground';
import { BUILTIN_TOOLS, PROVIDER_MODELS } from '../types/playground';

const API_BASE = import.meta.env.VITE_TWIN_API_URL ?? '';

// ── Attachment type (mirrors backend) ─────────────────────────────────────────
export interface AttachmentPayload {
  name:      string;
  mime_type: string;
  data:      string;   // base64
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function apiPost<T>(path: string, body?: any): Promise<T> {
  const label = `POST /api/v1/playground${path}`;
  appLogger.req(label, body);
  const t0 = Date.now();
  const res = await fetch(`${API_BASE}/api/v1/playground${path}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const raw = await res.text();
    let detail = raw;
    try {
      detail = JSON.parse(raw)?.detail || raw;
    } catch {
      // Keep the plain-text response.
    }
    appLogger.error(label, detail);
    throw new Error(`API ${res.status}: ${detail}`);
  }
  const result = await res.json();
  appLogger.res(label, result, Date.now() - t0);
  return result;
}

async function apiGet<T>(path: string): Promise<T> {
  const label = `GET /api/v1/playground${path}`;
  appLogger.req(label);
  const t0 = Date.now();
  const res = await fetch(`${API_BASE}/api/v1/playground${path}`);
  if (!res.ok) {
    appLogger.error(label, `API ${res.status}`);
    throw new Error(`API ${res.status}`);
  }
  const result = await res.json();
  appLogger.res(label, result, Date.now() - t0);
  return result;
}

async function apiDelete<T>(path: string): Promise<T> {
  const label = `DELETE /api/v1/playground${path}`;
  appLogger.req(label);
  const t0 = Date.now();
  const res = await fetch(`${API_BASE}/api/v1/playground${path}`, { method: 'DELETE' });
  if (!res.ok) {
    appLogger.error(label, `API ${res.status}`);
    throw new Error(`API ${res.status}`);
  }
  const result = await res.json();
  appLogger.res(label, result, Date.now() - t0);
  return result;
}

// ── Defaults ──────────────────────────────────────────────────────────────────

function defaultConfig(): PlaygroundConfig {
  return {
    useCaseId:    '',
    useCaseTitle: '',
    provider:     'claude',
    model:        'claude-sonnet-4-6',
    agentName:    'Agent Prototype',
    systemPrompt: '',
    tools:        BUILTIN_TOOLS.map(t => ({ ...t })),
    temperature:  0.7,
    maxTokens:    2048,
  };
}

function buildFallbackSystemPrompt(config: PlaygroundConfig): string {
  const name = (config.agentName || 'Agent Prototype').trim();
  return [
    `You are ${name}, an AI agent prototype.`,
    '',
    'When the user asks what this agent does, provide a concise capability summary inferred from the agent name.',
    'If details are uncertain, state assumptions clearly but still provide a best-effort description.',
    'Suggested response structure:',
    '1) Agent purpose (1-2 lines)',
    '2) Typical tasks (3-5 bullets)',
    '3) Inputs required',
    '4) Outputs produced',
    '5) Limitations / unknowns',
  ].join('\n');
}

// ── Context shape ─────────────────────────────────────────────────────────────

interface SessionSummary {
  overall_assessment:      string;
  capabilities:            string[];
  gaps:                    string[];
  information_needed:      string[];
  unexpected_behaviours:   string[];
  recommended_next_steps:  string[];
}

interface PlaygroundState {
  config:        PlaygroundConfig;
  messages:      PlaygroundMessage[];
  observations:  PlaygroundObservation[];
  isRunning:     boolean;
  sessionActive: boolean;
  sessionEnded:  boolean;
  sessionStarting: boolean;
  sessionId:     string | null;
  tokenCount:    number;
  summary:       SessionSummary | null;
  summaryLoading: boolean;
  sessionError:  string | null;

  setConfig:       (update: Partial<PlaygroundConfig>) => void;
  setProvider:     (provider: InfraProvider) => void;
  loadFromAgent:   (id: string, name: string, description?: string, instruction?: string, agentType?: string, agentInternalId?: string, agentId?: string, tenantId?: string, skills?: PlaygroundAgentSkill[]) => void;
  resetConfig:     () => void;
  reconnectSession: (sessionId: string) => Promise<void>;

  startSession:    () => Promise<void>;
  endSession:      () => Promise<void>;
  sendMessage:     (text: string, attachments?: AttachmentPayload[]) => Promise<string | null>;
  clearMessages:   () => void;
  generateSummary: () => Promise<void>;

  addObservation:    (obs: Omit<PlaygroundObservation, 'id' | 'createdAt'>) => void;
  removeObservation: (id: string) => void;
}

const PlaygroundContext = createContext<PlaygroundState>({} as PlaygroundState);

// ── Provider ──────────────────────────────────────────────────────────────────

export const PlaygroundProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [config,         setConfigState]  = useState<PlaygroundConfig>(defaultConfig());
  const [messages,       setMessages]     = useState<PlaygroundMessage[]>([]);
  const [observations,   setObservations] = useState<PlaygroundObservation[]>([]);
  const [isRunning,      setIsRunning]    = useState(false);
  const [sessionActive,  setSessionActive] = useState(false);
  const [sessionEnded,   setSessionEnded]  = useState(false);
  const [sessionStarting, setSessionStarting] = useState(false);
  const [sessionId,      setSessionId]    = useState<string | null>(null);
  const [tokenCount,     setTokenCount]   = useState(0);
  const [summary,        setSummary]      = useState<SessionSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [sessionError,   setSessionError] = useState<string | null>(null);

  // ── Config mutations ───────────────────────────────────────────────────────

  const setConfig = useCallback((update: Partial<PlaygroundConfig>) => {
    setConfigState(prev => ({ ...prev, ...update }));
  }, []);

  const setProvider = useCallback((provider: InfraProvider) => {
    appLogger.info(`Selected infrastructure: ${provider}`, { model: PROVIDER_MODELS[provider][0] });
    setConfigState(prev => ({
      ...prev, provider, model: PROVIDER_MODELS[provider][0],
    }));
  }, []);

  const loadFromAgent = useCallback((id: string, name: string, description?: string, instruction?: string, agentType?: string, agentInternalId?: string, agentId?: string, tenantId?: string, skills?: PlaygroundAgentSkill[]) => {
    appLogger.info(`Loaded '${name}' into Agent Playground`, { useCaseId: id, agentId, agentInternalId, skillCount: skills?.length ?? 0 });
    setConfigState(prev => ({
      ...prev,
      useCaseId:    id,
      useCaseTitle: name,
      agentName:    name,
      agentDescription: description,
      skills:       skills ?? [],
      agentType:    agentType ?? prev.agentType,
      agentInternalId:  agentInternalId ?? prev.agentInternalId,
      agentId:          agentId ?? prev.agentId,
      tenantId:         tenantId ?? prev.tenantId,
      systemPrompt: instruction?.trim()
        ? instruction.trim()
        : description
          ? `You are ${name}, an AI agent prototype.\n\nAgent description: ${description}\n\nYour goal is to demonstrate your capabilities for this agent role. Be specific, grounded, and honest about what information you need to perform well. Surface any gaps or limitations proactively.`
          : `You are ${name}, an AI agent prototype.\n\nDemonstrate your capabilities for this agent role. Be specific and honest about what you can and cannot do.`,
    }));
    setMessages([]);
    setObservations([]);
    setSummary(null);
    setSessionActive(false);
    setSessionEnded(false);
    setSessionId(null);
    setTokenCount(0);
    setSessionError(null);
  }, []);

  const resetConfig = useCallback(() => {
    setConfigState(defaultConfig());
    setMessages([]);
    setObservations([]);
    setSummary(null);
    setSessionActive(false);
    setSessionEnded(false);
    setSessionId(null);
    setTokenCount(0);
    setSessionError(null);
  }, []);

  const reconnectSession = useCallback(async (id: string) => {
    setSessionId(id);
    setSessionActive(true);
    setSessionEnded(false);
    setSummary(null);
    setSessionError(null);
    try {
      const data = await apiGet<any>(`/session/${id}`);
      // Mark as ended if the session came from the archive
      if (data.ended_at) setSessionEnded(true);
      // Restore messages (field was renamed messages → interactions in DB)
      const restored: PlaygroundMessage[] = (data.interactions ?? data.messages ?? []).map((m: any) => ({
        id:        m.id,
        role:      m.role,
        content:   m.content,
        timestamp: new Date(m.timestamp),
        tokens:    m.tokens,
      }));
      setMessages(restored);
      setTokenCount(data.token_total ?? 0);
      // Restore observations
      if (data.observations?.length) {
        setObservations((data.observations as any[]).map(o => ({
          ...o,
          createdAt: new Date(o.createdAt),
        })));
      }
      // Restore cached summary if available — avoids re-generating on every visit
      if (data.summary ?? data.cached_summary) {
        setSummary((data.summary ?? data.cached_summary) as SessionSummary);
      }
      // Restore config (backend uses snake_case)
      // Restore scalar identity fields returned directly from the DB row
      setConfigState(prev => ({
        ...prev,
        agentName: data.agent_name ?? prev.agentName,
        provider:  data.provider   ?? prev.provider,
        model:     data.model      ?? prev.model,
      }));
    } catch {
      setMessages([]);
    }
  }, []);

  // ── Session lifecycle ──────────────────────────────────────────────────────

  const startSession = useCallback(async () => {
    setSessionError(null);
    setSessionStarting(true);
    try {
      const systemPromptToUse = config.systemPrompt.trim() || buildFallbackSystemPrompt(config);
      const result = await apiPost<{
        session_id: string;
        azure_foundry_agent?: { enabled?: boolean; agent_name?: string | null };
      }>('/session', {
        agent_name:     config.agentName,
        agent_description: config.agentDescription,
        system_prompt:  systemPromptToUse,
        provider:       config.provider,
        model:          config.model,
        temperature:    config.temperature,
        max_tokens:     config.maxTokens,
        tools:          config.tools,
        skills:         config.skills ?? [],
        company_id:     config.companyId,
        company_name:   config.companyName,
        use_case_id:    config.useCaseId || config.agentName,
        use_case_title: config.useCaseTitle || config.agentName,
        tenant_id:         config.tenantId,
        agent_internal_id: config.agentInternalId,
        agent_id:          config.agentId,
      });

      setSessionId(result.session_id);
      setSessionActive(true);
      setSummary(null);
      const azureAgentNote = result.azure_foundry_agent?.enabled && result.azure_foundry_agent.agent_name
        ? ` · Foundry agent ${result.azure_foundry_agent.agent_name}`
        : '';
      setMessages([{
        id:        'session-init',
        role:      'system',
        content:   `Session started · ${config.provider} · ${config.model}${azureAgentNote}`,
        timestamp: new Date(),
      }]);
    } catch (err: any) {
      setSessionError(toUserMessage(err));
      setMessages(prev => [...prev, {
        id:        `err-${Date.now()}`,
        role:      'assistant',
        content:   `Failed to start session: ${toUserMessage(err)}`,
        timestamp: new Date(),
      }]);
    } finally {
      setSessionStarting(false);
    }
  }, [config]);

  const endSession = useCallback(async () => {
    if (sessionId) {
      try {
        // Persist observations before ending
        await apiPost(`/session/${sessionId}/observations`, { observations });
        await apiDelete(`/session/${sessionId}`);
      } catch { /* best effort */ }
    }
    setSessionActive(false);
    setSessionEnded(true);
    setIsRunning(false);
    setSessionError(null);
  }, [sessionId, observations]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setTokenCount(0);
    setSummary(null);
  }, []);

  // ── Send message ───────────────────────────────────────────────────────────

  const sendMessage = useCallback(async (text: string, attachments: AttachmentPayload[] = []): Promise<string | null> => {
    if ((!text.trim() && attachments.length === 0) || isRunning || !sessionId) return null;

    setIsRunning(true);
    const attNames = attachments.map(a => a.name);
    const displayContent = attNames.length
      ? `${text}${text ? '\n' : ''}📎 ${attNames.join(', ')}`
      : text;
    setMessages(prev => [...prev, {
      id:        `user-${Date.now()}`,
      role:      'user',
      content:   displayContent,
      timestamp: new Date(),
    }]);

    try {
      const result = await apiPost<{
        message:     { id: string; role: string; content: string; timestamp: string; tokens?: number };
        token_total: number;
      }>(`/session/${sessionId}/message`, { content: text, attachments });

      setMessages(prev => [...prev, {
        id:        result.message.id,
        role:      'assistant',
        content:   result.message.content,
        timestamp: new Date(result.message.timestamp),
        tokens:    result.message.tokens,
      }]);
      setTokenCount(result.token_total);
      return result.message.content;

    } catch (err: any) {
      setMessages(prev => [...prev, {
        id:        `err-${Date.now()}`,
        role:      'assistant',
        content:   toUserMessage(err),
        timestamp: new Date(),
      }]);
      return null;
    } finally {
      setIsRunning(false);
    }
  }, [sessionId, isRunning]);

  // ── AI summary ─────────────────────────────────────────────────────────────

  const generateSummary = useCallback(async () => {
    if (!sessionId) return;
    setSummaryLoading(true);
    try {
      const result = await apiGet<{ summary: SessionSummary | string; token_total: number }>(
        `/session/${sessionId}/summary`
      );
      if (typeof result.summary === 'object') {
        setSummary(result.summary as SessionSummary);
      }
    } catch (err: any) {
      console.error('Summary failed:', err);
    } finally {
      setSummaryLoading(false);
    }
  }, [sessionId]);

  // ── Observations ───────────────────────────────────────────────────────────

  const persistObservations = useCallback((next: PlaygroundObservation[], sid: string | null) => {
    if (!sid) return;
    apiPost(`/session/${sid}/observations`, { observations: next }).catch(() => {/* best effort */});
  }, []);

  const addObservation = useCallback((obs: Omit<PlaygroundObservation, 'id' | 'createdAt'>) => {
    const newObs = { ...obs, id: `obs-${Date.now()}`, createdAt: new Date() };
    setObservations(prev => {
      const next = [...prev, newObs];
      persistObservations(next, sessionId);
      return next;
    });
  }, [sessionId, persistObservations]);

  const removeObservation = useCallback((id: string) => {
    setObservations(prev => {
      const next = prev.filter(o => o.id !== id);
      persistObservations(next, sessionId);
      return next;
    });
  }, [sessionId, persistObservations]);

  return (
    <PlaygroundContext.Provider value={{
      config, messages, observations, isRunning, sessionActive, sessionEnded, sessionStarting, sessionId,
      tokenCount, summary, summaryLoading, sessionError,
      setConfig, setProvider, loadFromAgent, resetConfig, reconnectSession,
      startSession, endSession, sendMessage, clearMessages, generateSummary,
      addObservation, removeObservation,
    }}>
      {children}
    </PlaygroundContext.Provider>
  );
};

export function usePlayground() {
  return useContext(PlaygroundContext);
}
