/**
 * llmService.ts
 *
 * Thin streaming wrapper for configured LLM providers.
 * Configuration is read from localStorage at call time so it always reflects
 * the latest Settings page values — no module-level caching.
 *
 * Supported providers:
 *   openai    → https://api.openai.com/v1/chat/completions
 *   gemini    → https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent
 *   anthropic → https://api.anthropic.com/v1/messages
 */

export type LLMProvider = 'openai' | 'gemini' | 'anthropic' | 'copilot';

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

/**
 * Copilot SDK BYOK (Bring Your Own Key) provider configuration.
 * When set on an LLMConfig with provider === 'copilot', direct API calls are
 * made to the chosen backend instead of routing through the GitHub Copilot proxy.
 */
export interface CopilotBYOKConfig {
    /** Underlying API type: OpenAI-compatible, Azure OpenAI, or Anthropic. */
    type: 'openai' | 'azure' | 'anthropic';
    /**
     * Custom API base URL.
     * - openai: defaults to https://api.openai.com/v1 (set for Azure AI Foundry, Ollama, etc.)
     * - azure: required — host only, e.g. https://my-resource.openai.azure.com
     * - anthropic: defaults to https://api.anthropic.com
     */
    baseUrl?: string;
    /** Bearer token (takes precedence over apiKey for openai/azure auth). */
    bearerToken?: string;
    /** API wire format — 'completions' (default) or 'responses' (OpenAI/Azure only). */
    wireApi?: 'completions' | 'responses';
    /** Azure API version (default: 2024-10-21, azure type only). */
    azureApiVersion?: string;
}

export interface LLMConfig {
    provider: LLMProvider;
    model: string;
    apiKey: string;
    /** BYOK config — only meaningful when provider === 'copilot'. */
    byok?: CopilotBYOKConfig;
}

export const DEFAULT_MODELS: Record<LLMProvider, string> = {
    openai: 'gpt-4o',
    gemini: 'gemini-1.5-flash',
    anthropic: 'claude-sonnet-4-20250514',
    copilot: 'gpt-4.1',
};

export const PROVIDER_HINTS: Record<LLMProvider, string> = {
    openai: 'api.openai.com',
    gemini: 'generativelanguage.googleapis.com',
    anthropic: 'api.anthropic.com',
    copilot: 'GitHub Copilot SDK — supports OpenAI / Azure OpenAI / Anthropic BYOK',
};

export const PROVIDER_LABELS: Record<LLMProvider, string> = {
    openai: 'OpenAI',
    gemini: 'Google Gemini',
    anthropic: 'Anthropic Claude',
    copilot: 'GitHub Copilot SDK',
};

// ── localStorage helpers ──────────────────────────────────────────────────────

const LS_ACTIVE = 'tavro_llm_active';

// Per-provider keys
const lsModel = (p: LLMProvider) => `tavro_llm_model_${p}`;
const lsKey   = (p: LLMProvider) => `tavro_llm_key_${p}`;
const lsByok  = (p: LLMProvider) => `tavro_llm_byok_${p}`;

// Legacy single-provider keys (migrated on first read)
const LS_LEGACY_PROVIDER = 'tavro_llm_provider';
const LS_LEGACY_MODEL    = 'tavro_llm_model';
const LS_LEGACY_KEY      = 'tavro_llm_key';

function migrateLegacy(): void {
    const legacyProvider = localStorage.getItem(LS_LEGACY_PROVIDER) as LLMProvider | null;
    const legacyKey      = localStorage.getItem(LS_LEGACY_KEY);
    if (legacyProvider && legacyKey && !localStorage.getItem(lsKey(legacyProvider))) {
        const legacyModel = localStorage.getItem(LS_LEGACY_MODEL) || DEFAULT_MODELS[legacyProvider];
        localStorage.setItem(lsKey(legacyProvider), legacyKey);
        localStorage.setItem(lsModel(legacyProvider), legacyModel);
        if (!localStorage.getItem(LS_ACTIVE)) localStorage.setItem(LS_ACTIVE, legacyProvider);
        [LS_LEGACY_PROVIDER, LS_LEGACY_MODEL, LS_LEGACY_KEY].forEach(k => localStorage.removeItem(k));
    }
}

