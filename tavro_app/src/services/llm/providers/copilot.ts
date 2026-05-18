import type { ILLMProvider } from './base';
import type { RuntimeMessage, InternalCompletionResult, ToolDefinition, ToolCallRecord } from '../types';

const ENDPOINT = '/copilot-api/chat/complete';

export class CopilotProvider implements ILLMProvider {
    readonly name = 'copilot';

    constructor(private model: string, private apiKey: string) {}

    async complete(messages: RuntimeMessage[], tools: ToolDefinition[]): Promise<InternalCompletionResult> {
        const res = await fetch(ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: this.model, apiKey: this.apiKey, messages }),
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`Copilot SDK proxy error ${res.status}: ${text}`);
        }
        const data = await res.json().catch(() => ({}));
        const content = typeof data.content === 'string' ? data.content : '';
        if (!content.trim()) {
            throw new Error('Copilot SDK proxy returned empty content.');
        }
        return { type: 'text', content };
    }

    async *stream(messages: RuntimeMessage[]): AsyncGenerator<string> {
        const res = await fetch(ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: this.model, apiKey: this.apiKey, messages }),
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`Copilot SDK proxy error ${res.status}: ${text}`);
        }
        const data = await res.json().catch(() => ({}));
        const content = typeof data.content === 'string' ? data.content : '';
        if (!content.trim()) {
            throw new Error('Copilot SDK proxy returned empty content.');
        }
        yield content;
    }

    buildToolCallMessage(toolCalls: ToolCallRecord[]): RuntimeMessage {
        return { role: 'assistant', content: null, tool_calls: toolCalls };
    }

    buildToolResultMessage(toolCallId: string, toolName: string, result: string): RuntimeMessage {
        return { role: 'tool', content: result, tool_call_id: toolCallId, name: toolName };
    }
}
