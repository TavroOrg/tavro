import type { ILLMProvider } from './base';
import type { RuntimeMessage, InternalCompletionResult, ToolDefinition, ToolCallRecord } from '../types';
import { parseSSE } from './sse';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const DIRECT_HEADERS = {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
};
const FALLBACK_MODELS = [
    'claude-sonnet-4-6',
    'claude-sonnet-4-5',
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-20241022',
    'claude-3-opus-20240229',
];

/**
 * Convert RuntimeMessage[] to Anthropic wire format.
 *
 * Anthropic has two structural constraints that the OpenAI adapter does not:
 *
 * 1. System messages are a top-level field, not part of the messages array.
 *    We skip them here; extractSystem() handles them separately.
 *
 * 2. Multiple tool results must be batched into a SINGLE 'user' message as
 *    content blocks (type: 'tool_result'). Having separate 'user' messages for
 *    each tool result causes an API validation error. This adapter looks ahead
 *    and consumes all consecutive 'tool' RuntimeMessages into one batch.
 */
function toWireMessages(messages: RuntimeMessage[]): any[] {
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
            i = j - 1; // skip ahead past the batch we just consumed
            continue;
        }

        out.push({ role: m.role, content: m.content ?? '' });
    }
    return out;
}

function toWireTools(defs: ToolDefinition[]): any[] {
    return defs.map(d => ({
        name: d.name,
        description: d.description,
        input_schema: d.inputSchema,
    }));
}

function extractSystem(messages: RuntimeMessage[]): string {
    return messages
        .filter(m => m.role === 'system')
        .map(m => m.content ?? '')
        .join('\n');
}

export class AnthropicProvider implements ILLMProvider {
    readonly name = 'anthropic';
    requestId?: string;

    constructor(private model: string, private apiKey: string) {}

    private modelsToTry(): string[] {
        return Array.from(new Set([this.model, ...FALLBACK_MODELS].filter(Boolean)));
    }

    async complete(messages: RuntimeMessage[], tools: ToolDefinition[]): Promise<InternalCompletionResult> {
        const system = extractSystem(messages);
        const chatMsgs = toWireMessages(messages);
        const errors: string[] = [];

        for (const model of this.modelsToTry()) {
            const body: any = { model, max_tokens: 8192, system, messages: chatMsgs };
            if (tools.length > 0) {
                body.tools = toWireTools(tools);
                body.tool_choice = { type: 'auto' };
            }
            const res = await fetch(ENDPOINT, {
                method: 'POST',
                headers: { ...DIRECT_HEADERS, 'x-api-key': this.apiKey },
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                errors.push(`${model}: HTTP ${res.status} ${err?.error?.message ?? ''}`);
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
        throw new Error(`Anthropic completion failed. Tried: ${errors.join(' | ')}`);
    }

    async *stream(messages: RuntimeMessage[]): AsyncGenerator<string> {
        const system = extractSystem(messages);
        const chatMsgs = toWireMessages(messages);
        const errors: string[] = [];

        for (const model of this.modelsToTry()) {
            const res = await fetch(ENDPOINT, {
                method: 'POST',
                headers: { ...DIRECT_HEADERS, 'x-api-key': this.apiKey },
                body: JSON.stringify({ model, max_tokens: 8192, system, messages: chatMsgs, stream: true }),
            });
            if (res.ok) {
                if (model !== this.model) localStorage.setItem('tavro_llm_model_anthropic', model);
                // Native Anthropic SSE: content_block_delta events carry delta.text
                yield* parseSSE(res.body!.getReader(), p => p?.delta?.text ?? '');
                return;
            }
            const err = await res.json().catch(() => ({}));
            errors.push(`${model}: HTTP ${res.status} ${err?.error?.message ?? ''}`);
        }
        throw new Error(`Anthropic stream failed. Tried: ${errors.join(' | ')}`);
    }

    buildToolCallMessage(toolCalls: ToolCallRecord[]): RuntimeMessage {
        return { role: 'assistant', content: null, tool_calls: toolCalls };
    }

    buildToolResultMessage(toolCallId: string, toolName: string, result: string): RuntimeMessage {
        return { role: 'tool', content: result, tool_call_id: toolCallId, name: toolName };
    }
}