/** Get config for a specific provider (returns null if no key saved) */
export function getProviderConfig(provider: LLMProvider): LLMConfig | null {
    migrateLegacy();
    const apiKey = localStorage.getItem(lsKey(provider)) ?? '';
    if (!apiKey) return null;
    let model = localStorage.getItem(lsModel(provider)) || DEFAULT_MODELS[provider];
    if (provider === 'copilot' && model === 'gpt-5') {
        model = DEFAULT_MODELS.copilot;
        localStorage.setItem(lsModel(provider), model);
    }
    const cfg: LLMConfig = { provider, model, apiKey };
    if (provider === 'copilot') {
        const byokRaw = localStorage.getItem(lsByok(provider));
        if (byokRaw) {
            try { cfg.byok = JSON.parse(byokRaw) as CopilotBYOKConfig; } catch { /* ignore corrupt entry */ }
        }
    }
    return cfg;
}

/** Save config for a specific provider */
export function saveProviderConfig(cfg: LLMConfig): void {
    localStorage.setItem(lsKey(cfg.provider), cfg.apiKey);
    localStorage.setItem(lsModel(cfg.provider), cfg.model.trim() || DEFAULT_MODELS[cfg.provider]);
    if (cfg.provider === 'copilot') {
        if (cfg.byok) {
            localStorage.setItem(lsByok(cfg.provider), JSON.stringify(cfg.byok));
        } else {
            localStorage.removeItem(lsByok(cfg.provider));
        }
    }
}

/** Clear config for a specific provider */
export function clearProviderConfig(provider: LLMProvider): void {
    localStorage.removeItem(lsKey(provider));
    localStorage.removeItem(lsModel(provider));
    localStorage.removeItem(lsByok(provider));
    if (localStorage.getItem(LS_ACTIVE) === provider) localStorage.removeItem(LS_ACTIVE);
}

/** Get the currently active provider (the one the chat will use) */
export function getActiveProvider(): LLMProvider | null {
    migrateLegacy();
    return (localStorage.getItem(LS_ACTIVE) as LLMProvider) || null;
}

/** Set the active provider */
export function setActiveProvider(provider: LLMProvider): void {
    localStorage.setItem(LS_ACTIVE, provider);
}

/** Get the active LLM config (active provider + its model/key) */
export function getLLMConfig(): LLMConfig | null {
    migrateLegacy();
    const active = getActiveProvider();
    if (!active) return null;
    return getProviderConfig(active);
}

/** @deprecated use saveProviderConfig + setActiveProvider */
export function saveLLMConfig(cfg: LLMConfig): void {
    saveProviderConfig(cfg);
    setActiveProvider(cfg.provider);
}

/** @deprecated use clearProviderConfig */
export function clearLLMConfig(): void {
    const active = getActiveProvider();
    if (active) clearProviderConfig(active);
}

// ── Tool-calling types ─────────────────────────────────────────────────────────

export interface ToolCall {
    id: string;
    name: string;
    arguments: Record<string, any>;
}

export interface CompletionResult {
    type: 'text' | 'tool_calls';
    content?: string;
    toolCalls?: ToolCall[];
}

// ── Streaming helpers ──────────────────────────────────────────────────────────

/** Parse SSE data lines and yield text deltas */
async function* parseSSE(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    extractDelta: (parsed: any) => string
): AsyncGenerator<string> {
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
            let parsed: any;
            try {
                parsed = JSON.parse(data);
            } catch { /* skip malformed chunks */ }
            if (parsed === undefined) continue;
            const delta = extractDelta(parsed);
            if (delta) yield delta;
        }
    }
}

// ── Provider implementations ─────────────────────────────────────────────────

async function* streamOpenAI(cfg: LLMConfig, messages: ChatMessage[]): AsyncGenerator<string> {
    const tokenLimitKey = /^(o\d|gpt-5)/i.test(cfg.model) ? 'max_completion_tokens' : 'max_tokens';
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({
            model: cfg.model,
            messages,
            stream: true,
            [tokenLimitKey]: 1024,
        }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message ?? `OpenAI error ${res.status}`);
    }
    yield* parseSSE(res.body!.getReader(), p => p?.choices?.[0]?.delta?.content ?? '');
}

