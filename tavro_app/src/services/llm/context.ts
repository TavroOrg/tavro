import type { RuntimeMessage } from './types';
import type { ChatMessage } from '../llmService';

// Rough heuristic: 1 token ≈ 4 characters for English text.
const CHARS_PER_TOKEN = 4;

export function estimateTokens(messages: RuntimeMessage[]): number {
    return messages.reduce((sum, m) => {
        const text = m.content != null
            ? (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))
            : '';
        return sum + Math.ceil(text.length / CHARS_PER_TOKEN);
    }, 0);
}

/**
 * Assemble the initial RuntimeMessage context from a system prompt, chat history,
 * and the current user message. This is the canonical entry point for all runtime
 * turns; providers translate this format to their own wire format.
 */
export function buildRuntimeMessages(
    systemPrompt: string,
    history: ChatMessage[],
    userMessage: string,
): RuntimeMessage[] {
    return [
        { role: 'system', content: systemPrompt },
        ...history.map(m => ({ role: m.role as RuntimeMessage['role'], content: m.content })),
        { role: 'user', content: userMessage },
    ];
}

/**
 * Trim the oldest non-system messages so the context fits within tokenBudget.
 *
 * WHY: Without a token budget, long conversations bloat context, inflate cost,
 * and eventually hit provider limits. The system prompt and the most recent
 * messages are always preserved; older mid-conversation turns are dropped first.
 * The last user message is never dropped — it would make no sense to call the
 * LLM without a question.
 */
export function trimToTokenBudget(
    messages: RuntimeMessage[],
    tokenBudget: number,
): RuntimeMessage[] {
    if (estimateTokens(messages) <= tokenBudget) return messages;

    const system = messages.filter(m => m.role === 'system');
    const rest = messages.filter(m => m.role !== 'system');
    const systemTokens = estimateTokens(system);
    let remaining = tokenBudget - systemTokens;

    // Walk backwards (newest first) keeping messages that fit.
    // Always keep at least the most recent message even if it exceeds the budget.
    const kept: RuntimeMessage[] = [];
    for (let i = rest.length - 1; i >= 0; i--) {
        const m = rest[i];
        const text = m.content != null
            ? (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))
            : '';
        const tokens = Math.ceil(text.length / CHARS_PER_TOKEN);
        if (remaining - tokens < 0 && kept.length > 0) break;
        kept.unshift(m);
        remaining -= tokens;
    }

    return [...system, ...kept];
}
