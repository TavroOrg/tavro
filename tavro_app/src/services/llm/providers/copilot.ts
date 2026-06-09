import type { ILLMProvider } from './base';
import type { RuntimeMessage, InternalCompletionResult, ToolDefinition, ToolCallRecord } from '../types';
import type { CopilotBYOKConfig } from '../../llmService';
import { parseSSE } from './sse';

// Proxy endpoints (Vite rewrites /copilot-api/* → copilot-server:4000/*)
const PROXY_COMPLETE      = '/copilot-api/chat/complete';
const PROXY_STREAM        = '/copilot-api/chat/stream';
const BYOK_COMPLETE       = '/copilot-api/chat/byok/complete';
const BYOK_STREAM         = '/copilot-api/chat/byok/stream';

function getCopilotSessionId(): string {
    const key = 'tavro_copilot_session_id';
    let id = localStorage.getItem(key);
    if (!id) {
        id = `tavro-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        localStorage.setItem(key, id);
    }
    return id;
}

/**
 * Read Tavro MCP credentials from localStorage so the proxy can wire the MCP
 * server into the GitHub Copilot SDK session for automatic tool routing.
 * Only used for the non-BYOK (GitHub Copilot SDK) path.
 */
function getMcpCredentials(): { mcpToken: string | null; mcpTenantId: string | null } {
    return {
        mcpToken:
            localStorage.getItem('tavro_mcp_access_token') ||
            localStorage.getItem('tavro_access_token') ||
            localStorage.getItem('tavro_id_token') ||
            null,
        mcpTenantId: localStorage.getItem('tavro_tenant_id') || null,
    };
}

// ── OpenAI wire helpers ───────────────────────────────────────────────────────

function maxTokensKey(model: string): string {
    return /^(o\d|gpt-5)/i.test(model) ? 'max_completion_tokens' : 'max_tokens';
}

function maxTokensValue(model: string, mode: 'complete' | 'stream'): number {
    const isGpt5 = /^gpt-5/i.test(model);
    if (mode === 'complete') return isGpt5 ? 8192 : 2048;
    return isGpt5 ? 4096 : 1024;
}

function toWireMessagesOpenAI(messages: RuntimeMessage[]): any[] {
    return messages.map(m => {
        if (m.role === 'tool') {
            return { role: 'tool', tool_call_id: m.tool_call_id, content: m.content ?? '' };
        }
        if (m.tool_calls?.length) {
            return {
                role: 'assistant',
                content: null,
                tool_calls: m.tool_calls.map(tc => ({
                    id: tc.id,
                    type: 'function',
                    function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
                })),
            };
        }
        return { role: m.role, content: m.content ?? '' };
    });
}

function toWireToolsOpenAI(defs: ToolDefinition[]): any[] {
    return defs.map(d => ({
        type: 'function',
        function: { name: d.name, description: d.description, parameters: d.inputSchema },
    }));
}

// ── Anthropic wire helpers ────────────────────────────────────────────────────

function toWireMessagesAnthropic(messages: RuntimeMessage[]): any[] {
    const out: any[] = [];
    for (let i = 0; i < messages.length; i++) {
        const m = messages[i];
        if (m.role === 'system') continue;

        if (m.tool_calls?.length) {
            const textParts = m.content ? [{ type: 'text', text: m.content }] : [];
            out.push({
                role: 'assistant',
                content: [
                    ...textParts,
                    ...m.tool_calls.map(tc => ({
                        type: 'tool_use',
                        id: tc.id,
                        name: tc.name,
                        input: tc.arguments,
                    })),
                ],
            });
            continue;
        }

        if (m.role === 'tool') {
            // Batch consecutive tool results into one user message (Anthropic requirement)
            const blocks: any[] = [];
            let j = i;
            while (j < messages.length && messages[j].role === 'tool') {
                blocks.push({
                    type: 'tool_result',
                    tool_use_id: messages[j].tool_call_id,
                    content: messages[j].content ?? '',
                });
                j++;
            }
            out.push({ role: 'user', content: blocks });
            i = j - 1;
            continue;
        }

        out.push({ role: m.role, content: m.content ?? '' });
    }
    return out;
}

function toWireToolsAnthropic(defs: ToolDefinition[]): any[] {
    return defs.map(d => ({
        name: d.name,
        description: d.description,
        input_schema: d.inputSchema,
    }));
}

function extractSystemAnthropic(messages: RuntimeMessage[]): string {
    return messages
        .filter(m => m.role === 'system')
        .map(m => m.content ?? '')
        .join('\n');
}

// ── Proxy call helpers ────────────────────────────────────────────────────────

interface ByokPayload {
    providerType: string;
    endpoint: string;
    apiKey: string;
    bearerToken?: string;
    body: Record<string, any>;
    requestId?: string;
}

function toProxyProvider(byok: CopilotBYOKConfig | undefined, apiKey: string, model: string): Record<string, any> | undefined {
    if (!byok) return undefined;
    const provider: Record<string, any> = {
        type: byok.type,
        apiKey,
    };
    if (byok.baseUrl) provider.baseUrl = byok.baseUrl;
    if (byok.bearerToken) provider.bearerToken = byok.bearerToken;
    if (byok.wireApi) provider.wireApi = byok.wireApi;
    if (byok.azureApiVersion) provider.azure = { apiVersion: byok.azureApiVersion };
    if (byok.type === 'anthropic') {
        provider.modelId = 'claude-3-5-sonnet-20241022';
        provider.wireModel = model;
        provider.modelCapabilities = {
            supports: {
                vision: false,
                reasoningEffort: false,
            },
        };
    }
    return provider;
}

function extractProxyDelta(payload: any): string {
    if (payload?.error) {
        throw new Error(typeof payload.error === 'string' ? payload.error : JSON.stringify(payload.error));
    }
    return payload?.delta ?? payload?.content ?? '';
}

async function byokComplete(payload: ByokPayload): Promise<Response> {
    return fetch(BYOK_COMPLETE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
}

async function byokStream(payload: ByokPayload): Promise<Response> {
    return fetch(BYOK_STREAM, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
}

// ── CopilotProvider ───────────────────────────────────────────────────────────

/**
 * Copilot SDK provider with full BYOK support.
 *
 * Modes (selected via the `byok` constructor arg):
 *   - byok.type === 'openai':     Routes through proxy → OpenAI-compatible API.
 *   - byok.type === 'azure':      Routes through proxy → Azure OpenAI API.
 *   - byok.type === 'anthropic':  Routes through proxy → Anthropic API.
 *   - byok === undefined:         Routes through GitHub Copilot proxy server.
 *
 * All calls go through the copilot-server proxy (no direct browser→API calls),
 * which avoids CORS restrictions and gives server-side request logging.
 */
export class CopilotProvider implements ILLMProvider {
    readonly name = 'copilot';
    requestId?: string;

    constructor(
        private model: string,
        private apiKey: string,
        private byok?: CopilotBYOKConfig,
    ) {}

    // ── ILLMProvider ──────────────────────────────────────────────────────────

    async complete(messages: RuntimeMessage[], tools: ToolDefinition[]): Promise<InternalCompletionResult> {
        if (this.byok) {
            switch (this.byok.type) {
                case 'openai':    return this.completeOpenAI(messages, tools);
                case 'azure':     return this.completeAzure(messages, tools);
                case 'anthropic': return this.completeAnthropic(messages, tools);
            }
        }
        return this.completeViaProxy(messages);
    }

    async *stream(messages: RuntimeMessage[]): AsyncGenerator<string> {
        if (this.byok) {
            switch (this.byok.type) {
                case 'openai':    yield* this.streamOpenAI(messages);    return;
                case 'azure':     yield* this.streamAzure(messages);     return;
                case 'anthropic': yield* this.streamAnthropic(messages); return;
            }
        }
        yield* this.streamViaProxy(messages);
    }

    buildToolCallMessage(toolCalls: ToolCallRecord[]): RuntimeMessage {
        return { role: 'assistant', content: null, tool_calls: toolCalls };
    }

    buildToolResultMessage(toolCallId: string, toolName: string, result: string): RuntimeMessage {
        return { role: 'tool', content: result, tool_call_id: toolCallId, name: toolName };
    }

    // ── OpenAI BYOK (via proxy) ───────────────────────────────────────────────

    private openAIEndpoint(): string {
        const base = (this.byok?.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
        return `${base}/chat/completions`;
    }

    private async completeOpenAI(messages: RuntimeMessage[], tools: ToolDefinition[]): Promise<InternalCompletionResult> {
        const body: any = {
            model: this.model,
            messages: toWireMessagesOpenAI(messages),
            [maxTokensKey(this.model)]: maxTokensValue(this.model, 'complete'),
        };
        if (tools.length > 0) {
            body.tools = toWireToolsOpenAI(tools);
            body.tool_choice = 'auto';
        }
        const res = await byokComplete({
            providerType: 'openai',
            endpoint: this.openAIEndpoint(),
            apiKey: this.apiKey,
            bearerToken: this.byok?.bearerToken,
            body,
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err?.error?.message ?? err?.error ?? `Copilot OpenAI BYOK error ${res.status}`);
        }
        const data = await res.json();
        const choice = data.choices?.[0];
        const msg = choice?.message;
        if (choice?.finish_reason === 'tool_calls' && msg?.tool_calls?.length) {
            return {
                type: 'tool_calls',
                toolCalls: msg.tool_calls.map((tc: any) => ({
                    id: tc.id,
                    name: tc.function.name,
                    arguments: (() => { try { return JSON.parse(tc.function.arguments || '{}'); } catch { return {}; } })(),
                })),
            };
        }
        return { type: 'text', content: msg?.content || '' };
    }

    private async *streamOpenAI(messages: RuntimeMessage[]): AsyncGenerator<string> {
        const res = await byokStream({
            providerType: 'openai',
            endpoint: this.openAIEndpoint(),
            apiKey: this.apiKey,
            bearerToken: this.byok?.bearerToken,
            body: {
                model: this.model,
                messages: toWireMessagesOpenAI(messages),
                [maxTokensKey(this.model)]: maxTokensValue(this.model, 'stream'),
            },
            ...(this.requestId ? { requestId: this.requestId } : {}),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err?.error?.message ?? err?.error ?? `Copilot OpenAI BYOK stream error ${res.status}`);
        }
        yield* parseSSE(res.body!.getReader(), extractProxyDelta);
    }

    // ── Azure OpenAI BYOK (via proxy) ─────────────────────────────────────────

    private azureEndpoint(): string {
        const base       = (this.byok?.baseUrl || '').replace(/\/$/, '');
        const apiVersion = this.byok?.azureApiVersion || '2024-10-21';
        return `${base}/openai/deployments/${this.model}/chat/completions?api-version=${apiVersion}`;
    }

    private async completeAzure(messages: RuntimeMessage[], tools: ToolDefinition[]): Promise<InternalCompletionResult> {
        const body: any = {
            messages: toWireMessagesOpenAI(messages),
            max_tokens: 8192,
        };
        if (tools.length > 0) {
            body.tools = toWireToolsOpenAI(tools);
            body.tool_choice = 'auto';
        }
        const res = await byokComplete({
            providerType: 'azure',
            endpoint: this.azureEndpoint(),
            apiKey: this.apiKey,
            body,
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err?.error?.message ?? err?.error ?? `Copilot Azure BYOK error ${res.status}`);
        }
        const data = await res.json();
        const choice = data.choices?.[0];
        const msg = choice?.message;
        if (choice?.finish_reason === 'tool_calls' && msg?.tool_calls?.length) {
            return {
                type: 'tool_calls',
                toolCalls: msg.tool_calls.map((tc: any) => ({
                    id: tc.id,
                    name: tc.function.name,
                    arguments: (() => { try { return JSON.parse(tc.function.arguments || '{}'); } catch { return {}; } })(),
                })),
            };
        }
        return { type: 'text', content: msg?.content || '' };
    }

    private async *streamAzure(messages: RuntimeMessage[]): AsyncGenerator<string> {
        const res = await byokStream({
            providerType: 'azure',
            endpoint: this.azureEndpoint(),
            apiKey: this.apiKey,
            body: {
                messages: toWireMessagesOpenAI(messages),
                max_tokens: 8192,
            },
            ...(this.requestId ? { requestId: this.requestId } : {}),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err?.error?.message ?? err?.error ?? `Copilot Azure BYOK stream error ${res.status}`);
        }
        yield* parseSSE(res.body!.getReader(), extractProxyDelta);
    }

    // ── Anthropic BYOK (via proxy) ────────────────────────────────────────────

    private anthropicEndpoint(): string {
        const base = (this.byok?.baseUrl || 'https://api.anthropic.com').replace(/\/$/, '');
        return `${base}/v1/messages`;
    }

    private anthropicModels(): string[] {
        return Array.from(new Set([
            this.model,
            'claude-sonnet-4-6',
            'claude-sonnet-4-5',
            'claude-3-5-sonnet-20241022',
            'claude-3-5-haiku-20241022',
            'claude-3-opus-20240229',
        ].filter(Boolean)));
    }

    private async completeAnthropic(messages: RuntimeMessage[], tools: ToolDefinition[]): Promise<InternalCompletionResult> {
        const system   = extractSystemAnthropic(messages);
        const chatMsgs = toWireMessagesAnthropic(messages);
        const errors: string[] = [];

        for (const model of this.anthropicModels()) {
            const body: any = { model, max_tokens: 8192, system, messages: chatMsgs };
            if (tools.length > 0) {
                body.tools = toWireToolsAnthropic(tools);
                body.tool_choice = { type: 'auto' };
            }
            const res = await byokComplete({
                providerType: 'anthropic',
                endpoint: this.anthropicEndpoint(),
                apiKey: this.apiKey,
                body,
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                errors.push(`${model}: HTTP ${res.status} ${err?.error?.message ?? err?.error ?? ''}`);
                continue;
            }
            const data = await res.json();
            if (data.stop_reason === 'tool_use') {
                const blocks = (data.content || []).filter((c: any) => c.type === 'tool_use');
                return {
                    type: 'tool_calls',
                    toolCalls: blocks.map((b: any) => ({
                        id: b.id,
                        name: b.name,
                        arguments: b.input || {},
                    })),
                };
            }
            const textBlock = (data.content || []).find((c: any) => c.type === 'text');
            return { type: 'text', content: textBlock?.text || '' };
        }
        throw new Error(`Copilot Anthropic BYOK completion failed. Tried: ${errors.join(' | ')}`);
    }

    private async *streamAnthropic(messages: RuntimeMessage[]): AsyncGenerator<string> {
        const system   = extractSystemAnthropic(messages);
        const chatMsgs = toWireMessagesAnthropic(messages);
        const errors: string[] = [];
        let firstAttempt = true;

        for (const model of this.anthropicModels()) {
            const requestId = firstAttempt ? this.requestId : undefined;
            firstAttempt = false;
            const res = await byokStream({
                providerType: 'anthropic',
                endpoint: this.anthropicEndpoint(),
                apiKey: this.apiKey,
                body: { model, max_tokens: 8192, system, messages: chatMsgs },
                ...(requestId ? { requestId } : {}),
            });
            if (res.ok) {
                yield* parseSSE(res.body!.getReader(), extractProxyDelta);
                return;
            }
            const err = await res.json().catch(() => ({}));
            errors.push(`${model}: HTTP ${res.status} ${err?.error?.message ?? err?.error ?? ''}`);
        }
        throw new Error(`Copilot Anthropic BYOK stream failed. Tried: ${errors.join(' | ')}`);
    }

    // ── GitHub Copilot proxy mode ─────────────────────────────────────────────

    private async completeViaProxy(messages: RuntimeMessage[]): Promise<InternalCompletionResult> {
        const { mcpToken, mcpTenantId } = getMcpCredentials();
        const res = await fetch(PROXY_COMPLETE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: this.model,
                apiKey: this.apiKey,
                messages,
                provider: toProxyProvider(this.byok, this.apiKey, this.model),
                sessionId: getCopilotSessionId(),
                mcpToken,
                mcpTenantId,
            }),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err?.error ?? `Copilot proxy error ${res.status}`);
        }
        const data = await res.json().catch(() => ({}));
        const content = typeof data.content === 'string' ? data.content : '';
        if (!content.trim()) throw new Error('Copilot SDK proxy returned empty content.');
        return { type: 'text', content };
    }

    private async *streamViaProxy(messages: RuntimeMessage[]): AsyncGenerator<string> {
        const { mcpToken, mcpTenantId } = getMcpCredentials();
        const res = await fetch(PROXY_STREAM, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: this.model,
                apiKey: this.apiKey,
                messages,
                provider: toProxyProvider(this.byok, this.apiKey, this.model),
                sessionId: getCopilotSessionId(),
                mcpToken,
                mcpTenantId,
                ...(this.requestId ? { requestId: this.requestId } : {}),
            }),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err?.error ?? `Copilot proxy stream error ${res.status}`);
        }
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('text/event-stream')) {
            yield* parseSSE(res.body!.getReader(), extractProxyDelta);
        } else {
            const data = await res.json().catch(() => ({}));
            if (data?.error) throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
            const content = typeof data.content === 'string' ? data.content : '';
            if (content.trim()) yield content;
        }
    }
}