async function* streamGemini(cfg: LLMConfig, messages: ChatMessage[]): AsyncGenerator<string> {
    // Gemini uses a different message format — extract system prompt separately
    const systemParts = messages.filter(m => m.role === 'system').map(m => ({ text: m.content }));
    const contents = messages
        .filter(m => m.role !== 'system')
        .map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:streamGenerateContent?alt=sse&key=${cfg.apiKey}`;
    const body: any = { 
        contents, 
        generationConfig: { temperature: 0.4, maxOutputTokens: 1024 },
        tools: [{ googleSearch: {} }]
    };
    if (systemParts.length > 0) body.systemInstruction = { parts: systemParts };

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message ?? `Gemini error ${res.status}`);
    }
    yield* parseSSE(res.body!.getReader(), p => p?.candidates?.[0]?.content?.parts?.[0]?.text ?? '');
}

async function* streamAnthropic(cfg: LLMConfig, messages: ChatMessage[]): AsyncGenerator<string> {
    const systemMsg = messages.find(m => m.role === 'system')?.content ?? '';
    const chatMsgs = messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content }));
    const modelsToTry = Array.from(new Set([
        cfg.model,
        'claude-sonnet-4-6',
        'claude-sonnet-4-5',
        'claude-3-5-sonnet-20241022',
        'claude-3-5-haiku-20241022',
        'claude-3-opus-20240229',  // note: opus is still valid
    ].filter(Boolean)));
    const errors: string[] = [];

    for (const model of modelsToTry) {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': cfg.apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true',
            },
            body: JSON.stringify({
                model,
                max_tokens: 1024,
                system: systemMsg,
                messages: chatMsgs,
                stream: true,
            }),
        });
        if (res.ok) {
            if (model !== cfg.model) localStorage.setItem(lsModel('anthropic'), model);
            yield* parseSSE(res.body!.getReader(), p => p?.delta?.text ?? '');
            return;
        }
        const err = await res.json().catch(() => ({}));
        const message = err?.error?.message ?? err?.message ?? JSON.stringify(err);
        errors.push(`${model}: HTTP ${res.status} ${message}`);
    }
    throw new Error(`Anthropic model access failed. Tried: ${errors.join(' | ')}`);
}

async function* streamCopilot(cfg: LLMConfig, messages: ChatMessage[]): AsyncGenerator<string> {
    const byok = cfg.byok;

    // ── OpenAI BYOK — via proxy (avoids CORS) ─────────────────────────────────
    if (byok?.type === 'openai') {
        const base = (byok.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
        const tokenLimitKey = /^(o\d|gpt-5)/i.test(cfg.model) ? 'max_completion_tokens' : 'max_tokens';
        const res = await fetch('/copilot-api/chat/byok/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                providerType: 'openai',
                endpoint: `${base}/chat/completions`,
                apiKey: cfg.apiKey,
                bearerToken: byok.bearerToken,
                body: { model: cfg.model, messages, [tokenLimitKey]: 1024 },
            }),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err?.error?.message ?? err?.error ?? `Copilot OpenAI BYOK stream error ${res.status}`);
        }
        yield* parseSSE(res.body!.getReader(), p => p?.delta ?? '');
        return;
    }

    // ── Azure OpenAI BYOK — via proxy ─────────────────────────────────────────
    if (byok?.type === 'azure') {
        const base = (byok.baseUrl || '').replace(/\/$/, '');
        const apiVersion = byok.azureApiVersion || '2024-10-21';
        const endpoint = `${base}/openai/deployments/${cfg.model}/chat/completions?api-version=${apiVersion}`;
        const res = await fetch('/copilot-api/chat/byok/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                providerType: 'azure',
                endpoint,
                apiKey: cfg.apiKey,
                body: { messages, max_tokens: 1024 },
            }),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err?.error?.message ?? err?.error ?? `Copilot Azure BYOK stream error ${res.status}`);
        }
        yield* parseSSE(res.body!.getReader(), p => p?.delta ?? '');
        return;
    }

    // ── Anthropic BYOK — via proxy ─────────────────────────────────────────────
    if (byok?.type === 'anthropic') {
        const base = (byok.baseUrl || 'https://api.anthropic.com').replace(/\/$/, '');
        const systemMsg = messages.find(m => m.role === 'system')?.content ?? '';
        const chatMsgs  = messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content }));
        const modelsToTry = Array.from(new Set([cfg.model, 'claude-sonnet-4-6', 'claude-sonnet-4-5', 'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022'].filter(Boolean)));
        const errors: string[] = [];
        for (const model of modelsToTry) {
            const res = await fetch('/copilot-api/chat/byok/stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    providerType: 'anthropic',
                    endpoint: `${base}/v1/messages`,
                    apiKey: cfg.apiKey,
                    body: { model, max_tokens: 1024, system: systemMsg, messages: chatMsgs },
                }),
            });
            if (res.ok) {
                yield* parseSSE(res.body!.getReader(), p => p?.delta ?? '');
                return;
            }
            const err = await res.json().catch(() => ({}));
            errors.push(`${model}: HTTP ${res.status} ${err?.error?.message ?? err?.error ?? ''}`);
        }
        throw new Error(`Copilot Anthropic BYOK stream failed. Tried: ${errors.join(' | ')}`);
    }

    // ── GitHub Copilot proxy (SSE) ─────────────────────────────────────────────
    const res = await fetch('/copilot-api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: cfg.model, apiKey: cfg.apiKey, messages }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error ?? `Copilot SDK proxy stream error ${res.status}`);
    }
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('text/event-stream')) {
        yield* parseSSE(res.body!.getReader(), p => p?.delta ?? p?.content ?? '');
    } else {
        // Fallback: JSON response
        const data = await res.json().catch(() => ({}));
        const content = typeof data.content === 'string' ? data.content : '';
        if (content.trim()) yield content;
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

// ── Non-streaming completion with tool-calling ────────────────────────────────

async function completeChatOpenAI(cfg: LLMConfig, messages: ChatMessage[], tools: any[]): Promise<CompletionResult> {
    const tokenLimitKey = /^(o\d|gpt-5)/i.test(cfg.model) ? 'max_completion_tokens' : 'max_tokens';
    const body: any = {
        model: cfg.model,
        messages,
        stream: false,
        [tokenLimitKey]: 2048,
    };
    if (tools.length > 0) {
        body.tools = tools;
        body.tool_choice = 'auto';
    }
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiKey}` },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message ?? `OpenAI error ${res.status}`);
    }
    const data = await res.json();
    const choice = data.choices?.[0];
    const message = choice?.message;
    if (choice?.finish_reason === 'tool_calls' && message?.tool_calls?.length > 0) {
        return {
            type: 'tool_calls',
            toolCalls: message.tool_calls.map((tc: any) => ({
                id: tc.id,
                name: tc.function.name,
                arguments: (() => { try { return JSON.parse(tc.function.arguments || '{}'); } catch { return {}; } })(),
            })),
        };
    }
    return { type: 'text', content: message?.content || '' };
}

