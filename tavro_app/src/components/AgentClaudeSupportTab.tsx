import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import {
    Check,
    Clipboard,
    Code2,
    FileCode2,
    FolderOpen,
    Loader2,
    Play,
    RefreshCw,
    Rocket,
    Sparkles,
    Terminal,
    X,
} from 'lucide-react';
import { AgentData } from '../types/agent';

const API_BASE = (import.meta.env.VITE_TWIN_API_URL as string | undefined) ?? 'http://localhost:8000';

interface AgentClaudeSupportTabProps {
    agent: AgentData;
}

type TerminalLine = {
    id: number;
    kind: 'system' | 'command' | 'output' | 'success' | 'error';
    text: string;
};

type PanelTab = 'code' | 'terminal';

const slugify = (value: string): string =>
    value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'agent';

const AgentClaudeSupportTab: React.FC<AgentClaudeSupportTabProps> = ({ agent }) => {
    const agentId     = agent.identification?.agent_id || agent.name;
    const fileName    = `${slugify(agentId)}_${slugify(agent.name)}.py`;
    const apiFilePath = fileName;
    const tenantId         = agent.tenant_id ?? localStorage.getItem('tavro_tenant_id') ?? null;
    const tavroInternalId  = agent.identification?.agent_internal_id ?? null;

    const generateCommand = `/generate-agent-code ${agentId}`;
    const testCommand     = `python ${apiFilePath}`;

    // ── Terminal state ──────────────────────────────────────────────────────
    const initialLines = useMemo<TerminalLine[]>(() => [
        { id: 1, kind: 'system',  text: '╔══════════════════════════════════╗' },
        { id: 2, kind: 'system',  text: '║  Claude Code  ·  Tavro Agent CLI ║' },
        { id: 3, kind: 'system',  text: '╚══════════════════════════════════╝' },
        { id: 4, kind: 'output',  text: '' },
        { id: 5, kind: 'output',  text: `Agent: ${agent.name}` },
        { id: 6, kind: 'output',  text: `ID:    ${agent.identification?.agent_id || agent.name}` },
        { id: 7, kind: 'output',  text: '' },
        { id: 8, kind: 'output',  text: 'Commands:' },
        { id: 9, kind: 'output',  text: '  /generate-agent-code <id>   — generate source code' },
        { id: 10, kind: 'output', text: '  update <file>: <instruction> — modify open code' },
        { id: 11, kind: 'output', text: '  claude "<prompt>"            — ask Claude anything' },
        { id: 12, kind: 'output', text: '' },
    ], [agent.name, agent.identification]);

    const [lines,       setLines]       = useState<TerminalLine[]>(initialLines);
    const [input,       setInput]       = useState(generateCommand);
    const [running,     setRunning]     = useState(false);
    const terminalRef = useRef<HTMLDivElement>(null);
    const inputRef    = useRef<HTMLInputElement>(null);

    // ── Code editor state ───────────────────────────────────────────────────
    const [fileContent,  setFileContent]  = useState<string | null>(null);
    const [fileLoading,  setFileLoading]  = useState(false);
    const [fileError,    setFileError]    = useState<string | null>(null);
    const [fileList,     setFileList]     = useState<string[]>([]);
    const [activeFile,   setActiveFile]   = useState<string>(apiFilePath);

    // ── UI state ────────────────────────────────────────────────────────────
    const [activeTab,     setActiveTab]     = useState<PanelTab>('terminal');
    const [copied,        setCopied]        = useState(false);
    const [sidebarOpen,   setSidebarOpen]   = useState(true);
    const [deploying,     setDeploying]     = useState(false);

    // ── Helpers ─────────────────────────────────────────────────────────────
    const pushLines = (items: Omit<TerminalLine, 'id'>[]) => {
        setLines(prev => {
            const next = prev.length ? Math.max(...prev.map(l => l.id)) + 1 : 1;
            return [...prev, ...items.map((item, i) => ({ ...item, id: next + i }))];
        });
    };

    const scrollTerminal = () =>
        window.setTimeout(() =>
            terminalRef.current?.scrollTo({ top: terminalRef.current.scrollHeight, behavior: 'smooth' }), 20);

    const copyLog = async () => {
        await navigator.clipboard.writeText(lines.map(l => l.text).join('\n'));
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
    };

    // ── localStorage helpers ─────────────────────────────────────────────────
    const storageKey = `tavro:agent-code:${agentId}`;

    const loadFile = useCallback((path: string) => {
        setFileLoading(true);
        setFileError(null);
        setActiveTab('code');
        try {
            const content = localStorage.getItem(storageKey);
            if (content !== null) {
                setFileContent(content);
                setActiveFile(path);
            } else {
                setFileError('not-found');
                setFileContent(null);
            }
        } finally {
            setFileLoading(false);
        }
    }, [storageKey]);

    const refreshFileList = useCallback(() => {
        const saved = localStorage.getItem(storageKey);
        setFileList(saved !== null ? [apiFilePath] : []);
    }, [storageKey, apiFilePath]);

    // On mount, load from DB first, fall back to localStorage
    useEffect(() => {
        const load = async () => {
            try {
                const resp = await fetch(
                    `${API_BASE}/api/v1/claude-run/load-from-db?agent_id=${encodeURIComponent(agentId)}&filename=${encodeURIComponent(apiFilePath)}`
                );
                if (resp.ok) {
                    const data = await resp.json();
                    if (data.code) {
                        setFileContent(data.code);
                        setActiveFile(apiFilePath);
                        setFileList([apiFilePath]);
                        setActiveTab('code');
                        localStorage.setItem(storageKey, data.code);
                        return;
                    }
                }
            } catch { /* ignore */ }
            const saved = localStorage.getItem(storageKey);
            if (saved !== null) {
                setFileContent(saved);
                setActiveFile(apiFilePath);
                setFileList([apiFilePath]);
                setActiveTab('code');
            }
        };
        load();
    }, [storageKey, apiFilePath, agentId]);

    const saveFile = async () => {
        if (fileContent === null) return;
        try {
            localStorage.setItem(storageKey, fileContent);
            setFileList(prev => prev.includes(apiFilePath) ? prev : [apiFilePath, ...prev]);
            const resp = await fetch(`${API_BASE}/api/v1/claude-run/save-to-db`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ agent_id: agentId, filename: activeFile, code: fileContent, tenant_id: tenantId, agent_internal_id: tavroInternalId }),
            });
            if (resp.ok) {
                pushLines([{ kind: 'success', text: `✓ Saved to database: ${activeFile}` }]);
            } else {
                pushLines([{ kind: 'error', text: `DB save failed (${resp.status}) — saved to local only` }]);
            }
        } catch (err) {
            pushLines([{ kind: 'error', text: `Save failed: ${err}` }]);
        }
    };

    // ── Command runner ───────────────────────────────────────────────────────
    const runCommand = async (command: string) => {
        const trimmed = command.trim();
        if (!trimmed || running) return;

        if (trimmed.toLowerCase() === 'clear') {
            setLines(initialLines);
            setInput('');
            return;
        }

        setInput('');
        setRunning(true);
        setActiveTab('terminal');
        pushLines([{ kind: 'command', text: `tavro@claude-support> ${trimmed}` }]);
        scrollTerminal();

        const isGenerateCmd = trimmed.startsWith('/generate-agent-code') || trimmed.includes('Update');
        let generationSucceeded = false;
        let generatedContent: string | null = null;

        try {
            const response = await fetch(`${API_BASE}/api/v1/claude-run/stream`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    command: trimmed,
                    current_code: fileContent ?? '',

                    agent_id: agent.identification?.agent_id,
                    agent_name: agent.name,
                    agent_description: agent.description,
                    agent_instruction: agent.identification?.instruction,
                }),
            });

            if (!response.ok || !response.body) {
                pushLines([{ kind: 'error', text: `HTTP error ${response.status}` }]);
                return;
            }

            const reader  = response.body.getReader();
            const decoder = new TextDecoder();
            let   buffer  = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const parts = buffer.split('\n');
                buffer = parts.pop() ?? '';
                for (const part of parts) {
                    const trimmedPart = part.trim();
                    if (!trimmedPart.startsWith('data:')) continue;
                    const data = trimmedPart.slice(5).trim();
                    if (data === '[DONE]') break;
                    let parsed: { text?: string; kind?: string; path?: string; content?: string } | undefined;
                    try { parsed = JSON.parse(data); } catch { continue; }

                    if (parsed?.kind === 'file_content') {
                        const path = parsed.path ?? apiFilePath;
                        const content = parsed.content ?? '';

                        setFileContent(content);
                        setActiveFile(path);
                        setFileError(null);
                        setFileLoading(false);
                        setActiveTab('code');
                        setFileList(prev => prev.includes(path) ? prev : [path, ...prev]);

                        generationSucceeded = true;

                        generatedContent = content;
                        continue;
                    }

                    if (!parsed?.text) continue;
                    const kind: TerminalLine['kind'] =
                        parsed.kind === 'success' ? 'success' :
                        parsed.kind === 'error'   ? 'error'   :
                        parsed.kind === 'command' ? 'command' :
                        parsed.kind === 'system'  ? 'system'  : 'output';
                    if (
                        kind === 'success' &&
                        (parsed.text.includes('Written:') || parsed.text.includes('Generated in editor only'))
                    ) {
                        generationSucceeded = true;
                    }
                    pushLines([{ kind, text: parsed.text }]);
                    scrollTerminal();
                }
            }
        } catch (err) {
            pushLines([{ kind: 'error', text: `Connection error: ${err}` }]);
        } finally {
            setRunning(false);
            scrollTerminal();
            refreshFileList();
            if (isGenerateCmd && generationSucceeded) {
                setActiveTab('code');
                if (generatedContent !== null) {
                    localStorage.setItem(storageKey, generatedContent);
                }
            }
        }
    };

    // ── Azure Foundry deploy ─────────────────────────────────────────────────
    const deployAgent = async () => {
        if (running || deploying || fileContent === null) return;

        setRunning(true);
        setDeploying(true);
        setActiveTab('terminal');

        // Slugify for Azure: alphanumeric + hyphens, max 63 chars, prefer human name over ID
        const azureName = (agent.name || agentId)
            .toLowerCase()
            .replace(/[^a-z0-9-]+/g, '-')
            .replace(/-{2,}/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 63);

        const systemPrompt = [
            `You are ${agent.name}.`,
            agent.identification?.role ?? '',
            agent.identification?.instruction ?? '',
        ].filter(Boolean).join('\n\n');

        pushLines([{ kind: 'command', text: `tavro@claude-support> /deploy-to-azure ${agentId}` }]);
        scrollTerminal();

        try {
            const response = await fetch(`${API_BASE}/api/v1/azure-deploy/stream`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    agent_name:       azureName,
                    code:             fileContent ?? '',
                    system_prompt:    systemPrompt,
                    model_deployment: 'gpt-4.1-mini',
                }),
            });

            if (!response.ok || !response.body) {
                pushLines([{ kind: 'error', text: `Deploy request failed (${response.status})` }]);
                return;
            }

            const reader  = response.body.getReader();
            const decoder = new TextDecoder();
            let   buffer  = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const parts = buffer.split('\n');
                buffer = parts.pop() ?? '';

                for (const part of parts) {
                    const trimmedPart = part.trim();
                    if (!trimmedPart.startsWith('data:')) continue;
                    const data = trimmedPart.slice(5).trim();
                    if (data === '[DONE]') break;

                    let parsed: Record<string, unknown> | undefined;
                    try { parsed = JSON.parse(data); } catch { continue; }
                    if (!parsed) continue;

                    if (parsed.kind === 'deploy_complete') {
                        pushLines([
                            { kind: 'success', text: `✓ Deployed to Azure Foundry (v${parsed.version})` },
                            { kind: 'output',  text: `Invoke URL: ${parsed.invoke_url}` },
                        ]);
                        scrollTerminal();
                        continue;
                    }

                    const text = (parsed.text as string) ?? '';
                    if (!text) continue;

                    const kind: TerminalLine['kind'] =
                        parsed.kind === 'success' ? 'success' :
                        parsed.kind === 'error'   ? 'error'   :
                        parsed.kind === 'system'  ? 'system'  : 'output';

                    pushLines([{ kind, text }]);
                    scrollTerminal();
                }
            }
        } catch (err) {
            pushLines([{ kind: 'error', text: `Deploy error: ${err}` }]);
        } finally {
            setRunning(false);
            setDeploying(false);
            scrollTerminal();
        }
    };

    // ── Style helpers ────────────────────────────────────────────────────────
    const lineClass = (kind: TerminalLine['kind']) => {
        switch (kind) {
            case 'command': return 'text-blue-300';
            case 'success': return 'text-emerald-300';
            case 'error':   return 'text-red-400';
            case 'system':  return 'text-violet-300';
            default:        return 'text-slate-300';
        }
    };

    // ── Render ───────────────────────────────────────────────────────────────
    return (
        <div className="flex flex-col rounded-xl border border-slate-200 shadow-sm overflow-hidden bg-slate-950" style={{ minHeight: 620 }}>

            {/* ── Top bar ── */}
            <div className="flex items-center justify-between px-4 py-2.5 bg-[#1e1e1e] border-b border-[#3c3c3c]">
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setSidebarOpen(o => !o)}
                        className="p-1 rounded hover:bg-[#3c3c3c] text-slate-400 hover:text-white transition-colors"
                        title="Toggle file explorer"
                    >
                        <FolderOpen size={15} />
                    </button>
                    <span className="text-[13px] font-semibold text-slate-200">Claude Support</span>
                    <span className="text-[11px] text-slate-500">— agentic coding for generated agents</span>
                </div>

                <div className="flex items-center gap-1.5">
                    <button
                        disabled={running}
                        onClick={() => runCommand(generateCommand)}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-bold bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                        <Sparkles size={11} /> Generate
                    </button>
                    <button
                        disabled={running}
                        onClick={() => {
                            setInput(`update ${apiFilePath}: `);
                            setActiveTab('terminal');
                            window.setTimeout(() => {
                                const el = inputRef.current;
                                if (!el) return;
                                el.focus();
                                el.setSelectionRange(el.value.length, el.value.length);
                            }, 30);
                        }}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-bold bg-[#3c3c3c] hover:bg-[#4c4c4c] text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                        <FileCode2 size={11} /> Update
                    </button>
                    <button
                        disabled={running || fileContent === null}
                        onClick={saveFile}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-bold bg-[#3c3c3c] hover:bg-[#4c4c4c] text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                        <FileCode2 size={11} /> Save
                    </button>
                    <span className="w-px h-4 bg-[#3c3c3c] mx-0.5 inline-block" />
                    <button
                        disabled={running || deploying || fileContent === null}
                        onClick={deployAgent}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-bold bg-emerald-700 hover:bg-emerald-600 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        title="Deploy as Azure Foundry hosted agent"
                    >
                        {deploying
                            ? <><Loader2 size={11} className="animate-spin" /> Deploying…</>
                            : <><Rocket size={11} /> Deploy</>
                        }
                    </button>
                </div>
            </div>

            {/* ── Body: sidebar + main ── */}
            <div className="flex flex-1 overflow-hidden" style={{ minHeight: 0 }}>

                {/* ── Sidebar: file explorer ── */}
                {sidebarOpen && (
                    <aside className="w-52 flex-shrink-0 bg-[#252526] border-r border-[#3c3c3c] flex flex-col overflow-hidden">
                        <div className="flex items-center justify-between px-3 py-2 border-b border-[#3c3c3c]">
                            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Explorer</span>
                            <button onClick={refreshFileList} className="p-0.5 rounded hover:bg-[#3c3c3c] text-slate-500 hover:text-slate-200 transition-colors">
                                <RefreshCw size={11} />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto py-1">
                            {fileList.map(path => (
                                <button
                                    key={path}
                                    onClick={() => loadFile(path)}
                                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-[12px] font-mono transition-colors ${
                                        activeFile === path && activeTab === 'code'
                                            ? 'bg-[#37373d] text-white'
                                            : 'text-slate-400 hover:text-slate-200 hover:bg-[#2a2d2e]'
                                    }`}
                                >
                                    <Code2 size={12} className="flex-shrink-0 text-blue-400" />
                                    <span className="truncate">{path}</span>
                                </button>
                            ))}
                        </div>
                    </aside>
                )}

                {/* ── Main panel ── */}
                <div className="flex flex-col flex-1 overflow-hidden">

                    {/* Tab bar */}
                    <div className="flex items-center bg-[#2d2d2d] border-b border-[#3c3c3c]">
                        <button
                            onClick={() => setActiveTab('code')}
                            className={`flex items-center gap-1.5 px-4 py-2 text-[12px] font-medium border-r border-[#3c3c3c] transition-colors ${
                                activeTab === 'code'
                                    ? 'bg-[#1e1e1e] text-white border-t-2 border-t-blue-500'
                                    : 'text-slate-400 hover:text-slate-200 hover:bg-[#3c3c3c]'
                            }`}
                        >
                            <Code2 size={12} />
                            {activeFile}
                        </button>
                        <button
                            onClick={() => setActiveTab('terminal')}
                            className={`flex items-center gap-1.5 px-4 py-2 text-[12px] font-medium border-r border-[#3c3c3c] transition-colors ${
                                activeTab === 'terminal'
                                    ? 'bg-[#1e1e1e] text-white border-t-2 border-t-blue-500'
                                    : 'text-slate-400 hover:text-slate-200 hover:bg-[#3c3c3c]'
                            }`}
                        >
                            <Terminal size={12} />
                            Terminal
                            {running && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
                        </button>

                        {activeTab === 'code' && (
                            <div className="flex items-center gap-1 px-3 ml-auto text-[11px] text-slate-300">
                                <span>{activeFile}</span>
                            </div>
                        )}
                        {activeTab === 'terminal' && (
                            <button
                                onClick={copyLog}
                                className="ml-auto flex items-center gap-1.5 px-3 py-1 text-[11px] text-slate-400 hover:text-white transition-colors"
                            >
                                {copied ? <Check size={11} className="text-emerald-400" /> : <Clipboard size={11} />}
                                {copied ? 'Copied' : 'Copy log'}
                            </button>
                        )}
                    </div>

                    {/* ── Code panel ── */}
                    {activeTab === 'code' && (
                        <div className="flex-1 overflow-hidden relative">
                            {fileLoading && (
                                <div className="absolute inset-0 flex items-center justify-center bg-[#1e1e1e] z-10">
                                    <Loader2 size={20} className="animate-spin text-blue-400" />
                                </div>
                            )}
                            {fileError && (
                                <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#1e1e1e] z-10 gap-3">
                                    <X size={28} className="text-slate-600" />
                                    <p className="text-slate-500 text-sm">File not found</p>
                                    <p className="text-slate-600 text-xs font-mono">{apiFilePath}</p>
                                    <button
                                        disabled={running}
                                        onClick={() => runCommand(generateCommand)}
                                        className="mt-2 flex items-center gap-2 px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold disabled:opacity-40 transition-colors"
                                    >
                                        <Sparkles size={12} /> Generate source code
                                    </button>
                                </div>
                            )}
                            {!fileLoading && !fileError && fileContent !== null && (
                                <Editor
                                    height="100%"
                                    language="python"
                                    theme="vs-dark"
                                    value={fileContent}
                                    onChange={(value) => setFileContent(value ?? '')}
                                    options={{
                                        readOnly: false,
                                        minimap: { enabled: true },
                                        fontSize: 13,
                                        lineNumbers: 'on',
                                        scrollBeyondLastLine: false,
                                        automaticLayout: true,
                                        wordWrap: 'off',
                                        renderLineHighlight: 'all',
                                        fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
                                        padding: { top: 12 },
                                    }}
                                />
                            )}
                            {!fileLoading && !fileError && fileContent === null && (
                                <div className="flex flex-col items-center justify-center h-full bg-[#1e1e1e] gap-3">
                                    <Code2 size={36} className="text-slate-700" />
                                    <p className="text-slate-500 text-sm">No source file loaded</p>
                                    <p className="text-slate-600 text-xs">Click a file in the explorer or Generate to create one</p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ── Terminal panel ── */}
                    {activeTab === 'terminal' && (
                        <div className="flex flex-col flex-1 overflow-hidden bg-[#1e1e1e]">
                            <div
                                ref={terminalRef}
                                className="flex-1 p-4 overflow-auto font-mono text-xs leading-relaxed"
                                style={{ minHeight: 0 }}
                            >
                                {lines.map(line => (
                                    <p key={line.id} className={`${lineClass(line.kind)} whitespace-pre-wrap break-words`}>
                                        {line.text}
                                    </p>
                                ))}
                                {running && <p className="text-slate-500 animate-pulse">▋</p>}
                            </div>

                            <form
                                className="flex items-center gap-3 px-4 py-3 border-t border-[#3c3c3c] bg-[#252526]"
                                onSubmit={e => { e.preventDefault(); runCommand(input); }}
                            >
                                <span className="text-emerald-400 font-mono text-xs flex-shrink-0">tavro@claude-support&gt;</span>
                                <input
                                    ref={inputRef}
                                    value={input}
                                    disabled={running}
                                    onChange={e => setInput(e.target.value)}
                                    className="flex-1 bg-transparent border-none outline-none text-slate-100 font-mono text-xs placeholder-slate-600 disabled:opacity-50"
                                    placeholder="/generate-agent-code · update <file>: … · claude &quot;…&quot;"
                                />
                                <button
                                    type="submit"
                                    disabled={running}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {running
                                        ? <><Loader2 size={11} className="animate-spin" /> Running</>
                                        : <><Play size={11} /> Run</>
                                    }
                                </button>
                            </form>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default AgentClaudeSupportTab;
