import React, { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Send, Bot, User, Loader2, MessageCircle, Settings2, Copy, Download, Check, FileText, Plus, X } from 'lucide-react';
import { mcpClient } from '../services/mcpClient';
import { LLMProvider, getProviderConfig, getActiveProvider, setActiveProvider, PROVIDER_LABELS } from '../services/llmService';
import { ChatMessage } from '../services/llmService';
import { useNavigate } from 'react-router-dom';
import { jsPDF } from 'jspdf';
import { useChatContext } from '../context/ChatContext';
import type { BlueprintContext } from '../context/ChatContext';
import { buildSystemPrompt, getSuggestedPrompts, getContextBadge } from '../services/buildSystemPrompt';
import { useBlueprint } from '../context/BlueprintContext';
import { useChatSessions } from '../context/ChatSessionContext';
import type { StoredMessage } from '../store/chatSessionStore';
import { useUseCases } from '../context/UseCaseContext';

interface Message {
    id: string;
    role: 'user' | 'assistant';
    text: string;
    timestamp: Date;
    streaming?: boolean;
}

export interface ChatPanelProps {
    onClose: () => void;
}

function getWelcomeText(model: string | null): string {
    if (model) return `Hi! I'm your Tavro AI Assistant, powered by **${model}**. I can help you analyze agents, create use cases, and generate risk assessments using the available MCP tools.`;
    return `Hi! I'm your Tavro AI Assistant. Ask me anything about your agents — risk levels, catalog details, configurations, and more.`;
}

function buildTranscript(messages: Message[], sessionTitle?: string, modelLabel?: string | null): string {
    const header = [
        sessionTitle ? `Session: ${sessionTitle}` : '',
        modelLabel ? `Model: ${modelLabel}` : '',
        `Exported: ${new Date().toLocaleString()}`,
    ].filter(Boolean).join('\n');

    const body = messages
        .filter(m => m.id !== 'welcome' && !m.streaming)
        .map(m => {
            const speaker = m.role === 'user' ? 'User' : 'Tavro AI Assistant';
            return `${speaker} (${m.timestamp.toLocaleString()}):\n${m.text}`;
        })
        .join('\n\n');

    return header ? `${header}\n\n---\n\n${body}` : body;
}

function saveTextAsPdf(title: string, text: string, filename: string): void {
    const doc = new jsPDF();
    const margin = 20;
    const pageHeight = doc.internal.pageSize.getHeight();
    const maxWidth = doc.internal.pageSize.getWidth() - margin * 2;
    let y = 20;
    doc.setFontSize(18);
    doc.text(title, margin, y);
    y += 10;
    doc.setFontSize(10);
    doc.text(`Generated on: ${new Date().toLocaleString()}`, margin, y);
    y += 10;
    doc.setLineWidth(0.5);
    doc.line(margin, y, margin + maxWidth, y);
    y += 10;
    doc.setFontSize(11);
    const lines = doc.splitTextToSize(text || 'No chat content available.', maxWidth);
    lines.forEach((line: string) => {
        if (y > pageHeight - margin) {
            doc.addPage();
            y = margin;
        }
        doc.text(line, margin, y);
        y += 6;
    });
    doc.save(filename);
}

// ── Export / download helpers ──────────────────────────────────────────────────

type ExportFormat = 'pdf' | 'csv' | 'xlsx' | 'json' | 'docx' | 'txt' | 'md';

const EXPORT_LABELS: Record<ExportFormat, string> = {
    pdf:  'PDF',
    csv:  'CSV file',
    xlsx: 'Excel file',
    json: 'JSON file',
    docx: 'Word document',
    txt:  'text file',
    md:   'Markdown file',
};

const EXPORT_INSTRUCTIONS: Record<ExportFormat, string> = {
    pdf:  '\n\nThe user wants the response as a downloadable PDF. Provide a comprehensive, well-structured answer with all relevant data.',
    csv:  '\n\nThe user wants tabular data as a CSV file. Use available tools to fetch the relevant data, then output it inside a ```csv code block with a proper header row.',
    xlsx: '\n\nThe user wants data as a spreadsheet. Use available tools to fetch the relevant data, then output it inside a ```csv code block with a proper header row (will be downloaded as an Excel-compatible file).',
    json: '\n\nThe user wants data as a JSON file. Use available tools to fetch the relevant data, then output it inside a ```json code block.',
    docx: '\n\nThe user wants the response as a Word document. Structure your response with clear headings (## for sections) and well-formatted paragraphs.',
    txt:  '\n\nThe user wants the response as a plain text file. Write clean, well-structured prose without markdown symbols.',
    md:   '\n\nThe user wants the response as a Markdown document. Use proper Markdown with headers, bullet lists, and code blocks where appropriate.',
};