async function completeChatAnthropic(cfg: LLMConfig, messages: ChatMessage[], tools: any[]): Promise<CompletionResult> {
    const systemMsg = messages.find(m => m.role === 'system')?.content ?? '';
    const chatMsgs = messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content }));
    const modelsToTry = Array.from(new Set([
        cfg.model, 'claude-sonnet-4-6', 'claude-sonnet-4-5', 'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022',
    ].filter(Boolean)));
    const errors: string[] = [];
    for (const model of modelsToTry) {
        const body: any = { model, max_tokens: 2048, system: systemMsg, messages: chatMsgs };
        if (tools.length > 0) {
            body.tools = tools;
            body.tool_choice = { type: 'auto' };
        }
        const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': cfg.apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true',
            },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            errors.push(`${model}: HTTP ${res.status} ${err?.error?.message ?? ''}`);
            continue;
        }
        const data = await res.json();
        if (data.stop_reason === 'tool_use') {
            const toolUseBlocks = (data.content || []).filter((c: any) => c.type === 'tool_use');
            return {
                type: 'tool_calls',
                toolCalls: toolUseBlocks.map((b: any) => ({ id: b.id, name: b.name, arguments: b.input || {} })),
            };
        }
        const textBlock = (data.content || []).find((c: any) => c.type === 'text');
        return { type: 'text', content: textBlock?.text || '' };
    }
    throw new Error(`Anthropic completion failed. Tried: ${errors.join(' | ')}`);
}

