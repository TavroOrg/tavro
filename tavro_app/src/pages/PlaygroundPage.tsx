// ── src/pages/PlaygroundPage.tsx ─────────────────────────────────────────────

import React, { useState, useRef, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  FlaskConical, Play, Square, RotateCcw, Plus, Send, Loader2,
  ChevronDown, ChevronUp, Settings2, MessageSquare, ClipboardList,
  Trash2, Download, Bot, User, Copy, Check, Info,
} from 'lucide-react';
import { usePlayground } from '../context/PlaygroundContext';
import type { AttachmentPayload } from '../context/PlaygroundContext';
import AttachmentPicker from '../components/playground/AttachmentPicker';
import type { PendingAttachment } from '../components/playground/AttachmentPicker';
import { useBlueprint } from '../context/BlueprintContext';
import { useChatSync } from '../hooks/useChatSync';
import {
  INFRA_PROVIDERS, PROVIDER_MODELS, OBSERVATION_TYPES,
  type InfraProvider, type PlaygroundObservation,
} from '../types/playground';

// ── Sub-components ────────────────────────────────────────────────────────────

const ProviderCard: React.FC<{
  meta: typeof INFRA_PROVIDERS[0];
  selected: boolean;
  onClick: () => void;
}> = ({ meta, selected, onClick }) => (
  <button
    onClick={meta.available ? onClick : undefined}
    disabled={!meta.available}
    className={`flex items-start gap-3 px-3 py-3 rounded-xl border text-left transition-all w-full ${
      selected && meta.available
        ? 'border-blue-500 dark:border-blue-400 bg-blue-50 dark:bg-blue-900/20 shadow-sm'
        : meta.available
        ? 'border-slate-200 dark:border-slate-700 hover:border-blue-200 dark:hover:border-blue-700 bg-white dark:bg-slate-800/50'
        : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/30 opacity-50 cursor-not-allowed'
    }`}
  >
    <span className="text-xl flex-shrink-0 mt-0.5">{meta.icon}</span>
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2">
        <p className={`text-[11px] font-bold ${selected && meta.available ? 'text-blue-700 dark:text-blue-300' : 'text-slate-800 dark:text-slate-100'}`}>
          {meta.shortLabel}
        </p>
        {!meta.available && (
          <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded-full border border-slate-200 dark:border-slate-700">
            Soon
          </span>
        )}
        {selected && meta.available && (
          <span className="w-3.5 h-3.5 bg-blue-500 rounded-full flex-shrink-0 flex items-center justify-center">
            <Check size={8} className="text-white" />
          </span>
        )}
      </div>
      <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-tight mt-0.5 line-clamp-2">{meta.description}</p>
    </div>
  </button>
);

const ObservationBadge: React.FC<{
  obs: PlaygroundObservation;
  onRemove: () => void;
}> = ({ obs, onRemove }) => {
  const meta = OBSERVATION_TYPES[obs.type];
  return (
    <div className={`flex items-start gap-2 px-3 py-2.5 rounded-xl border text-left ${meta.bg}`}>
      <div className="flex-1 min-w-0">
        <p className={`text-[10px] font-bold uppercase tracking-wider ${meta.color}`}>{meta.label}</p>
        <p className="text-[11px] text-slate-700 dark:text-slate-200 mt-0.5 leading-relaxed">{obs.content}</p>
        <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">{obs.createdAt.toLocaleTimeString()}</p>
      </div>
      <button onClick={onRemove} className="text-slate-300 dark:text-slate-600 hover:text-rose-500 transition-colors flex-shrink-0 mt-0.5">
        <Trash2 size={11} />
      </button>
    </div>
  );
};

// ── Main page ─────────────────────────────────────────────────────────────────

const PlaygroundPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const {
    config, messages, observations, isRunning, sessionActive, tokenCount,
    summary, summaryLoading,
    setConfig, setProvider, loadFromAgent, resetConfig,
    startSession, endSession, sendMessage, clearMessages, generateSummary,
    addObservation, removeObservation,
  } = usePlayground();
  const { activeCompany, nodes } = useBlueprint();

  // Sync chat context
  useChatSync('other', null);

  // Load from URL params (launched from agent detail page)
  useEffect(() => {
    const id    = searchParams.get('useCase');
    const title = searchParams.get('title');
    const desc  = searchParams.get('desc');
    if (id && title) loadFromAgent(id, decodeURIComponent(title), desc ? decodeURIComponent(desc) : undefined);
  }, []);

  // Inject blueprint context into system prompt when company changes
  useEffect(() => {
    if (!activeCompany || !config.useCaseTitle) return;
    const dimSummary = nodes.slice(0, 20)
      .map(n => `- [${n.category}] ${n.label}`)
      .join('\n');
    if (dimSummary && !config.systemPrompt.includes('Company Blueprint')) {
      setConfig({
        systemPrompt: config.systemPrompt +
          `\n\n## Company Blueprint Context\nCompany: ${activeCompany.name} | Industry: ${activeCompany.industry}\n${dimSummary}`,
        companyId:   activeCompany.id,
        companyName: activeCompany.name,
      });
    }
  }, [activeCompany?.id]);

  // UI state
  const [activeTab,       setActiveTab]       = useState<'config' | 'chat' | 'observations' | 'summary'>('config');
  const [input,           setInput]           = useState('');
  const [newObsType,      setNewObsType]      = useState<PlaygroundObservation['type']>('note');
  const [newObsText,      setNewObsText]      = useState('');
  const [showObsForm,     setShowObsForm]     = useState(false);
  const [promptExpanded,  setPromptExpanded]  = useState(false);
  const [copied,          setCopied]          = useState(false);
  const [attachments,     setAttachments]     = useState<PendingAttachment[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef       = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if ((!input.trim() && attachments.length === 0) || isRunning) return;
    const text = input.trim();
    const atts: AttachmentPayload[] = attachments.map(a => ({
      name:      a.name,
      mime_type: a.mime_type,
      data:      a.data,
    }));
    setInput('');
    setAttachments([]);
    await sendMessage(text, atts);
  };

  const handleAddObs = () => {
    if (!newObsText.trim()) return;
    addObservation({ type: newObsType, content: newObsText.trim() });
    setNewObsText('');
    setShowObsForm(false);
  };

  const copyTranscript = () => {
    const transcript = messages
      .filter(m => m.role !== 'system')
      .map(m => `${m.role === 'user' ? 'User' : 'Agent'}: ${m.content}`)
      .join('\n\n');
    navigator.clipboard.writeText(transcript);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadTranscript = () => {
    const lines = [
      `Agent Playground Session`,
      `Agent: ${config.agentName}`,
      `Model: ${config.provider} / ${config.model}`,
      `Date: ${new Date().toLocaleString()}`,
      `Messages: ${messages.filter(m => m.role !== 'system').length}`,
      `Tokens used: ${tokenCount.toLocaleString()}`,
      '',
      '─'.repeat(60),
      '',
      ...messages
        .filter(m => m.role !== 'system')
        .map(m => [
          `[${m.role === 'user' ? 'USER' : 'AGENT'}] ${new Date(m.timestamp).toLocaleTimeString()}`,
          m.content,
          '',
        ].join('\n')),
    ];
    if (observations.length > 0) {
      lines.push('─'.repeat(60), '', 'OBSERVATIONS', '');
      observations.forEach(o => {
        lines.push(`[${OBSERVATION_TYPES[o.type].label.toUpperCase()}] ${o.content}`);
        lines.push(`  ${new Date(o.createdAt).toLocaleTimeString()}`, '');
      });
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `tavro-session-${config.agentName.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const navCls = (tab: typeof activeTab) =>
    `flex items-center gap-1.5 px-3 py-2 text-xs font-bold border-b-2 transition-colors ${
      activeTab === tab
        ? 'border-blue-500 text-blue-600 dark:text-blue-400'
        : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
    }`;

  return (
    <div className="flex flex-col h-full gap-0 -m-8">

      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-8 py-5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex-shrink-0 transition-colors">
        <div className="flex items-center gap-3">
          <div className="bg-blue-600 text-white p-2.5 rounded-xl shadow-sm">
            <FlaskConical size={18} />
          </div>
          <div>
            <h1 className="font-bold text-slate-800 dark:text-slate-100 text-lg">Agent Playground</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {config.useCaseTitle
                ? `Prototyping: ${config.agentName}`
                : 'Select an agent to start prototyping'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Token counter */}
          {tokenCount > 0 && (
            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-1 rounded-full">
              {tokenCount.toLocaleString()} tokens
            </span>
          )}

          {/* Provider badge */}
          <span className="text-[11px] font-bold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 px-2.5 py-1 rounded-full">
            {INFRA_PROVIDERS.find(p => p.id === config.provider)?.shortLabel ?? config.provider}
            {' · '}{config.model.split('/').pop()?.split('-').slice(0,3).join('-')}
          </span>

          {/* Session controls */}
          {!sessionActive ? (
            <button
              onClick={startSession}
              disabled={!config.agentName.trim()}
              className="flex items-center gap-2 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 dark:hover:bg-blue-500 px-4 py-2 rounded-lg shadow-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Play size={14} /> Start session
            </button>
          ) : (
            <button
              onClick={endSession}
              className="flex items-center gap-2 text-sm font-bold text-white bg-rose-600 hover:bg-rose-700 px-4 py-2 rounded-lg shadow-sm transition-colors"
            >
              <Square size={14} /> End session
            </button>
          )}

          <button onClick={resetConfig}
            className="p-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
            title="Reset playground">
            <RotateCcw size={16} />
          </button>
        </div>
      </div>

      {/* ── Tab nav ───────────────────────────────────────────────────────────── */}
      <div className="flex items-center border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-8 flex-shrink-0">
        <button className={navCls('config')} onClick={() => setActiveTab('config')}>
          <Settings2 size={13} /> Configure
        </button>
        <button className={navCls('chat')} onClick={() => setActiveTab('chat')}>
          <MessageSquare size={13} /> Interact
          {messages.filter(m => m.role !== 'system').length > 0 && (
            <span className="ml-1 text-[9px] font-bold bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded-full">
              {messages.filter(m => m.role !== 'system').length}
            </span>
          )}
        </button>
        <button className={navCls('observations')} onClick={() => setActiveTab('observations')}>
          <ClipboardList size={13} /> Observations
          {observations.length > 0 && (
            <span className="ml-1 text-[9px] font-bold bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400 px-1.5 py-0.5 rounded-full">
              {observations.length}
            </span>
          )}
        </button>
        <button className={navCls('summary' as any)} onClick={() => { setActiveTab('summary' as any); if (!summary && sessionActive) generateSummary(); }}>
          <Loader2 size={13} className={summaryLoading ? 'animate-spin' : ''} /> Summary
          {summary && <span className="ml-1 text-[9px] font-bold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 rounded-full">Ready</span>}
        </button>
      </div>

      {/* ── Tab content ───────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto bg-slate-50 dark:bg-slate-950 transition-colors">

        {/* ══════════════════════════════════════════════════════════════════════
            CONFIG TAB
        ══════════════════════════════════════════════════════════════════════ */}
        {activeTab === 'config' && (
          <div className="max-w-3xl mx-auto px-8 py-8 flex flex-col gap-6">

            {/* Infrastructure provider */}
            <Section title="Infrastructure" icon={<FlaskConical size={14} />}>
              <div className="grid grid-cols-2 gap-2">
                {INFRA_PROVIDERS.map(meta => (
                  <ProviderCard
                    key={meta.id}
                    meta={meta}
                    selected={config.provider === meta.id}
                    onClick={() => setProvider(meta.id as InfraProvider)}
                  />
                ))}
              </div>
            </Section>

            {/* Model */}
            <Section title="Model" icon={<Bot size={14} />}>
              <select
                value={config.model}
                onChange={e => setConfig({ model: e.target.value })}
                className={inputCls}
              >
                {PROVIDER_MODELS[config.provider].map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </Section>

            {/* Agent identity */}
            <Section title="Agent identity" icon={<Bot size={14} />}>
              <Field label="Agent name">
                <input
                  value={config.agentName}
                  onChange={e => setConfig({ agentName: e.target.value })}
                  placeholder="e.g. Loan Origination Assistant"
                  className={inputCls}
                />
              </Field>

              <Field label="System prompt">
                <div className="relative">
                  <textarea
                    value={config.systemPrompt}
                    onChange={e => setConfig({ systemPrompt: e.target.value })}
                    rows={promptExpanded ? 14 : 5}
                    placeholder="Describe what this agent does, its persona, constraints, and how it should respond…"
                    className={`${inputCls} resize-none`}
                  />
                  <button
                    onClick={() => setPromptExpanded(p => !p)}
                    className="absolute bottom-2 right-2 text-[10px] text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 flex items-center gap-1 bg-white dark:bg-slate-800 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 transition-colors"
                  >
                    {promptExpanded ? <><ChevronUp size={10} /> Collapse</> : <><ChevronDown size={10} /> Expand</>}
                  </button>
                </div>
                <p className="text-[10px] text-slate-400 dark:text-slate-500">
                  {config.companyName && (
                    <span className="text-blue-500 dark:text-blue-400 font-semibold">
                      Company blueprint from {config.companyName} is auto-injected.{' '}
                    </span>
                  )}
                  This is what the agent sees as its instructions.
                </p>
              </Field>
            </Section>

            {/* Parameters */}
            <Section title="Parameters" icon={<Settings2 size={14} />}>
              <div className="grid grid-cols-2 gap-4">
                <Field label={`Temperature — ${config.temperature}`}>
                  <input
                    type="range" min={0} max={1} step={0.05}
                    value={config.temperature}
                    onChange={e => setConfig({ temperature: parseFloat(e.target.value) })}
                    className="w-full accent-violet-600"
                  />
                  <div className="flex justify-between text-[10px] text-slate-400 dark:text-slate-500">
                    <span>Precise</span><span>Creative</span>
                  </div>
                </Field>
                <Field label="Max tokens">
                  <select
                    value={config.maxTokens}
                    onChange={e => setConfig({ maxTokens: parseInt(e.target.value) })}
                    className={inputCls}
                  >
                    {[512, 1024, 2048, 4096, 8192].map(n => (
                      <option key={n} value={n}>{n.toLocaleString()}</option>
                    ))}
                  </select>
                </Field>
              </div>
            </Section>

            {/* Tools */}
            <Section title="Tools & capabilities" icon={<Settings2 size={14} />}>
              <div className="flex flex-col gap-2">
                {config.tools.map((tool, i) => (
                  <label key={tool.id}
                    className={`flex items-center gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-all ${
                      tool.enabled
                        ? 'border-violet-300 dark:border-violet-700 bg-violet-50 dark:bg-violet-900/20'
                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50'
                    }`}>
                    <input
                      type="checkbox"
                      checked={tool.enabled}
                      onChange={e => {
                        const newTools = [...config.tools];
                        newTools[i] = { ...tool, enabled: e.target.checked };
                        setConfig({ tools: newTools });
                      }}
                      className="accent-violet-600 w-3.5 h-3.5 flex-shrink-0"
                    />
                    <div className="flex-1">
                      <p className={`text-[11px] font-bold ${tool.enabled ? 'text-violet-700 dark:text-violet-300' : 'text-slate-700 dark:text-slate-200'}`}>
                        {tool.name}
                      </p>
                      <p className="text-[10px] text-slate-400 dark:text-slate-500">{tool.description}</p>
                    </div>
                    <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded-full border border-slate-200 dark:border-slate-700">
                      {tool.source}
                    </span>
                  </label>
                ))}
              </div>
            </Section>

            {/* CTA */}
            {!sessionActive && (
              <button
                onClick={() => { startSession(); setActiveTab('chat'); }}
                disabled={!config.agentName.trim()}
                className="flex items-center justify-center gap-2 w-full py-3 text-sm font-bold text-white bg-violet-600 hover:bg-violet-700 dark:hover:bg-violet-500 rounded-xl shadow-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Play size={15} /> Start session and interact
              </button>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════════
            INTERACT TAB
        ══════════════════════════════════════════════════════════════════════ */}
        {activeTab === 'chat' && (
          <div className="flex flex-col h-full max-w-3xl mx-auto w-full">

            {/* Not started state */}
            {!sessionActive && (
              <div className="flex flex-col items-center justify-center py-24 gap-5 text-slate-400 dark:text-slate-500 px-8">
                <div className="p-5 bg-violet-50 dark:bg-violet-900/20 rounded-2xl border border-violet-100 dark:border-violet-800">
                  <FlaskConical size={32} className="text-violet-500 dark:text-violet-400" />
                </div>
                <div className="text-center">
                  <p className="font-bold text-slate-600 dark:text-slate-300 text-base">Session not started</p>
                  <p className="text-sm mt-1">Configure your agent and click Start session to begin interacting.</p>
                </div>
                <button onClick={() => setActiveTab('config')}
                  className="flex items-center gap-2 text-sm font-bold text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20 px-4 py-2 rounded-lg transition-colors">
                  <Settings2 size={14} /> Go to configuration
                </button>
              </div>
            )}

            {/* Messages */}
            {sessionActive && (
              <div className="flex flex-col flex-1">
                <div className="flex items-center justify-between px-8 py-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex-shrink-0">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                    <span className="text-xs font-bold text-slate-600 dark:text-slate-300">Session active</span>
                    <span className="text-[10px] text-slate-400 dark:text-slate-500">
                      {messages.filter(m => m.role !== 'system').length} messages
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={copyTranscript}
                      className="flex items-center gap-1 text-[10px] font-bold text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 px-2 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                      {copied ? <Check size={11} /> : <Copy size={11} />}
                      {copied ? 'Copied' : 'Copy transcript'}
                    </button>
                    <button onClick={downloadTranscript}
                      className="flex items-center gap-1 text-[10px] font-bold text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 px-2 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                      title="Download transcript as .txt file">
                      <Download size={11} /> Download
                    </button>
                    <button onClick={clearMessages}
                      className="flex items-center gap-1 text-[10px] font-bold text-slate-400 dark:text-slate-500 hover:text-rose-500 dark:hover:text-rose-400 px-2 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                      <Trash2 size={11} /> Clear
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto px-8 py-6 flex flex-col gap-4">
                  {messages.filter(m => m.role !== 'system').length === 0 ? (
                    <div className="text-center text-slate-400 dark:text-slate-500 text-sm py-12">
                      <Bot size={28} className="mx-auto mb-3 text-slate-300 dark:text-slate-600" />
                      <p className="font-medium">Send a message to start testing the agent</p>
                      <div className="mt-4 flex flex-col gap-2 max-w-sm mx-auto">
                        {[
                          'What can you help me with?',
                          'Walk me through how you would handle a typical request',
                          'What information do you need from me to work effectively?',
                        ].map(s => (
                          <button key={s} onClick={() => { setInput(s); inputRef.current?.focus(); }}
                            className="text-left text-xs text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/40 border border-blue-200 dark:border-blue-800 rounded-xl px-3 py-2 transition-colors">
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    messages.filter(m => m.role !== 'system').map(msg => (
                      <div key={msg.id}
                        className={`flex flex-col gap-1 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                        <div className={`flex items-end gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                          <div className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center shadow-sm ${msg.role === 'user' ? 'bg-slate-700' : 'bg-violet-600'}`}>
                            {msg.role === 'user' ? <User size={13} className="text-white" /> : <Bot size={13} className="text-white" />}
                          </div>
                          <div className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed shadow-sm ${
                            msg.role === 'user'
                              ? 'bg-slate-700 text-white rounded-br-sm'
                              : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 rounded-bl-sm'
                          }`}>
                            <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                            {msg.tokens && (
                              <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">{msg.tokens} tokens</p>
                            )}
                          </div>
                        </div>
                        {/* Quick observation tags on assistant messages */}
                        {msg.role === 'assistant' && (
                          <div className="flex gap-1.5 ml-9">
                            {(['gap', 'works_well', 'needs_info', 'unexpected'] as const).map(type => (
                              <button key={type}
                                onClick={() => addObservation({ type, content: `Re: "${msg.content.slice(0, 60)}…"`, messageId: msg.id })}
                                className={`text-[9px] font-bold px-2 py-0.5 rounded-full border transition-colors ${OBSERVATION_TYPES[type].bg} ${OBSERVATION_TYPES[type].color}`}>
                                + {OBSERVATION_TYPES[type].label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                  {isRunning && (
                    <div className="flex items-center gap-2 text-slate-400 dark:text-slate-500">
                      <div className="w-7 h-7 rounded-full bg-violet-600 flex items-center justify-center flex-shrink-0">
                        <Bot size={13} className="text-white" />
                      </div>
                      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-1.5 shadow-sm">
                        {[0, 150, 300].map(d => (
                          <span key={d} className="w-1.5 h-1.5 bg-slate-400 dark:bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: `${d}ms` }} />
                        ))}
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Input */}
                <div className="px-8 py-4 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex-shrink-0">
                  <div className="flex flex-col gap-2">
                    <AttachmentPicker
                      attachments={attachments}
                      onChange={setAttachments}
                      disabled={isRunning}
                    />
                    <div className="flex items-center gap-2">
                      <input
                        ref={inputRef}
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }}}
                        placeholder={attachments.length > 0 ? 'Add a message… (optional)' : 'Send a message to the agent…'}
                        disabled={isRunning}
                        className="flex-1 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-violet-200 dark:focus:ring-violet-800 focus:border-violet-400 dark:focus:border-violet-600 text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 disabled:opacity-60 transition-all"
                      />
                      <button
                        onClick={handleSend}
                        disabled={(!input.trim() && attachments.length === 0) || isRunning}
                        className="w-10 h-10 bg-violet-600 hover:bg-violet-700 disabled:bg-slate-200 dark:disabled:bg-slate-700 disabled:text-slate-400 text-white rounded-xl flex items-center justify-center transition-colors shadow-sm flex-shrink-0"
                      >
                        {isRunning ? <Loader2 size={15} className="animate-spin" /> : <Send size={14} />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════════
            OBSERVATIONS TAB
        ══════════════════════════════════════════════════════════════════════ */}
        {activeTab === 'observations' && (
          <div className="max-w-3xl mx-auto px-8 py-8 flex flex-col gap-5">

            {/* Add observation */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
                <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Capture observations</p>
                <button onClick={() => setShowObsForm(p => !p)}
                  className="flex items-center gap-1.5 text-[11px] font-bold text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20 px-3 py-1.5 rounded-lg transition-colors">
                  <Plus size={12} /> Add observation
                </button>
              </div>

              {showObsForm && (
                <div className="px-5 py-4 flex flex-col gap-3 border-b border-slate-100 dark:border-slate-800">
                  <div className="grid grid-cols-5 gap-1.5">
                    {(Object.keys(OBSERVATION_TYPES) as PlaygroundObservation['type'][]).map(type => (
                      <button key={type}
                        onClick={() => setNewObsType(type)}
                        className={`py-1.5 px-2 rounded-lg text-[10px] font-bold border transition-all text-center ${
                          newObsType === type
                            ? `${OBSERVATION_TYPES[type].bg} ${OBSERVATION_TYPES[type].color}`
                            : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600'
                        }`}>
                        {OBSERVATION_TYPES[type].label}
                      </button>
                    ))}
                  </div>
                  <textarea
                    value={newObsText}
                    onChange={e => setNewObsText(e.target.value)}
                    placeholder="Describe what you observed…"
                    rows={3}
                    className={`${inputCls} resize-none`}
                    autoFocus
                  />
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setShowObsForm(false)}
                      className="text-sm font-bold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 px-4 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                      Cancel
                    </button>
                    <button onClick={handleAddObs} disabled={!newObsText.trim()}
                      className="text-sm font-bold text-white bg-violet-600 hover:bg-violet-700 dark:hover:bg-violet-500 px-4 py-2 rounded-lg transition-colors disabled:opacity-40">
                      Save observation
                    </button>
                  </div>
                </div>
              )}

              <div className="px-5 py-3 flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                <Info size={11} />
                Tag observations during or after your session. These will be saved back to the use case record.
              </div>
            </div>

            {/* Observation list */}
            {observations.length === 0 ? (
              <div className="text-center py-16 text-slate-400 dark:text-slate-500">
                <ClipboardList size={28} className="mx-auto mb-3 text-slate-300 dark:text-slate-600" />
                <p className="font-medium text-slate-500 dark:text-slate-400">No observations yet</p>
                <p className="text-sm mt-1">Interact with the agent and tag what you notice.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {/* Summary counts */}
                <div className="flex flex-wrap gap-2 mb-2">
                  {(Object.keys(OBSERVATION_TYPES) as PlaygroundObservation['type'][])
                    .map(type => {
                      const count = observations.filter(o => o.type === type).length;
                      if (!count) return null;
                      return (
                        <span key={type} className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${OBSERVATION_TYPES[type].bg} ${OBSERVATION_TYPES[type].color}`}>
                          {count} {OBSERVATION_TYPES[type].label}
                        </span>
                      );
                    })}
                </div>
                {observations.map(obs => (
                  <ObservationBadge key={obs.id} obs={obs} onRemove={() => removeObservation(obs.id)} />
                ))}

                {/* Export */}
                <button
                  onClick={() => {
                    const text = observations.map(o =>
                      `[${OBSERVATION_TYPES[o.type].label}] ${o.content}\n${o.createdAt.toLocaleString()}`
                    ).join('\n\n');
                    navigator.clipboard.writeText(text);
                  }}
                  className="flex items-center gap-2 text-[11px] font-bold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 mt-2 self-start"
                >
                  <Download size={12} /> Copy all observations
                </button>
              </div>
            )}
          </div>
        )}
        {/* ══════════════════════════════════════════════════════════════════════
            SUMMARY TAB
        ══════════════════════════════════════════════════════════════════════ */}
        {(activeTab as string) === 'summary' && (
          <div className="max-w-3xl mx-auto px-8 py-8 flex flex-col gap-5">
            {!sessionActive && !summary ? (
              <div className="text-center py-16 text-slate-400 dark:text-slate-500">
                <Loader2 size={28} className="mx-auto mb-3 text-slate-300 dark:text-slate-600" />
                <p className="font-medium text-slate-500 dark:text-slate-400">No session to summarise</p>
                <p className="text-sm mt-1">Start a session and interact with the agent first.</p>
              </div>
            ) : summaryLoading ? (
              <div className="flex flex-col items-center gap-4 py-16">
                <Loader2 size={28} className="animate-spin text-violet-500" />
                <p className="text-sm text-slate-500 dark:text-slate-400">Generating AI summary of your session…</p>
              </div>
            ) : summary ? (
              <div className="flex flex-col gap-4">
                {/* Overall assessment */}
                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-5">
                  <p className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">Overall assessment</p>
                  <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">{summary.overall_assessment}</p>
                </div>
                {/* Grid of findings */}
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { key: 'capabilities',           label: 'Works well',           color: 'emerald' },
                    { key: 'gaps',                   label: 'Gaps found',           color: 'rose'    },
                    { key: 'information_needed',     label: 'Information needed',   color: 'amber'   },
                    { key: 'unexpected_behaviours',  label: 'Unexpected',           color: 'violet'  },
                  ].map(({ key, label, color }) => {
                    const items = (summary as any)[key] as string[];
                    if (!items?.length) return null;
                    return (
                      <div key={key} className={`bg-${color}-50 dark:bg-${color}-900/20 border border-${color}-200 dark:border-${color}-800 rounded-xl p-4`}>
                        <p className={`text-[10px] font-bold text-${color}-700 dark:text-${color}-300 uppercase tracking-wider mb-2`}>{label}</p>
                        <ul className="flex flex-col gap-1">
                          {items.map((item, i) => (
                            <li key={i} className={`text-[11px] text-${color}-800 dark:text-${color}-200 flex gap-2`}>
                              <span className="flex-shrink-0 mt-0.5">·</span>{item}
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
                {/* Next steps */}
                {summary.recommended_next_steps?.length > 0 && (
                  <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4">
                    <p className="text-[10px] font-bold text-blue-700 dark:text-blue-300 uppercase tracking-wider mb-2">Recommended next steps</p>
                    <ol className="flex flex-col gap-1.5">
                      {summary.recommended_next_steps.map((step, i) => (
                        <li key={i} className="text-[11px] text-blue-800 dark:text-blue-200 flex gap-2">
                          <span className="font-bold flex-shrink-0">{i + 1}.</span>{step}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
                <button onClick={generateSummary} disabled={summaryLoading}
                  className="flex items-center gap-2 text-[11px] font-bold text-slate-400 dark:text-slate-500 hover:text-violet-600 dark:hover:text-violet-400 self-start transition-colors">
                  <Loader2 size={11} className={summaryLoading ? 'animate-spin' : ''} /> Regenerate summary
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-4 py-16">
                <button onClick={generateSummary}
                  className="flex items-center gap-2 text-sm font-bold text-white bg-violet-600 hover:bg-violet-700 px-5 py-2.5 rounded-xl shadow-sm transition-colors">
                  <Loader2 size={14} /> Generate session summary
                </button>
                <p className="text-xs text-slate-400 dark:text-slate-500">AI will analyse your session and identify gaps, capabilities, and next steps.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ── Shared sub-components ─────────────────────────────────────────────────────

const Section: React.FC<{ title: string; icon: React.ReactNode; children: React.ReactNode }> = ({ title, icon, children }) => (
  <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden transition-colors">
    <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
      <span className="text-violet-500 dark:text-violet-400">{icon}</span>
      <p className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">{title}</p>
    </div>
    <div className="px-5 py-5 flex flex-col gap-4">{children}</div>
  </div>
);

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex flex-col gap-1.5">
    <label className="text-xs font-bold text-slate-600 dark:text-slate-400">{label}</label>
    {children}
  </div>
);

const inputCls = "w-full px-3 py-2.5 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg outline-none focus:ring-2 focus:ring-violet-200 dark:focus:ring-violet-800 focus:border-violet-300 dark:focus:border-violet-600 text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 transition-all";

export default PlaygroundPage;
