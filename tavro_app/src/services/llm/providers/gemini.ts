import type { ILLMProvider } from './base';
import type { RuntimeMessage, InternalCompletionResult, ToolDefinition, ToolCallRecord } from '../types';
import { parseSSE } from './sse';

function apiUrl(model: string, apiKey: string, streaming: boolean): string {
    const method = streaming ? 'streamGenerateContent' : 'generateContent';
    const extra = streaming ? '&alt=sse' : '';
    return `https://generativelanguage.googleapis.com/v1beta/models/${model}:${method}?key=${apiKey}${extra}`;
}

/**
 * Convert RuntimeMessage[] to Gemini wire format.
 *
 * Gemini uses 'model'/'user' role naming instead of 'assistant'/'user', and
 * represents tool calls as 'functionCall' parts on a 'model' turn and tool
 * results as 'functionResponse' parts on a 'user' turn.
 *
 * Like Anthropic, consecutive tool result RuntimeMessages are batched into
 * a single 'user' turn to avoid Gemini's alternating-role constraint.
 */
function toWireMessages(messages: RuntimeMessage[]): any[] {
    const out: any[] = [];
    for (let i = 0; i < messages.length; i++) {
        const m = messages[i];
        if (m.role === 'system') continue;

        if (m.tool_calls?.length) {
            out.push({
                role: 'model',
                parts: m.tool_calls.map(tc => ({
                    functionCall: { name: tc.name, args: tc.arguments },
                })),
            });
            continue;
        }

        if (m.role === 'tool') {
            const parts: any[] = [];
            let j = i;
            while (j < messages.length && messages[j].role === 'tool') {
                const tr = messages[j];
                let response: any;
                try { response = JSON.parse(tr.content ?? '{}'); } catch { response = { result: tr.content }; }
                parts.push({ functionResponse: { name: tr.name, response } });
                j++;
            }
            out.push({ role: 'user', parts });
            i = j - 1;
            continue;
        }

        out.push({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content ?? '' }],
        });
    }
    return out;
}

function systemInstruction(messages: RuntimeMessage[]): any {
    const parts = messages
        .filter(m => m.role === 'system')
        .map(m => ({ text: m.content ?? '' }));
    return parts.length ? { parts } : undefined;
}

function toWireTools(defs: ToolDefinition[]): any[] {
    if (!defs.length) return [];
    return [{
        functionDeclarations: defs.map(d => ({
            name: d.name,
            description: d.description,
            parameters: d.inputSchema,
        })),
    }];
}

export class GeminiProvider implements ILLMProvider {
    readonly name = 'gemini';

    constructor(private model: string, private apiKey: string) {}

    async complete(messages: RuntimeMessage[], tools: ToolDefinition[]): Promise<InternalCompletionResult> {
        const si = systemInstruction(messages);
        const body: any = {
            contents: toWireMessages(messages),
            generationConfig: { temperature: 0.4, maxOutputTokens: 2048 },
        };
        if (si) body.systemInstruction = si;
        if (tools.length) body.tools = toWireTools(tools);

        const res = await fetch(apiUrl(this.model, this.apiKey, false), {
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
        const fnParts = (content?.parts || []).filter((p: any) => p.functionCall);
        if (fnParts.length) {
            return {
                type: 'tool_calls',
                toolCalls: fnParts.map((p: any, idx: number) => ({
                    id: `call_${p.functionCall.name}_${Date.now()}_${idx}`,
                    name: p.functionCall.name,
                    arguments: p.functionCall.args || {},
                })),
            };
        }
        return {
            type: 'text',
            content: (content?.parts || []).find((p: any) => p.text)?.text || '',
        };
    }

    async *stream(messages: RuntimeMessage[]): AsyncGenerator<string> {
        const si = systemInstruction(messages);
        // Only enable googleSearch grounding when we are NOT in synthesis mode
        // (i.e., no tool results in context). Having function responses in the
        // message history while also requesting googleSearch causes API errors.
        const hasFunctionResults = messages.some(m => m.role === 'tool');
        const body: any = {
            contents: toWireMessages(messages),
            generationConfig: { temperature: 0.4, maxOutputTokens: 1024 },
        };
        if (si) body.systemInstruction = si;
        if (!hasFunctionResults) body.tools = [{ googleSearch: {} }];

        const res = await fetch(apiUrl(this.model, this.apiKey, true), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err?.error?.message ?? `Gemini stream error ${res.status}`);
        }
        yield* parseSSE(
            res.body!.getReader(),
            p => p?.candidates?.[0]?.content?.parts?.[0]?.text ?? '',
        );
    }

    buildToolCallMessage(toolCalls: ToolCallRecord[]): RuntimeMessage {
        return { role: 'assistant', content: null, tool_calls: toolCalls };
    }

    buildToolResultMessage(toolCallId: string, toolName: string, result: string): RuntimeMessage {
        return { role: 'tool', content: result, tool_call_id: toolCallId, name: toolName };
    }
}
