import React, { useEffect, useState } from 'react';
import { MessageSquare, Zap, Clock, ExternalLink, RefreshCw, FlaskConical } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const API_BASE = (import.meta as any).env?.VITE_TWIN_API_URL ?? '';

interface SessionSummary {
  session_id:    string;
  status:        'active' | 'ended';
  agent_name:    string;
  provider:      string;
  model:         string;
  created_at:    string;
  updated_at:    string;
  ended_at?:     string;
  token_total:   number;
  message_count: number;
}

function formatRelative(iso: string): string {
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : `${iso}Z`;
  const timestamp = new Date(normalized).getTime();
  if (Number.isNaN(timestamp)) return '';

  const diff = Date.now() - timestamp;
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString();
}

const PROVIDER_LABELS: Record<string, string> = {
  claude:        'Claude',
  anthropic:     'Claude',
  openai:        'OpenAI',
  azure_foundry: 'Azure Foundry',
  azure:         'Azure Foundry',
  azure_openai:  'Azure OpenAI',
  aws_bedrock:   'AWS Bedrock',
  bedrock:       'AWS Bedrock',
  aws:           'AWS Bedrock',
};

interface Props {
  agentId: string | undefined;
  agentName: string;
  agentInstruction?: string;
  agentDescription?: string;
  agentType?: string;
}

const AgentSessionsTab: React.FC<Props> = ({ agentId, agentName, agentInstruction, agentDescription }) => {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);

  const fetchSessions = async () => {
    setLoading(true);
    setError(null);
    try {
      const qs  = agentId ? `?agent_id=${encodeURIComponent(agentId)}` : '';
      const res = await fetch(`${API_BASE}/api/v1/playground/sessions${qs}`);
      if (!res.ok) throw new Error(`${res.status}`);
      setSessions(await res.json());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchSessions(); }, [agentId]);

  const buildPlaygroundParams = (session: SessionSummary) => {
    const params = new URLSearchParams();
    if (agentId)           params.set('useCase', agentId);
    if (agentName)         params.set('title', agentName);
    if (agentDescription)  params.set('desc', agentDescription);
    if (agentInstruction)  params.set('instruction', agentInstruction);
    params.set('sessionId', session.session_id);
    return params;
  };

  const openSessionSummary = (session: SessionSummary) => {
    const params = buildPlaygroundParams(session);
    params.set('tab', 'summary');
    navigate(`/playground?${params.toString()}`);
  };

  const openSessionInteract = (session: SessionSummary) => {
    const params = buildPlaygroundParams(session);
    params.set('tab', 'chat');
    navigate(`/playground?${params.toString()}`);
  };

  const activeSessions = sessions.filter(s => s.status === 'active');
  const endedSessions  = sessions.filter(s => s.status === 'ended');

  return (
    <div className="flex flex-col gap-5 py-2">

      {/* Header row */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-slate-700">Playground Sessions</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            All sessions for this agent — active and ended.
          </p>
        </div>
        <button
          onClick={fetchSessions}
          className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition-colors"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex flex-col items-center gap-3 py-16 text-slate-400">
          <RefreshCw size={24} className="animate-spin text-slate-300" />
          <p className="text-sm">Loading sessions…</p>
        </div>
      ) : error ? (
        <div className="bg-rose-50 border border-rose-200 rounded-xl px-5 py-4 text-sm text-rose-700">
          Failed to load sessions: {error}
        </div>
      ) : sessions.length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-16 text-slate-400">
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl">
            <FlaskConical size={28} className="text-slate-300" />
          </div>
          <div className="text-center">
            <p className="font-semibold text-slate-500">No sessions yet</p>
            <p className="text-xs mt-1">Open this agent in the Playground to start a session.</p>
          </div>
          <button
            onClick={() => navigate('/playground')}
            className="flex items-center gap-2 text-sm font-bold text-blue-600 hover:bg-blue-50 px-4 py-2 rounded-lg transition-colors border border-blue-200"
          >
            <FlaskConical size={14} /> Start a session
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-6">

          {/* Active sessions */}
          {activeSessions.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Active · {activeSessions.length}
              </p>
              {activeSessions.map(s => (
                <SessionCard key={s.session_id} s={s} onSummary={openSessionSummary} onInteract={openSessionInteract} />
              ))}
            </div>
          )}

          {/* Ended sessions */}
          {endedSessions.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Ended · {endedSessions.length}
              </p>
              {endedSessions.map(s => (
                <SessionCard key={s.session_id} s={s} onSummary={openSessionSummary} onInteract={openSessionInteract} />
              ))}
            </div>
          )}

        </div>
      )}
    </div>
  );
};

const SessionCard: React.FC<{ s: SessionSummary; onSummary: (s: SessionSummary) => void; onInteract: (s: SessionSummary) => void }> = ({ s, onSummary, onInteract }) => {
  const isActive = s.status === 'active';
  return (
    <div className={`bg-white border rounded-xl px-5 py-4 flex items-center gap-4 hover:shadow-sm transition-all ${
      isActive ? 'border-slate-200 hover:border-blue-200' : 'border-slate-100 opacity-80 hover:opacity-100 hover:border-slate-200'
    }`}>
      {/* Status dot */}
      <div
        className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
          isActive ? 'bg-emerald-400 animate-pulse' : 'bg-slate-300'
        }`}
        title={isActive ? 'Active' : 'Ended'}
      />

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => onInteract(s)}
            className="text-sm font-bold text-blue-600 hover:underline truncate text-left"
            title="Open in Playground"
          >
            {s.agent_name}
          </button>
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${
            isActive
              ? 'text-blue-700 bg-blue-50 border-blue-200'
              : 'text-slate-500 bg-slate-50 border-slate-200'
          }`}>
            {PROVIDER_LABELS[s.provider] ?? s.provider}
          </span>
          <span className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full border border-slate-200 truncate max-w-[120px]">
            {s.model.split('/').pop()?.split('-').slice(0, 3).join('-')}
          </span>
          {!isActive && (
            <span className="text-[10px] font-bold text-slate-400 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded-full">
              Ended
            </span>
          )}
        </div>
        <div className="flex items-center gap-4 mt-1.5 text-xs text-slate-400 flex-wrap">
          <span className="flex items-center gap-1">
            <MessageSquare size={10} /> {s.message_count} messages
          </span>
          <span className="flex items-center gap-1">
            <Zap size={10} /> {s.token_total.toLocaleString()} tokens
          </span>
          <span className="flex items-center gap-1">
            <Clock size={10} /> Started {formatRelative(s.created_at)}
          </span>
          {s.ended_at && (
            <span className="text-slate-300">· Ended {formatRelative(s.ended_at)}</span>
          )}
        </div>
      </div>

      {/* Action */}
      <button
        onClick={() => onSummary(s)}
        className="flex items-center gap-1.5 text-xs font-bold text-blue-600 hover:bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-200 transition-colors flex-shrink-0"
        title="View session summary"
      >
        <ExternalLink size={12} /> Summary
      </button>
    </div>
  );
};

export default AgentSessionsTab;
