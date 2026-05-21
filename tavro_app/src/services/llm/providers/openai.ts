import type { ILLMProvider } from './base';
import type { RuntimeMessage, InternalCompletionResult, ToolDefinition, ToolCallRecord } from '../types';
import { parseSSE } from './sse';

const ENDPOINT = 'https://api.openai.com/v1/chat/completions';

function maxTokensKey(model: string): string {
    return /^(o\d|gpt-5)/i.test(model) ? 'max_completion_tokens' : 'max_tokens';
}

/**
 * Convert RuntimeMessage[] to OpenAI wire format.
 *
 * Three RuntimeMessage shapes map to distinct OpenAI shapes:
 *   role:'tool'                       → { role:'tool', tool_call_id, content }
 *   role:'assistant' + tool_calls     → { role:'assistant', content:null, tool_calls:[...] }
 *   everything else                   → { role, content }
 */
function toWireMessages(messages: RuntimeMessage[]): any[] {
    const out: any[] = [];
    for (const m of messages) {
        if (m.role === 'tool') {
            out.push({ role: 'tool', tool_call_id: m.tool_call_id, content: m.content ?? '' });
        } else if (m.tool_calls?.length) {
            out.push({
                role: 'assistant',
                content: null,
                tool_calls: m.tool_calls.map(tc => ({
                    id: tc.id,
                    type: 'function',
                    function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
                })),
            });
        } else {
            out.push({ role: m.role, content: m.content ?? '' });
        }
    }
    return out;
}

function toWireTools(defs: ToolDefinition[]): any[] {
    return defs.map(d => ({
        type: 'function',
        function: { name: d.name, description: d.description, parameters: d.inputSchema },
    }));
}

export class OpenAIProvider implements ILLMProvider {
    readonly name = 'openai';
    requestId?: string;

    constructor(private model: string, private apiKey: string) {}

    async complete(messages: RuntimeMessage[], tools: ToolDefinition[]): Promise<InternalCompletionResult> {
        const body: any = {
            model: this.model,
            messages: toWireMessages(messages),
            [maxTokensKey(this.model)]: 2048,
        };
        if (tools.length > 0) {
            body.tools = toWireTools(tools);
            body.tool_choice = 'auto';
        }
        const res = await fetch(ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err?.error?.message ?? `OpenAI error ${res.status}`);
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

    async *stream(messages: RuntimeMessage[]): AsyncGenerator<string> {
        // Route through the server proxy so the backend continues processing even
        // if the browser navigates away. The server caches chunks by requestId,
        // enabling reconnect via GET /chat/resume/:requestId.
        const res = await fetch('/copilot-api/chat/byok/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                providerType: 'openai',
                endpoint: ENDPOINT,
                apiKey: this.apiKey,
                body: {
                    model: this.model,
                    messages: toWireMessages(messages),
                    [maxTokensKey(this.model)]: 1024,
                },
                ...(this.requestId ? { requestId: this.requestId } : {}),
            }),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err?.error?.message ?? `OpenAI stream error ${res.status}`);
        }
        yield* parseSSE(res.body!.getReader(), p => p?.delta ?? '');
    }

    buildToolCallMessage(toolCalls: ToolCallRecord[]): RuntimeMessage {
        return { role: 'assistant', content: null, tool_calls: toolCalls };
    }

    buildToolResultMessage(toolCallId: string, toolName: string, result: string): RuntimeMessage {
        return { role: 'tool', content: result, tool_call_id: toolCallId, name: toolName };
    }
}
