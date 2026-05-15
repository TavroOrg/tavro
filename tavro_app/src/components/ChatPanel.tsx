import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Loader2, MessageCircle, Settings2, Copy, Download, Check, FileText } from 'lucide-react';
import { mcpClient } from '../services/mcpClient';
import { getLLMConfig, LLMProvider, getProviderConfig, getActiveProvider, setActiveProvider } from '../services/llmService';
import { ChatMessage } from '../services/llmService';
import { useNavigate } from 'react-router-dom';
import { jsPDF } from 'jspdf';
import { useChatContext } from '../context/ChatContext';
import type { BlueprintContext } from '../context/ChatContext';
import { buildSystemPrompt, getSuggestedPrompts, getContextBadge } from '../services/buildSystemPrompt';
import { useBlueprint } from '../context/BlueprintContext';

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

function buildTranscript(messages: Message[]): string {
    return messages
        .filter(m => m.id !== 'welcome' && !m.streaming)
        .map(m => {
            const speaker = m.role === 'user' ? 'User' : 'Tavro AI Assistant';
            return `${speaker} (${m.timestamp.toLocaleString()}):\n${m.text}`;
        })
        .join('\n\n');
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

function isPdfRequest(text: string): boolean {
    const msg = text.toLowerCase();
    return msg.includes('pdf') && (msg.includes('generate') || msg.includes('create') || msg.includes('download') || msg.includes('export'));
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

const TypingIndicator: React.FC = () => (
    <div className="flex items-end gap-2 mb-4">
        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center shadow-sm">
            <Bot size={14} className="text-white" />
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm">
            <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
        </div>
    </div>
);

const ChatBubble: React.FC<{ message: Message }> = ({ message }) => {
    const isUser = message.role === 'user';
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        navigator.clipboard.writeText(message.text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleDownloadPDF = () => {
        saveTextAsPdf('Tavro AI Assistant Response', message.text, `tavro-assistant-response-${Date.now()}.pdf`);
    };

    return (
        <div className={`flex flex-col mb-4 ${isUser ? 'items-end' : 'items-start'}`}>
            <div className={`flex items-end gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
                <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center shadow-sm ${isUser ? 'bg-slate-700' : 'bg-blue-600'}`}>
                    {isUser ? <User size={14} className="text-white" /> : <Bot size={14} className="text-white" />}
                </div>
                <div className={`group relative max-w-[85%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed shadow-sm break-words ${isUser ? 'bg-blue-600 text-white rounded-br-sm' : 'bg-white border border-slate-200 text-slate-800 rounded-bl-sm'
                    }`}>
                    {renderMarkdown(message.text, isUser)}
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
                                    onClick={handleDownloadPDF}
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

/** Inline Chat panel — renders as h-full flex column, no fixed positioning. */
const ChatPanel: React.FC<ChatPanelProps> = ({ onClose }) => {
    const navigate = useNavigate();
    const { viewType, viewData } = useChatContext();
  const { activeCompany, nodes } = useBlueprint();
  const blueprintCtx: BlueprintContext | null = activeCompany ? {
    companyId:   activeCompany.id,
    companyName: activeCompany.name,
    industry:    activeCompany.industry,
    region:      activeCompany.region,
    dimensions:  nodes.slice(0, 30).map(n => ({
      label:    n.label,
      category: n.category ?? 'custom',
      summary:  n.summary?.slice(0, 120),
    })),
  } : null;

    const [activeProviderState, setActiveProviderState] = useState<LLMProvider | null>(getActiveProvider());
    const [configuredProviders, setConfiguredProviders] = useState<{provider: LLMProvider, label: string}[]>([]);

    useEffect(() => {
        const providers: LLMProvider[] = ['openai', 'gemini', 'anthropic'];
        const configured = providers.map(p => ({ provider: p, cfg: getProviderConfig(p) }))
                                    .filter(x => x.cfg !== null)
                                    .map(x => ({
                                        provider: x.provider,
                                        label: `${x.provider === 'openai' ? 'OpenAI' : x.provider === 'gemini' ? 'Gemini' : 'Claude'} · ${x.cfg!.model}`
                                    }));
        setConfiguredProviders(configured);
    }, []);

    const llmCfg = activeProviderState ? getProviderConfig(activeProviderState) : null;
    const modelLabel = llmCfg ? `${llmCfg.provider === 'openai' ? 'OpenAI' : llmCfg.provider === 'gemini' ? 'Gemini' : 'Claude'} · ${llmCfg.model}` : null;

    const WELCOME: Message = {
        id: 'welcome', role: 'assistant',
        text: getWelcomeText(llmCfg?.model ?? null),
        timestamp: new Date(),
    };

    const [messages, setMessages] = useState<Message[]>([WELCOME]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [chatCopied, setChatCopied] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, loading]);

    useEffect(() => {
        // Focus input when this tab becomes active
        setTimeout(() => textareaRef.current?.focus(), 100);
    }, []);

    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setInput(e.target.value);
        // Auto-grow textarea
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            const newHeight = Math.min(textareaRef.current.scrollHeight, 240);
            textareaRef.current.style.height = `${newHeight}px`;
        }
    };

    const buildHistory = (): ChatMessage[] => {
        return messages
            .filter(m => m.id !== 'welcome' && !m.streaming)
            .map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text } as ChatMessage));
    };

    const copyConversation = () => {
        const transcript = buildTranscript(messages);
        navigator.clipboard.writeText(transcript || WELCOME.text);
        setChatCopied(true);
        setTimeout(() => setChatCopied(false), 2000);
    };

    const downloadConversationPdf = () => {
        saveTextAsPdf('Tavro AI Assistant Chat', buildTranscript(messages), `tavro-assistant-chat-${Date.now()}.pdf`);
    };

    const sendMessage = async () => {
        const text = input.trim();
        if (!text || loading) return;

        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
        }

        const userMsg: Message = { id: `user-${Date.now()}`, role: 'user', text, timestamp: new Date() };
        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setLoading(true);

        const assistantId = `assistant-${Date.now()}`;

        try {
            if (isPdfRequest(text)) {
                const transcript = buildTranscript([...messages, userMsg]);
                saveTextAsPdf('Tavro AI Assistant Chat', transcript, `tavro-assistant-chat-${Date.now()}.pdf`);
                setLoading(false);
                setMessages(prev => [...prev, {
                    id: assistantId,
                    role: 'assistant',
                    text: 'I generated a PDF from the current chat and started the download.',
                    timestamp: new Date(),
                }]);
                return;
            }
            const systemPrompt = buildSystemPrompt(viewType, viewData, blueprintCtx);
            const stream = mcpClient.chat(text, buildHistory(), { viewType, viewData, systemPrompt });
            let firstToken = true;
            let accumulated = '';

            for await (const token of stream) {
                accumulated += token;
                if (firstToken) {
                    firstToken = false;
                    setLoading(false);
                    setMessages(prev => [...prev, {
                        id: assistantId, role: 'assistant',
                        text: accumulated, timestamp: new Date(), streaming: true,
                    }]);
                } else {
                    setMessages(prev => prev.map(m =>
                        m.id === assistantId ? { ...m, text: accumulated } : m
                    ));
                }
            }

            setMessages(prev => prev.map(m =>
                m.id === assistantId ? { ...m, streaming: false } : m
            ));

        } catch (err: any) {
            setMessages(prev => [...prev, {
                id: `err-${Date.now()}`, role: 'assistant',
                text: `Something went wrong: ${err?.message ?? 'unknown error'}. Please try again.`,
                timestamp: new Date(),
            }]);
        } finally {
            setLoading(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    };

    return (
        <div className="flex flex-col h-full bg-slate-50">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-slate-200 flex-shrink-0">
                <div className="flex items-center gap-2.5">
                    <div className="bg-blue-600 text-white p-1.5 rounded-lg shadow-sm">
                        <MessageCircle size={14} />
                    </div>
                    <div>
                        <h2 className="font-semibold text-slate-800 text-sm leading-tight">Tavro AI Assistant</h2>
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
                <div className="flex items-center gap-1.5">
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
                        title="Download chat as PDF"
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
                {messages.map(msg => <ChatBubble key={msg.id} message={msg} />)}
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
