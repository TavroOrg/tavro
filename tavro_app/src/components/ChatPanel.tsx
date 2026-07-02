import React, { useState, useRef, useEffect, useCallback } from 'react';
import { toUserMessage } from '../utils/errorUtils';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Send, Bot, User, Loader2, MessageCircle, Settings2, Copy, Download, Check, FileText, Plus, X, Paperclip, AlertCircle } from 'lucide-react';
import {
    uploadChatAttachment, extractAttachmentText, formatAttachmentSize, attachmentDownloadUrl,
    ACCEPTED_MIME_TYPES, MAX_ATTACHMENT_SIZE_MB, MAX_ATTACHMENTS_PER_MESSAGE,
} from '../services/chatAttachmentService';
import type { AttachmentRef } from '../store/chatSessionStore';
import { mcpClient } from '../services/mcpClient';
import { LLMProvider, getProviderConfig, getActiveProvider, setActiveProvider, PROVIDER_LABELS } from '../services/llmService';
import { ChatMessage } from '../services/llmService';
import { useNavigate } from 'react-router-dom';
import { generateMarkdownPdf, isPdfExportRequest, extractPdfBody, extractPdfTitle } from '../utils/pdfGenerator';
import { PDF_DOCUMENT_TEMPLATE } from '../utils/pdfTemplate';
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
    type?: 'status';
    statusPhase?: 'processing' | 'ready';
    agentName?: string;
    attachments?: AttachmentRef[];
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
        .filter(m => m.id !== 'welcome' && !m.streaming && m.type !== 'status')
        .map(m => {
            const speaker = m.role === 'user' ? 'User' : 'Tavro AI Assistant';
            return `${speaker} (${m.timestamp.toLocaleString()}):\n${m.text}`;
        })
        .join('\n\n');

    return header ? `${header}\n\n---\n\n${body}` : body;
}

function saveTextAsPdf(title: string, text: string, filename: string, docType?: string): void {
    generateMarkdownPdf(title, text, filename, docType);
}

function getAssistantPdfHeaderName(): string {
    return 'User Conversation Request';
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
    pdf:  '\n\n[PDF EXPORT]\nRespond with ONLY the report content — no preamble, no closing remarks.\nRules:\n1. Begin immediately with a # heading that names the report topic (e.g. "# Critical Data Elements - TAVAC0004582"). Do NOT start with "Here is", "Sure,", "I\'ll generate", or any acknowledgement.\n2. Use ## for sections, **bold** for key terms, - for bullets, | markdown tables | for tabular data.\n3. Do NOT add any closing sentence ("Your PDF...", "I hope...", "Let me know...").\n4. ASCII only — no emojis, no Unicode symbols.\nThe platform extracts your response verbatim and converts it to PDF.',
    csv:  '\n\nThe user wants tabular data as a CSV file. Use available tools to fetch the relevant data, then output it inside a ```csv code block with a proper header row.',
    xlsx: '\n\nThe user wants data as a spreadsheet. Use available tools to fetch the relevant data, then output it inside a ```csv code block with a proper header row (will be downloaded as an Excel-compatible file).',
    json: '\n\nThe user wants data as a JSON file. Use available tools to fetch the relevant data, then output it inside a ```json code block.',
    docx: '\n\nThe user wants the response as a Word document. Structure your response with clear headings (## for sections) and well-formatted paragraphs.',
    txt:  '\n\nThe user wants the response as a plain text file. Write clean, well-structured prose without markdown symbols.',
    md:   '\n\nThe user wants the response as a Markdown document. Use proper Markdown with headers, bullet lists, and code blocks where appropriate.',
};