/** Detect which download format (if any) the user is asking for. */
function detectExportFormat(text: string): ExportFormat | null {
    const msg = text.toLowerCase();
    const hasAction = ['generate', 'create', 'download', 'export', 'give', 'provide',
        'get', 'make', 'produce', 'output', 'save', 'report'].some(w => msg.includes(w));
    if (!hasAction) return null;

    if (msg.includes('docx') || (msg.includes('word') && (msg.includes('document') || msg.includes('file') || msg.includes('doc')))) return 'docx';
    if (msg.includes('excel') || msg.includes('xlsx') || msg.includes('.xls')) return 'xlsx';
    if (msg.includes('csv') || msg.includes('comma-separated') || msg.includes('comma separated')) return 'csv';
    if (msg.includes('json')) return 'json';
    if (msg.includes('markdown') || msg.includes('.md')) return 'md';
    if (msg.includes('.txt') || msg.includes('text file') || msg.includes('plain text')) return 'txt';
    if (msg.includes('pdf')) return 'pdf';
    return null;
}

function downloadBlob(content: string, filename: string, mimeType: string): void {
    const blob = new Blob([content], { type: mimeType });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/** Extract the first matching fenced code block from an LLM response. */
function extractCodeBlock(text: string, ...patterns: string[]): string | null {
    const pat = patterns.length ? patterns.join('|') : '[a-z]*';
    const m = text.match(new RegExp('```(?:' + pat + ')?\\n([\\s\\S]+?)\\n```', 'i'));
    return m ? m[1].trim() : null;
}

/** Wrap markdown content in a minimal HTML structure that Word can open. */
function markdownToWordHtml(text: string): string {
    const body = text
        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/^# (.+)$/gm, '<h1>$1</h1>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/_(.+?)_/g, '<em>$1</em>')
        .replace(/^\s*[-*]\s+(.+)$/gm, '<li>$1</li>')
        .replace(/\n\n/g, '</p><p>')
        .replace(/\n/g, '<br>');
    return `<html xmlns:o='urn:schemas-microsoft-com:office:office'
  xmlns:w='urn:schemas-microsoft-com:office:word'
  xmlns='http://www.w3.org/TR/REC-html40'>
<head><meta charset='utf-8'><title>Tavro AI Export</title></head>
<body><p>${body}</p></body></html>`;
}

/**
 * Trigger the appropriate file download for the given export format.
 * Returns true when a file was successfully created and downloaded.
 */
function handleExport(format: ExportFormat, content: string, title: string, basename: string): boolean {
    switch (format) {
        case 'pdf': {
            saveTextAsPdf(title, content, `${basename}.pdf`);
            return true;
        }
        case 'csv':
        case 'xlsx': {
            const data = extractCodeBlock(content, 'csv', 'tsv', 'text', 'plain');
            if (data && data.includes(',') && data.split('\n').length >= 2) {
                downloadBlob(data, `${basename}.csv`, 'text/csv;charset=utf-8;');
                return true;
            }
            return false;
        }
        case 'json': {
            const data = extractCodeBlock(content, 'json');
            if (data) {
                downloadBlob(data, `${basename}.json`, 'application/json');
                return true;
            }
            return false;
        }
        case 'md': {
            downloadBlob(content, `${basename}.md`, 'text/markdown;charset=utf-8;');
            return true;
        }
        case 'txt': {
            const plain = content
                .replace(/```[\s\S]*?```/g, '')
                .replace(/^#{1,6}\s+/gm, '')
                .replace(/[*_`]/g, '')
                .trim();
            downloadBlob(plain, `${basename}.txt`, 'text/plain;charset=utf-8;');
            return true;
        }
        case 'docx': {
            downloadBlob(markdownToWordHtml(content), `${basename}.doc`, 'application/msword');
            return true;
        }
        default:
            return false;
    }
}

/** @deprecated kept for any external callers — use detectExportFormat instead */
function isPdfRequest(text: string): boolean {
    return detectExportFormat(text) === 'pdf';
}

/** Render a line with **bold** and _italic_ support. */
function renderInline(line: string): React.ReactNode[] {
    const parts: React.ReactNode[] = [];
    const regex = /(\*\*(.+?)\*\*|_(.+?)_)/g;
    let last = 0; let m: RegExpExecArray | null; let key = 0;
    while ((m = regex.exec(line)) !== null) {
        if (m.index > last) parts.push(<span key={key++}>{line.slice(last, m.index)}</span>);
        if (m[0].startsWith('**')) parts.push(<strong key={key++} className="font-semibold">{m[2]}</strong>);
        else parts.push(<em key={key++} className="italic">{m[3]}</em>);
        last = m.index + m[0].length;
    }
    if (last < line.length) parts.push(<span key={key++}>{line.slice(last)}</span>);
    return parts;
}

/** Lightweight markdown renderer: bold, italic, bullet lines, blank lines. */
function renderMarkdown(text: string, isUser: boolean): React.ReactNode {
    if (isUser) return text;
    const lines = text.split('\n');
    return (
        <span>
            {lines.map((line, i) => {
                if (line.trim().startsWith('•') || line.trim().startsWith('-')) {
                    return (
                        <span key={i} className="flex gap-1.5 items-start">
                            <span className="mt-0.5 flex-shrink-0">•</span>
                            <span>{renderInline(line.replace(/^[\s•\-]+/, ''))}</span>{'\n'}
                        </span>
                    );
                }
                if (line === '') return <span key={i} className="block h-2" />;
                return <span key={i} className="block">{renderInline(line)}</span>;
            })}
        </span>
    );
}

/** Full markdown renderer using react-markdown + remark-gfm (tables, headers, code, etc.) */
const MarkdownContent: React.FC<{ text: string }> = ({ text }) => (
    <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
            p: ({ children }) => <p className="my-1 leading-relaxed">{children}</p>,
            h1: ({ children }) => <h1 className="text-base font-bold text-slate-900 mt-3 mb-1 border-b border-slate-200 pb-1">{children}</h1>,
            h2: ({ children }) => <h2 className="text-sm font-bold text-slate-800 mt-3 mb-1">{children}</h2>,
            h3: ({ children }) => <h3 className="text-sm font-semibold text-slate-700 mt-2 mb-1">{children}</h3>,
            strong: ({ children }) => <strong className="font-semibold text-slate-900">{children}</strong>,
            em: ({ children }) => <em className="italic text-slate-700">{children}</em>,
            ul: ({ children }) => <ul className="list-disc list-outside ml-4 space-y-0.5 my-1">{children}</ul>,
            ol: ({ children }) => <ol className="list-decimal list-outside ml-4 space-y-0.5 my-1">{children}</ol>,
            li: ({ children }) => <li className="text-slate-700 leading-relaxed">{children}</li>,
            blockquote: ({ children }) => (
                <blockquote className="border-l-2 border-blue-400 pl-3 text-slate-500 italic my-2">{children}</blockquote>
            ),
            hr: () => <hr className="my-3 border-slate-200" />,
            pre: ({ children }) => <>{children}</>,
            code({ children, className }) {
                if (className) {
                    return (
                        <pre className="bg-slate-800 text-slate-100 rounded-lg p-3 overflow-x-auto text-[11px] font-mono my-2 whitespace-pre">
                            <code className={className}>{children}</code>
                        </pre>
                    );
                }
                return (
                    <code className="bg-slate-100 text-slate-800 border border-slate-200 px-1 py-0.5 rounded text-[11px] font-mono">{children}</code>
                );
            },
            table: ({ children }) => (
                <div className="overflow-x-auto my-2 rounded-lg border border-slate-200">
                    <table className="min-w-full border-collapse text-xs">{children}</table>
                </div>
            ),
            thead: ({ children }) => <thead className="bg-slate-50 border-b border-slate-200">{children}</thead>,
            tbody: ({ children }) => <tbody className="divide-y divide-slate-100">{children}</tbody>,
            tr: ({ children }) => <tr className="hover:bg-slate-50 transition-colors">{children}</tr>,
            th: ({ children }) => (
                <th className="text-left px-3 py-2 font-semibold text-slate-700 text-[11px] uppercase tracking-wider whitespace-nowrap">{children}</th>
            ),
            td: ({ children }) => <td className="px-3 py-2 text-slate-600 leading-snug">{children}</td>,
            a: ({ children, href }) => (
                <a href={href} className="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer">{children}</a>
            ),
        }}
    >
        {text}
    </ReactMarkdown>
);

const TypingIndicator: React.FC = () => {
    const messages = [
        'Thinking…',
        'Analyzing your request…',
        'Gathering information…',
        'Formulating response…',
    ];
    const [idx, setIdx] = useState(0);

    useEffect(() => {
        const t = setInterval(() => setIdx(i => (i + 1) % messages.length), 2200);
        return () => clearInterval(t);
    }, []);

    return (
        <div className="flex items-end gap-2 mb-4">
            <div className="flex-shrink-0 w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center shadow-sm">
                <Bot size={14} className="text-white" />
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm">
                <div className="flex items-center gap-3">
                    <div className="text-sm text-slate-700 font-medium">{messages[idx]}</div>
                    <div className="flex items-center gap-1">
                        <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                </div>
            </div>
        </div>
    );
};

const ChatBubble: React.FC<{ message: Message; onDownloadPDF: (msg: Message) => void }> = ({ message, onDownloadPDF }) => {
    const isUser = message.role === 'user';
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        navigator.clipboard.writeText(message.text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className={`flex flex-col mb-4 ${isUser ? 'items-end' : 'items-start'}`}>
            <div className={`flex items-end gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
                <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center shadow-sm ${isUser ? 'bg-slate-700' : 'bg-blue-600'}`}>
                    {isUser ? <User size={14} className="text-white" /> : <Bot size={14} className="text-white" />}
                </div>
                <div className={`group relative max-w-[85%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed shadow-sm break-words ${isUser ? 'bg-blue-600 text-white rounded-br-sm' : 'bg-white border border-slate-200 text-slate-800 rounded-bl-sm'
                    }`}>
                    <MarkdownContent text={message.text} />
                    {message.streaming && (
                        <span className="inline-block w-0.5 h-3.5 bg-blue-500 ml-0.5 animate-pulse align-middle rounded" />
                    )}

                    {/* Floating Actions */}
                    {!message.streaming && (
                        <div className={`absolute top-0 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity p-1 ${isUser ? 'right-full mr-2' : 'left-full ml-2'}`}>
                            <button
                                onClick={handleCopy}
                                className="p-1.5 bg-white border border-slate-200 rounded-lg text-slate-400 hover:text-blue-600 hover:border-blue-200 transition-all shadow-sm"
                                title="Copy to clipboard"
                            >
                                {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                            </button>
                            {!isUser && (
                                <button
                                    onClick={() => onDownloadPDF(message)}
                                    className="p-1.5 bg-white border border-slate-200 rounded-lg text-slate-400 hover:text-blue-600 hover:border-blue-200 transition-all shadow-sm"
                                    title="Download as PDF"
                                >
                                    <Download size={12} />
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>
            <span className="text-[10px] text-slate-400 mt-1 px-9">
                {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
        </div>
    );
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function toStoredMessages(msgs: Message[]): StoredMessage[] {
    return msgs
        .filter(m => m.id !== 'welcome' && !m.streaming)
        .map(m => ({ id: m.id, role: m.role, text: m.text, timestamp: m.timestamp.toISOString() }));
}

function makeWelcome(model: string | null): Message {
    return { id: 'welcome', role: 'assistant', text: getWelcomeText(model), timestamp: new Date() };
}

function restoreMessages(stored: StoredMessage[], welcomeMsg: Message): Message[] {
    if (stored.length === 0) return [welcomeMsg];
    return [
        welcomeMsg,
        ...stored.map(m => ({ id: m.id, role: m.role, text: m.text, timestamp: new Date(m.timestamp) })),
    ];
}

/** Inline Chat panel — renders as h-full flex column, no fixed positioning. */
const ChatPanel: React.FC<ChatPanelProps> = ({ onClose }) => {
    const navigate = useNavigate();
    const { viewType, viewData } = useChatContext();
    const { activeCompany, nodes } = useBlueprint();
    const { sessions, activeSession, activeSessionId, createSession, switchSession, deleteSession, updateSessionMessages, updateSessionProvider } = useChatSessions();
    const { upsertUseCase, refresh: refreshUseCases } = useUseCases();
    const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

    const blueprintCtx: BlueprintContext | null = activeCompany ? {
        companyId: activeCompany.id,
        companyName: activeCompany.name,
        industry: activeCompany.industry,
        region: activeCompany.region,
        dimensions: nodes.slice(0, 30).map(n => ({
            label: n.label,
            category: n.category ?? 'custom',
            summary: n.summary?.slice(0, 120),
        })),
    } : null;

    // ── Provider state (per-session) ───────────────────────────────────────────
    const [activeProviderState, setActiveProviderState] = useState<LLMProvider | null>(
        activeSession?.selectedProvider ?? getActiveProvider()
    );
    const [configuredProviders, setConfiguredProviders] = useState<{ provider: LLMProvider; label: string }[]>([]);

    useEffect(() => {
        const providers: LLMProvider[] = ['openai', 'gemini', 'anthropic', 'copilot'];
        const configured = providers
            .map(p => ({ provider: p, cfg: getProviderConfig(p) }))
            .filter(x => x.cfg !== null)
            .map(x => ({
                provider: x.provider,
                label: `${PROVIDER_LABELS[x.provider]} · ${x.cfg!.model}`,
            }));
        setConfiguredProviders(configured);
    }, []);

    const llmCfg = activeProviderState ? getProviderConfig(activeProviderState) : null;
    const modelLabel = llmCfg
        ? `${PROVIDER_LABELS[llmCfg.provider]} · ${llmCfg.model}`
        : null;

    // ── Messages state (per-session) ───────────────────────────────────────────
    const welcome = makeWelcome(llmCfg?.model ?? null);

    const [messages, setMessages] = useState<Message[]>(() =>
        restoreMessages(activeSession?.messages ?? [], welcome)
    );
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [chatCopied, setChatCopied] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Track latest messages synchronously (avoids stale closure in async sendMessage)
    const latestMessages = useRef<Message[]>(messages);
    latestMessages.current = messages;

    // ── Reset when active session switches ─────────────────────────────────────
    useEffect(() => {
        const sessionProvider = activeSession?.selectedProvider ?? getActiveProvider();
        setActiveProviderState(sessionProvider);

        const sessionLlmCfg = sessionProvider ? getProviderConfig(sessionProvider) : null;
        const sessionWelcome = makeWelcome(sessionLlmCfg?.model ?? null);
        setMessages(restoreMessages(activeSession?.messages ?? [], sessionWelcome));
        setInput('');
        setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeSessionId]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, loading]);

    useEffect(() => {
        setTimeout(() => textareaRef.current?.focus(), 100);
    }, []);

    // ── Persist helpers ────────────────────────────────────────────────────────
    const persist = useCallback((msgs: Message[]) => {
        updateSessionMessages(toStoredMessages(msgs));
    }, [updateSessionMessages]);

    // ── Handlers ───────────────────────────────────────────────────────────────
    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setInput(e.target.value);
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            const newHeight = Math.min(textareaRef.current.scrollHeight, 240);
            textareaRef.current.style.height = `${newHeight}px`;
        }
    };

    const buildHistory = (msgs: Message[]): ChatMessage[] => {
        const filtered = msgs.filter(m => m.id !== 'welcome' && !m.streaming);
        // Drop trailing user messages — if the previous response failed, the history
        // would end with a user turn, and adding the new user message creates
        // consecutive user roles which Anthropic rejects with HTTP 400.
        let end = filtered.length;
        while (end > 0 && filtered[end - 1].role === 'user') end--;
        return filtered.slice(0, end).map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text } as ChatMessage));
    };

    const syncUseCaseFromAssistantResponse = useCallback((assistantText: string, userPrompt: string) => {
        const requestedCreateUseCase = /\b(create|add|register)\b[\s\S]{0,120}\b(ai\s+)?use\s*case\b/i.test(userPrompt);
        if (!requestedCreateUseCase) return;

        // Always refresh after a create-use-case request so catalog pills update
        // even when the assistant response format varies.
        refreshUseCases();

        const idMatch = assistantText.match(/Identifier:\s*([^\n\r]+)/i);
        const nameMatch = assistantText.match(/Name:\s*([^\n\r]+)/i);
        const statusMatch = assistantText.match(/Status:\s*([^\n\r]+)/i);

        const identifier = idMatch?.[1]?.trim();
        const name = nameMatch?.[1]?.trim();
        if (!identifier || !name) return;

        upsertUseCase({
            identifier,
            name,
            status: statusMatch?.[1]?.trim() || 'Proposed',
        });
    }, [refreshUseCases, upsertUseCase]);

    const copyConversation = () => {
        const transcript = buildTranscript(messages, activeSession?.title, modelLabel);
        navigator.clipboard.writeText(transcript || welcome.text);
        setChatCopied(true);
        setTimeout(() => setChatCopied(false), 2000);
    };

    const downloadConversationPdf = () => {
        const title = activeSession?.title ?? 'Tavro AI Assistant Chat';
        saveTextAsPdf(
            title,
            buildTranscript(messages, activeSession?.title, modelLabel),
            `tavro-chat-${Date.now()}.pdf`
        );
    };

    const handleDownloadMessagePDF = (msg: Message) => {
        saveTextAsPdf('Tavro AI Assistant Response', msg.text, `tavro-assistant-response-${Date.now()}.pdf`);
    };

    const sendMessage = async () => {
        const text = input.trim();
        if (!text || loading) return;

        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
        }

        const userMsg: Message = { id: `user-${Date.now()}`, role: 'user', text, timestamp: new Date() };
        const withUser = [...latestMessages.current, userMsg];
        setMessages(withUser);
        setInput('');
        setLoading(true);

        // Persist after adding user message
        persist(withUser);

        const assistantId = `assistant-${Date.now()}`;

        try {
            const exportFormat = detectExportFormat(text);
            const systemPrompt = buildSystemPrompt(viewType, viewData, blueprintCtx);
            // Append a format instruction so the LLM generates content in the
            // requested output format (CSV, JSON, DOCX, PDF, etc.).
            const effectiveSystemPrompt = exportFormat
                ? systemPrompt + EXPORT_INSTRUCTIONS[exportFormat]
                : systemPrompt;
            const stream = mcpClient.chat(text, buildHistory(latestMessages.current), { viewType, viewData, systemPrompt: effectiveSystemPrompt });
            let firstToken = true;
            let accumulated = '';

            for await (const token of stream) {
                accumulated += token;
                if (firstToken) {
                    firstToken = false;
                    setLoading(false);
                    setMessages(prev => {
                        const next = [...prev, { id: assistantId, role: 'assistant' as const, text: accumulated, timestamp: new Date(), streaming: true }];
                        latestMessages.current = next;
                        return next;
                    });
                } else {
                    setMessages(prev => {
                        const next = prev.map(m => m.id === assistantId ? { ...m, text: accumulated } : m);
                        latestMessages.current = next;
                        return next;
                    });
                }
            }

            // Trigger file download once streaming is finished (synchronous, before
            // setMessages so the download happens exactly once outside a React updater).
            let exportDownloaded = false;
            if (exportFormat && accumulated.trim()) {
                exportDownloaded = handleExport(
                    exportFormat,
                    accumulated,
                    activeSession?.title ?? 'Tavro AI Response',
                    `tavro-export-${Date.now()}`,
                );
                if (exportDownloaded) {
                    accumulated += `\n\n---\n*Your ${EXPORT_LABELS[exportFormat]} has been downloaded.*`;
                }
            }

            // Streaming complete — finalize and persist.
            // Use a functional update so we always operate on the actual current
            // state, not the potentially-stale latestMessages ref. When the
            // orchestrator yields the whole response as one chunk (complete() path),
            // the loop runs once and ends immediately — React may not have flushed
            // the earlier functional setMessages that added the streaming placeholder,
            // so latestMessages.current can be stale. A direct setMessages(array)
            // computed from the stale ref would overwrite the pending update.
            setMessages(prev => {
                let next: Message[];
                if (accumulated.trim()) {
                    const hasPlaceholder = prev.some(m => m.id === assistantId);
                    next = hasPlaceholder
                        ? prev.map(m => m.id === assistantId ? { ...m, text: accumulated, streaming: false } : m)
                        : [...prev, { id: assistantId, role: 'assistant' as const, text: accumulated, timestamp: new Date(), streaming: false }];
                } else {
                    next = [
                        ...prev.filter(m => m.id !== assistantId),
                        { id: `err-${Date.now()}`, role: 'assistant' as const, text: 'I did not receive a response from the configured LLM. Please check the Copilot SDK proxy logs and token configuration.', timestamp: new Date() },
                    ];
                }
                latestMessages.current = next;
                persist(next);
                return next;
            });

            if (accumulated.trim()) {
                syncUseCaseFromAssistantResponse(accumulated, text);
            }

        } catch (err: any) {
            const errMsg: Message = {
                id: `err-${Date.now()}`,
                role: 'assistant',
                text: `Something went wrong: ${err?.message ?? 'unknown error'}. Please try again.`,
                timestamp: new Date(),
            };
            const withErr = [...latestMessages.current, errMsg];
            setMessages(withErr);
            persist(withErr);
        } finally {
            setLoading(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    };

    const sortedSessions = [...sessions].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );

    const handleDeleteTab = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (confirmDelete === id) {
            deleteSession(id);
            setConfirmDelete(null);
        } else {
            setConfirmDelete(id);
            setTimeout(() => setConfirmDelete(prev => (prev === id ? null : prev)), 2500);
        }
    };

    return (
        <div className="flex flex-col h-full bg-slate-50 min-w-0 flex-1">

            {/* ── Session Tabs ─────────────────────────────────────────────── */}
            <div className="flex items-center bg-white border-b border-slate-200 flex-shrink-0 overflow-hidden">
                <div className="flex items-center flex-1 overflow-x-auto scrollbar-none min-w-0">
                    {sortedSessions.map(session => {
                        const isActive = session.id === activeSessionId;
                        const isConfirming = confirmDelete === session.id;
                        return (
                            <button
                                key={session.id}
                                onClick={() => { switchSession(session.id); setConfirmDelete(null); }}
                                className={`group flex items-center gap-1.5 px-3 py-2 text-[11px] font-medium whitespace-nowrap border-r border-slate-100 flex-shrink-0 transition-colors ${
                                    isActive
                                        ? 'bg-blue-50 text-blue-700 border-b-2 border-b-blue-500'
                                        : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                                }`}
                                style={{ maxWidth: '140px' }}
                                title={session.title}
                            >
                                <span className="truncate max-w-[90px]">{session.title}</span>
                                <span
                                    onClick={(e) => handleDeleteTab(e, session.id)}
                                    className={`flex-shrink-0 rounded p-0.5 transition-colors ${
                                        isConfirming
                                            ? 'text-red-500 bg-red-50'
                                            : isActive
                                                ? 'text-blue-400 hover:text-red-500 hover:bg-red-50'
                                                : 'text-slate-300 group-hover:text-slate-400 hover:text-red-500 hover:bg-red-50'
                                    }`}
                                    title={isConfirming ? 'Click again to delete' : 'Delete session'}
                                    role="button"
                                >
                                    <X size={10} />
                                </span>
                            </button>
                        );
                    })}
                </div>
                {/* New session button */}
                <button
                    onClick={createSession}
                    className="flex-shrink-0 flex items-center gap-1 px-3 py-2 text-[11px] font-semibold text-slate-500 hover:text-blue-600 hover:bg-blue-50 transition-colors border-l border-slate-100"
                    title="New session"
                >
                    <Plus size={12} />
                    <span className="hidden sm:inline">New</span>
                </button>
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-slate-200 flex-shrink-0">
                <div className="flex items-center gap-2.5 min-w-0">
                    <div className="bg-blue-600 text-white p-1.5 rounded-lg shadow-sm flex-shrink-0">
                        <MessageCircle size={14} />
                    </div>
                    <div className="min-w-0">
                        <h2 className="font-semibold text-slate-800 text-sm leading-tight truncate">Tavro AI Assistant</h2>
                        {getContextBadge(viewType, viewData) && (
                            <span className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 px-1.5 py-0.5 rounded-full leading-tight mt-0.5">
                                {getContextBadge(viewType, viewData)}
                            </span>
                        )}
                        {configuredProviders.length > 0 ? (
                            <select
                                value={activeProviderState || ''}
                                onChange={(e) => {
                                    const p = e.target.value as LLMProvider;
                                    setActiveProvider(p);
                                    setActiveProviderState(p);
                                    updateSessionProvider(p);
                                }}
                                className="text-[10px] text-slate-500 bg-transparent outline-none cursor-pointer hover:text-slate-700 leading-tight -ml-0.5 mt-0.5"
                                title="Select active model"
                            >
                                {configuredProviders.map(cp => (
                                    <option key={cp.provider} value={cp.provider}>{cp.label}</option>
                                ))}
                            </select>
                        ) : (
                            <p className="text-[10px] text-slate-400 leading-tight">
                                Powered by MCP Server
                            </p>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                        onClick={copyConversation}
                        className="p-2 rounded-lg border border-slate-200 text-slate-400 hover:text-blue-600 hover:border-blue-200 transition-all"
                        title="Copy chat"
                    >
                        {chatCopied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                    </button>
                    <button
                        onClick={downloadConversationPdf}
                        className="p-2 rounded-lg border border-slate-200 text-slate-400 hover:text-blue-600 hover:border-blue-200 transition-all"
                        title="Download session as PDF"
                    >
                        <FileText size={14} />
                    </button>
                </div>
            </div>

            {/* No-LLM nudge */}
            {!llmCfg && (
                <div className="mx-3 mt-3 bg-violet-50 border border-violet-100 rounded-xl p-3 flex items-start gap-2.5 text-xs text-violet-700 flex-shrink-0">
                    <Settings2 size={13} className="mt-0.5 shrink-0" />
                    <span>
                        Configure an LLM in{' '}
                        <button onClick={() => { onClose(); navigate('/settings'); }} className="font-bold underline hover:text-violet-900">
                            Settings
                        </button>
                        {' '}to unlock intelligent answers.
                    </span>
                </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
                {messages.map(msg => (
                    <ChatBubble key={msg.id} message={msg} onDownloadPDF={handleDownloadMessagePDF} />
                ))}
                {loading && <TypingIndicator />}
                <div ref={messagesEndRef} />
            </div>

            {/* Suggested prompts */}
            {messages.length === 1 && (
                <div className="px-3 pb-2 flex flex-col gap-1.5 flex-shrink-0">
                    <p className="text-[11px] text-slate-400 font-medium uppercase tracking-wider px-1 mb-1">Suggested</p>
                    {getSuggestedPrompts(viewType, viewData).map(prompt => (
                        <button
                            key={prompt}
                            onClick={() => { setInput(prompt); textareaRef.current?.focus(); }}
                            className="text-left text-xs text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-xl px-3 py-2 transition-colors"
                        >
                            {prompt}
                        </button>
                    ))}
                </div>
            )}

            {/* Input Row */}
            <div className="flex items-end gap-2 px-3 py-3 bg-white border-t border-slate-200 flex-shrink-0">
                <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    placeholder={
                        viewType === 'blueprint' ? 'Ask about your company blueprint…' :
                            viewType === 'agent_detail' ? 'Ask about this agent…' :
                                viewType === 'use_case_detail' ? 'Ask about this use case…' :
                                    viewType === 'agent_catalog' ? 'Ask about your agents…' :
                                        viewType === 'use_case_catalog' ? 'Ask about your use cases…' :
                                            'Ask Tavro AI anything…'
                    }
                    disabled={loading}
                    className="flex-1 text-sm bg-slate-50 border border-slate-200 rounded-xl px-3 py-3 outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all placeholder:text-slate-400 disabled:opacity-60 resize-none overflow-y-auto"
                    style={{ minHeight: '60px', maxHeight: '240px' }}
                />
                <button
                    onClick={sendMessage}
                    disabled={!input.trim() || loading}
                    className="flex-shrink-0 w-9 h-9 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 text-white rounded-xl flex items-center justify-center transition-colors shadow-sm disabled:shadow-none"
                    title="Send message"
                >
                    {loading ? <Loader2 size={15} className="animate-spin" /> : <Send size={14} />}
                </button>
            </div>
        </div>
    );
};

export default ChatPanel;