async function completeChatGemini(cfg: LLMConfig, messages: ChatMessage[], tools: any[]): Promise<CompletionResult> {
    const systemParts = messages.filter(m => m.role === 'system').map(m => ({ text: m.content }));
    const contents = messages
        .filter(m => m.role !== 'system')
        .map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:generateContent?key=${cfg.apiKey}`;
    const body: any = { contents, generationConfig: { temperature: 0.4, maxOutputTokens: 2048 } };
    if (systemParts.length > 0) body.systemInstruction = { parts: systemParts };
    if (tools.length > 0) body.tools = tools;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message ?? `Gemini error ${res.status}`);
    }
    const data = await res.json();
    const content = data.candidates?.[0]?.content;
    const functionCallParts = (content?.parts || []).filter((p: any) => p.functionCall);
    if (functionCallParts.length > 0) {
        return {
            type: 'tool_calls',
            toolCalls: functionCallParts.map((p: any, idx: number) => ({
                id: `call_${p.functionCall.name}_${Date.now()}_${idx}`,
                name: p.functionCall.name,
                arguments: p.functionCall.args || {},
            })),
        };
    }
    const textPart = (content?.parts || []).find((p: any) => p.text);
    return { type: 'text', content: textPart?.text || '' };
}

async function completeChatCopilot(cfg: LLMConfig, messages: ChatMessage[], tools: any[]): Promise<CompletionResult> {
    const byok = cfg.byok;

    // ── OpenAI BYOK — via proxy ────────────────────────────────────────────────
    if (byok?.type === 'openai') {
        const base = (byok.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
        const tokenLimitKey = /^(o\d|gpt-5)/i.test(cfg.model) ? 'max_completion_tokens' : 'max_tokens';
        const body: any = { model: cfg.model, messages, [tokenLimitKey]: 2048 };
        if (tools.length > 0) { body.tools = tools; body.tool_choice = 'auto'; }
        const res = await fetch('/copilot-api/chat/byok/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ providerType: 'openai', endpoint: `${base}/chat/completions`, apiKey: cfg.apiKey, bearerToken: byok.bearerToken, body }),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err?.error?.message ?? err?.error ?? `Copilot OpenAI BYOK error ${res.status}`);
        }
        const data = await res.json();
        const choice = data.choices?.[0];
        const message = choice?.message;
        if (choice?.finish_reason === 'tool_calls' && message?.tool_calls?.length > 0) {
            return {
                type: 'tool_calls',
                toolCalls: message.tool_calls.map((tc: any) => ({
                    id: tc.id,
                    name: tc.function.name,
                    arguments: (() => { try { return JSON.parse(tc.function.arguments || '{}'); } catch { return {}; } })(),
                })),
            };
        }
        return { type: 'text', content: message?.content || '' };
    }

    // ── Azure OpenAI BYOK — via proxy ─────────────────────────────────────────
    if (byok?.type === 'azure') {
        const base = (byok.baseUrl || '').replace(/\/$/, '');
        const apiVersion = byok.azureApiVersion || '2024-10-21';
        const endpoint = `${base}/openai/deployments/${cfg.model}/chat/completions?api-version=${apiVersion}`;
        const body: any = { messages, max_tokens: 2048 };
        if (tools.length > 0) { body.tools = tools; body.tool_choice = 'auto'; }
        const res = await fetch('/copilot-api/chat/byok/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ providerType: 'azure', endpoint, apiKey: cfg.apiKey, body }),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err?.error?.message ?? err?.error ?? `Copilot Azure BYOK error ${res.status}`);
        }
        const data = await res.json();
        const choice = data.choices?.[0];
        const message = choice?.message;
        if (choice?.finish_reason === 'tool_calls' && message?.tool_calls?.length > 0) {
            return {
                type: 'tool_calls',
                toolCalls: message.tool_calls.map((tc: any) => ({
                    id: tc.id,
                    name: tc.function.name,
                    arguments: (() => { try { return JSON.parse(tc.function.arguments || '{}'); } catch { return {}; } })(),
                })),
            };
        }
        return { type: 'text', content: message?.content || '' };
    }

    // ── Anthropic BYOK — via proxy ─────────────────────────────────────────────
    if (byok?.type === 'anthropic') {
        const base = (byok.baseUrl || 'https://api.anthropic.com').replace(/\/$/, '');
        const systemMsg = messages.find(m => m.role === 'system')?.content ?? '';
        const chatMsgs  = messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content }));
        const modelsToTry = Array.from(new Set([cfg.model, 'claude-sonnet-4-6', 'claude-sonnet-4-5', 'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022'].filter(Boolean)));
        const errors: string[] = [];
        for (const model of modelsToTry) {
            const body: any = { model, max_tokens: 2048, system: systemMsg, messages: chatMsgs };
            if (tools.length > 0) { body.tools = tools; body.tool_choice = { type: 'auto' }; }
            const res = await fetch('/copilot-api/chat/byok/complete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ providerType: 'anthropic', endpoint: `${base}/v1/messages`, apiKey: cfg.apiKey, body }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                errors.push(`${model}: HTTP ${res.status} ${err?.error?.message ?? err?.error ?? ''}`);
                continue;
            }
            const data = await res.json();
            if (data.stop_reason === 'tool_use') {
                const toolUseBlocks = (data.content || []).filter((c: any) => c.type === 'tool_use');
                return {
                    type: 'tool_calls',
                    toolCalls: toolUseBlocks.map((b: any) => ({ id: b.id, name: b.name, arguments: b.input || {} })),
                };
            }
            const textBlock = (data.content || []).find((c: any) => c.type === 'text');
            return { type: 'text', content: textBlock?.text || '' };
        }
        throw new Error(`Copilot Anthropic BYOK completion failed. Tried: ${errors.join(' | ')}`);
    }

    // ── GitHub Copilot proxy ───────────────────────────────────────────────────
    const res = await fetch('/copilot-api/chat/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: cfg.model, apiKey: cfg.apiKey, messages }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error ?? `Copilot SDK proxy error ${res.status}`);
    }
    const data = await res.json().catch(() => ({}));
    const content = typeof data.content === 'string' ? data.content : '';
    if (!content.trim()) throw new Error('Copilot SDK proxy returned empty content.');
    return { type: 'text', content };
}

/**
 * Non-streaming completion with optional tool-calling support.
 * Returns either a text response or a list of tool calls to execute.
 */
export async function completeChat(messages: ChatMessage[], tools: any[] = []): Promise<CompletionResult> {
    const cfg = getLLMConfig();
    if (!cfg) throw new Error('NO_LLM_CONFIGURED');
    switch (cfg.provider) {
        case 'openai': return completeChatOpenAI(cfg, messages, tools);
        case 'anthropic': return completeChatAnthropic(cfg, messages, tools);
        case 'gemini': return completeChatGemini(cfg, messages, tools);
        case 'copilot': return completeChatCopilot(cfg, messages, tools);
        default: throw new Error(`Unknown LLM provider: ${cfg.provider}`);
    }
}

/**
 * Stream a chat completion.
 * @throws Error if no LLM is configured or the API returns an error.
 */
export async function* streamChat(messages: ChatMessage[]): AsyncGenerator<string> {
    const cfg = getLLMConfig();
    if (!cfg) {
        throw new Error('NO_LLM_CONFIGURED');
    }
    switch (cfg.provider) {
        case 'openai': yield* streamOpenAI(cfg, messages); break;
        case 'gemini': yield* streamGemini(cfg, messages); break;
        case 'anthropic': yield* streamAnthropic(cfg, messages); break;
        case 'copilot': yield* streamCopilot(cfg, messages); break;
        default:
            throw new Error(`Unknown LLM provider: ${cfg.provider}`);
    }
}