EXPORT_INSTRUCTIONS.pdf = `\n\n${PDF_DOCUMENT_TEMPLATE}\n\n[PDF EXPORT]\nRespond with ONLY the report content following the template above. Use the General Report template unless the user asks for a known document type such as Requirements, Technical Design, or Risk Assessment. Start directly with a single # title. Use clean markdown, ASCII only. Do not include preamble, completion notes, sign-off text, or unreplaced {{...}} placeholders. The platform extracts your response verbatim and converts it to PDF.`;

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
function handleExport(format: ExportFormat, content: string, title: string, basename: string, userRequest?: string): boolean {
    switch (format) {
        case 'pdf': {
            const body = extractPdfBody(content);
            if (!body.trim()) return false;
            const name = userRequest ? getAssistantPdfHeaderName() : extractPdfTitle(body, title);
            generateMarkdownPdf(name, body, `${basename}.pdf`, 'Summary');
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

const AgentStatusCard: React.FC<{ message: Message }> = ({ message }) => {
    const isProcessing = message.statusPhase === 'processing';
    const name = message.agentName || 'Agent';

    return (
        <div className="flex items-start gap-2 mb-4">
            <div className="flex-shrink-0 w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center shadow-sm">
                <Bot size={14} className="text-white" />
            </div>
            <div className={`flex items-start gap-3 px-4 py-3 rounded-2xl rounded-bl-sm border shadow-sm text-sm max-w-[85%] ${
                isProcessing
                    ? 'bg-blue-50 border-blue-200 text-blue-800'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-800'
            }`}>
                {isProcessing ? (
                    <Loader2 size={15} className="mt-0.5 flex-shrink-0 text-blue-500 animate-spin" />
                ) : (
                    <Paperclip size={15} className="mt-0.5 flex-shrink-0 text-emerald-600" />
                )}
                <div className="leading-snug">
                    {isProcessing ? (
                        <>
                            <span className="font-semibold">{name}</span> has been created.{' '}
                            Risk assessment and artifact generation are in progress&hellip;
                        </>
                    ) : (
                        <>
                            Artifacts for <span className="font-semibold">{name}</span> are ready.{' '}
                            Check the <span className="font-semibold">Attachments</span> tab on the agent to view them.
                        </>
                    )}
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
            {/* Attachment chips above the bubble for user messages */}
            {isUser && message.attachments && message.attachments.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-1 max-w-[85%] justify-end">
                    {message.attachments.map((att, i) => (
                        <a
                            key={i}
                            href={attachmentDownloadUrl(att)}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={`${att.name} (${formatAttachmentSize(att.size)})`}
                            className="flex items-center gap-1 text-[10px] font-medium bg-blue-100 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full hover:bg-blue-200 transition-colors"
                        >
                            <Paperclip size={9} />
                            <span className="truncate max-w-[120px]">{att.name}</span>
                            <span className="opacity-60">{formatAttachmentSize(att.size)}</span>
                        </a>
                    ))}
                </div>
            )}
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

// ── Pending-request helpers ────────────────────────────────────────────────────

const LS_PENDING_REQUEST = 'tavro_pending_ai_request';
const PENDING_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface PendingRequest {
    requestId: string;
    sessionId: string;
    userMessage: string;
    timestamp: number;
}

function generateRequestId(): string {
    return `req-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function savePendingRequest(info: PendingRequest): void {
    try { localStorage.setItem(LS_PENDING_REQUEST, JSON.stringify(info)); } catch { /* quota */ }
}

function clearPendingRequest(): void {
    try { localStorage.removeItem(LS_PENDING_REQUEST); } catch {}
}

function loadPendingRequest(): PendingRequest | null {
    try {
        const raw = localStorage.getItem(LS_PENDING_REQUEST);
        if (!raw) return null;
        const p = JSON.parse(raw) as PendingRequest;
        if (!p.requestId || !p.userMessage || !p.sessionId) { clearPendingRequest(); return null; }
        if (Date.now() - p.timestamp > PENDING_TTL_MS) { clearPendingRequest(); return null; }
        return p;
    } catch { clearPendingRequest(); return null; }
}

/** Consume a /chat/resume/:requestId SSE response as an async token generator. */
async function* resumeFromServer(requestId: string): AsyncGenerator<string> {
    const res = await fetch(`/copilot-api/chat/resume/${requestId}`);
    if (!res.ok) throw new Error('not_found');
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const data = trimmed.slice(5).trim();
            if (data === '[DONE]') return;
            try {
                const parsed = JSON.parse(data);
                if (parsed?.error) throw new Error(typeof parsed.error === 'string' ? parsed.error : JSON.stringify(parsed.error));
                if (parsed?.delta) yield parsed.delta as string;
            } catch (e: any) {
                if (e?.message && e.message !== 'not_found') throw e;
            }
        }
    }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function toStoredMessages(msgs: Message[]): StoredMessage[] {
    return msgs
        .filter(m => m.id !== 'welcome' && !m.streaming && m.type !== 'status')
        .map(m => ({
            id: m.id,
            role: m.role,
            text: m.text,
            timestamp: m.timestamp.toISOString(),
            ...(m.attachments?.length ? { attachments: m.attachments } : {}),
        }));
}

function makeWelcome(model: string | null): Message {
    return { id: 'welcome', role: 'assistant', text: getWelcomeText(model), timestamp: new Date() };
}

function restoreMessages(stored: StoredMessage[], welcomeMsg: Message): Message[] {
    if (stored.length === 0) return [welcomeMsg];
    return [
        welcomeMsg,
        ...stored.map(m => ({
            id: m.id,
            role: m.role,
            text: m.text,
            timestamp: new Date(m.timestamp),
            ...(m.attachments?.length ? { attachments: m.attachments } : {}),
        })),
    ];
}

/** Inline Chat panel — renders as h-full flex column, no fixed positioning. */
const ChatPanel: React.FC<ChatPanelProps> = ({ onClose }) => {
    const navigate = useNavigate();
    const { viewType, viewData } = useChatContext();
    const { activeCompany, nodes, graph } = useBlueprint();
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
        edges: graph ? (() => {
            const nodeMap = new Map(graph.nodes.map(n => [n.id, n.label]));
            return graph.edges.slice(0, 50).map(e => ({
                sourceLabel: nodeMap.get(e.source) ?? e.source,
                targetLabel: nodeMap.get(e.target) ?? e.target,
                relType: e.rel_type,
            }));
        })() : undefined,
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

    // ── Attachment state ───────────────────────────────────────────────────────
    const [pendingAttachments, setPendingAttachments] = useState<AttachmentRef[]>([]);
    const [attachmentUploading, setAttachmentUploading] = useState(false);
    const [attachmentError, setAttachmentError] = useState<string | null>(null);
    const attachInputRef = useRef<HTMLInputElement>(null);

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
        setPendingAttachments([]);
        setAttachmentError(null);
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

    // ── Agent creation / artifact status cards ────────────────────────────────
    useEffect(() => {
        const onAgentCreated = (event: Event) => {
            const { result, args, source } = (event as CustomEvent).detail ?? {};
            if (source === 'spark') return;
            const agentId: string =
                result?.agent_id ||
                result?.identification?.agent_id ||
                result?.agent_card?.agent_id ||
                result?.agent_card?.identification?.agent_id ||
                '';
            const agentName: string =
                args?.agent_name || result?.agent_name || result?.name || agentId || 'Agent';
            if (!agentId && !agentName) return;

            const statusId = `status-${agentId || agentName}`;
            const statusMsg: Message = {
                id: statusId,
                role: 'assistant',
                text: '',
                timestamp: new Date(),
                type: 'status',
                statusPhase: 'processing',
                agentName,
            };
            setMessages(prev => {
                if (prev.some(m => m.id === statusId)) return prev;
                const next = [...prev, statusMsg];
                latestMessages.current = next;
                return next;
            });
        };

        const onArtifactsGenerated = (event: Event) => {
            const { args } = (event as CustomEvent).detail ?? {};
            const agentName: string = args?.agent_name || 'Agent';
            const agentId: string = args?.agent_id || agentName;
            const statusId = `status-${agentId || agentName}`;

            // Remove the processing card — the portal notification takes over
            setMessages(prev => {
                const next = prev.filter(m => m.id !== statusId);
                latestMessages.current = next;
                return next;
            });
        };

        window.addEventListener('tavro:agent-created', onAgentCreated);
        window.addEventListener('tavro:agent-artifacts-generated', onArtifactsGenerated);
        return () => {
            window.removeEventListener('tavro:agent-created', onAgentCreated);
            window.removeEventListener('tavro:agent-artifacts-generated', onArtifactsGenerated);
        };
    }, []);

    // ── Resume interrupted AI response after page refresh or tab switch ────────
    // Runs once per session change. If localStorage has a pending request for the
    // active session whose last persisted message is still a user turn (i.e., no
    // assistant response was saved before the disconnect), we try to:
    //   1. Reconnect to the server cache via GET /chat/resume/:requestId, OR
    //   2. Re-run the original user message through mcpClient.chat() as fallback.
    useEffect(() => {
        const pending = loadPendingRequest();
        if (!pending || pending.sessionId !== activeSessionId) return;

        // Check whether the response was already saved before the disconnect.
        // activeSession.messages reflects the last-persisted state.
        const stored = activeSession?.messages ?? [];
        const lastStored = stored[stored.length - 1];
        if (lastStored?.role !== 'user') {
            // Response already exists — just clean up the pending flag.
            clearPendingRequest();
            return;
        }

        const { requestId, userMessage } = pending;

        const doResume = async () => {
            setLoading(true);
            const assistantId = `assistant-resume-${Date.now()}`;

            const streamTokens = async (gen: AsyncGenerator<string>) => {
                let accumulated = '';
                let firstToken = true;
                for await (const token of gen) {
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
                return accumulated;
            };

            try {
                let accumulated = '';

                // Try server-side cache first (works for all proxy-routed providers).
                try {
                    accumulated = await streamTokens(resumeFromServer(requestId));
                } catch {
                    // Cache miss (server restarted, TTL expired, or the original call
                    // used a direct browser fetch that was cancelled on refresh).
                    // Re-run the request using the persisted conversation history.
                    const currentHistory = buildHistory(latestMessages.current);
                    accumulated = await streamTokens(
                        mcpClient.chat(userMessage, currentHistory, { viewType, viewData })
                    );
                }

                setMessages(prev => {
                    let next: Message[];
                    if (accumulated.trim()) {
                        const hasPlaceholder = prev.some(m => m.id === assistantId);
                        next = hasPlaceholder
                            ? prev.map(m => m.id === assistantId ? { ...m, text: accumulated, streaming: false } : m)
                            : [...prev, { id: assistantId, role: 'assistant' as const, text: accumulated, timestamp: new Date(), streaming: false }];
                    } else {
                        next = [...prev.filter(m => m.id !== assistantId),
                            { id: `err-${Date.now()}`, role: 'assistant' as const, text: 'Reconnection returned no response. Please try again.', timestamp: new Date() }];
                    }
                    latestMessages.current = next;
                    persist(next);
                    return next;
                });
            } catch (err: any) {
                setMessages(prev => {
                    const next = [...prev.filter(m => m.id !== assistantId),
                        { id: `err-${Date.now()}`, role: 'assistant' as const, text: `Reconnection failed: ${toUserMessage(err)}`, timestamp: new Date() }];
                    latestMessages.current = next;
                    persist(next);
                    return next;
                });
            } finally {
                setLoading(false);
                clearPendingRequest();
            }
        };

        doResume();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeSessionId]);

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
        const filtered = msgs.filter(m => m.id !== 'welcome' && !m.streaming && m.type !== 'status');
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
        const title = getAssistantPdfHeaderName();
        saveTextAsPdf(
            title,
            buildTranscript(messages, activeSession?.title, modelLabel),
            `tavro-chat-${Date.now()}.pdf`,
            'Summary',
        );
    };

    const handleDownloadMessagePDF = (msg: Message) => {
        const body = extractPdfBody(msg.text);
        const msgIndex = messages.findIndex(m => m.id === msg.id);
        const prevUserMsg = messages.slice(0, msgIndex).reverse().find(m => m.role === 'user');
        const name = prevUserMsg ? getAssistantPdfHeaderName() : 'Tavro AI Assistant Response';
        generateMarkdownPdf(name, body, `tavro-assistant-response-${Date.now()}.pdf`, 'Summary');
    };

    const handleAttachFiles = async (files: FileList) => {
        setAttachmentError(null);
        const remaining = MAX_ATTACHMENTS_PER_MESSAGE - pendingAttachments.length;
        if (remaining <= 0) {
            setAttachmentError(`Maximum ${MAX_ATTACHMENTS_PER_MESSAGE} attachments per message`);
            return;
        }
        const toAdd = Array.from(files).slice(0, remaining);
        const oversized = toAdd.filter(f => f.size > MAX_ATTACHMENT_SIZE_MB * 1024 * 1024);
        if (oversized.length) {
            setAttachmentError(`Files must be under ${MAX_ATTACHMENT_SIZE_MB}MB: ${oversized.map(f => f.name).join(', ')}`);
            return;
        }
        setAttachmentUploading(true);
        try {
            const refs = await Promise.all(toAdd.map(uploadChatAttachment));
            setPendingAttachments(prev => [...prev, ...refs]);
        } catch (err: any) {
            setAttachmentError(toUserMessage(err));
        } finally {
            setAttachmentUploading(false);
            if (attachInputRef.current) attachInputRef.current.value = '';
        }
    };

    const sendMessage = async () => {
        const text = input.trim();
        if ((!text && pendingAttachments.length === 0) || loading || attachmentUploading) return;

        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
        }

        // Snapshot and clear pending attachments before going async
        const attsSnapshot = [...pendingAttachments];
        setPendingAttachments([]);
        setAttachmentError(null);

        // Show the user message and lock the input immediately — before any
        // async work — so there is no window where the send button re-enables
        // and the user can accidentally trigger a second send.
        const userMsg: Message = {
            id: `user-${Date.now()}`,
            role: 'user',
            text: text || `[${attsSnapshot.map(a => a.name).join(', ')}]`,
            timestamp: new Date(),
            ...(attsSnapshot.length ? { attachments: attsSnapshot } : {}),
        };
        const withUser = [...latestMessages.current, userMsg];
        setMessages(withUser);
        setInput('');
        setLoading(true);
        persist(withUser);

        // Build the effective message text sent to the LLM.
        // Attachment text is prepended as context; the user's typed text follows.
        let effectiveText = text;
        if (attsSnapshot.length > 0) {
            const extracts = await Promise.all(attsSnapshot.map(extractAttachmentText));
            const attachContext = attsSnapshot
                .map((att, i) => `[Attached file: ${att.name}]\n${extracts[i]}`)
                .join('\n\n---\n\n');
            effectiveText = attachContext + (text ? `\n\n---\n\n${text}` : '');
        }

        const requestId = generateRequestId();
        savePendingRequest({ requestId, sessionId: activeSessionId ?? '', userMessage: text, timestamp: Date.now() });

        const assistantId = `assistant-${Date.now()}`;

        try {
            const exportFormat = detectExportFormat(text);
            const systemPrompt = buildSystemPrompt(viewType, viewData, blueprintCtx);
            // Append a format instruction so the LLM generates content in the
            // requested output format (CSV, JSON, DOCX, PDF, etc.).
            const effectiveSystemPrompt = exportFormat
                ? systemPrompt + EXPORT_INSTRUCTIONS[exportFormat]
                : systemPrompt;
            const stream = mcpClient.chat(effectiveText, buildHistory(latestMessages.current), { viewType, viewData, systemPrompt: effectiveSystemPrompt, blueprintData: blueprintCtx }, requestId);
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
                    text,
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
                text: `Something went wrong: ${toUserMessage(err)}`,
                timestamp: new Date(),
            };
            const withErr = [...latestMessages.current, errMsg];
            setMessages(withErr);
            persist(withErr);
        } finally {
            setLoading(false);
            clearPendingRequest();
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!attachmentUploading) sendMessage(); }
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
                {messages.map(msg =>
                    msg.type === 'status'
                        ? <AgentStatusCard key={msg.id} message={msg} />
                        : <ChatBubble key={msg.id} message={msg} onDownloadPDF={handleDownloadMessagePDF} />
                )}
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

            {/* Input area with attachment support */}
            <div className="flex-shrink-0 bg-white border-t border-slate-200">

                {/* Pending attachment chips */}
                {(pendingAttachments.length > 0 || attachmentError) && (
                    <div className="px-3 pt-2 flex flex-col gap-1">
                        {pendingAttachments.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                                {pendingAttachments.map((att, i) => (
                                    <div
                                        key={i}
                                        className="flex items-center gap-1.5 text-[11px] font-medium bg-slate-100 border border-slate-200 text-slate-700 px-2 py-1 rounded-lg"
                                    >
                                        <Paperclip size={10} className="text-slate-400 flex-shrink-0" />
                                        <span className="truncate max-w-[130px]">{att.name}</span>
                                        <span className="text-[9px] text-slate-400">{formatAttachmentSize(att.size)}</span>
                                        <button
                                            onClick={() => setPendingAttachments(prev => prev.filter((_, idx) => idx !== i))}
                                            className="ml-0.5 text-slate-400 hover:text-red-500 transition-colors flex-shrink-0"
                                            title="Remove"
                                        >
                                            <X size={10} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                        {attachmentError && (
                            <div className="flex items-center gap-1.5 text-[11px] text-rose-600">
                                <AlertCircle size={11} /> {attachmentError}
                            </div>
                        )}
                    </div>
                )}

                {/* Input Row */}
                <div className="flex items-end gap-2 px-3 py-3">
                    {/* Hidden file input */}
                    <input
                        ref={attachInputRef}
                        type="file"
                        multiple
                        accept={ACCEPTED_MIME_TYPES}
                        className="hidden"
                        onChange={e => e.target.files && handleAttachFiles(e.target.files)}
                        disabled={loading || attachmentUploading || pendingAttachments.length >= MAX_ATTACHMENTS_PER_MESSAGE}
                    />
                    {/* Paperclip button */}
                    <button
                        onClick={() => { setAttachmentError(null); attachInputRef.current?.click(); }}
                        disabled={loading || attachmentUploading || pendingAttachments.length >= MAX_ATTACHMENTS_PER_MESSAGE}
                        title={pendingAttachments.length >= MAX_ATTACHMENTS_PER_MESSAGE ? `Max ${MAX_ATTACHMENTS_PER_MESSAGE} files` : 'Attach file (PDF, image, CSV, Excel)'}
                        className={`flex-shrink-0 w-9 h-9 rounded-xl border flex items-center justify-center transition-all ${
                            loading || attachmentUploading || pendingAttachments.length >= MAX_ATTACHMENTS_PER_MESSAGE
                                ? 'border-slate-100 text-slate-300 cursor-not-allowed'
                                : 'border-slate-200 text-slate-400 hover:text-blue-600 hover:border-blue-300 hover:bg-blue-50'
                        }`}
                    >
                        {attachmentUploading
                            ? <Loader2 size={14} className="animate-spin" />
                            : <Paperclip size={14} />
                        }
                    </button>
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
                        disabled={(!input.trim() && pendingAttachments.length === 0) || loading || attachmentUploading}
                        className="flex-shrink-0 w-9 h-9 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 text-white rounded-xl flex items-center justify-center transition-colors shadow-sm disabled:shadow-none"
                        title={attachmentUploading ? 'Uploading attachment…' : 'Send message'}
                    >
                        {loading ? <Loader2 size={15} className="animate-spin" /> : <Send size={14} />}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ChatPanel;
