import type { LLMConfig, ChatMessage } from '../llmService';
import type { RuntimeMessage, ToolDefinition } from './types';
import { createProvider } from './providers/index';
import { buildRuntimeMessages, trimToTokenBudget } from './context';
import { appLogger } from '../logger';

export type { ToolDefinition };

export interface AgentRuntimeOptions {
    /**
     * Maximum agent loop iterations before forcing a final synthesis call.
     * Each iteration is one complete() call; the final stream() call is additional.
     * Default: 8.
     */
    maxIterations?: number;
    /**
     * Estimated token budget for the assembled context window.
     * Older history messages are trimmed when this is exceeded.
     * Default: 6000 (~24k characters).
     */
    tokenBudget?: number;
}

/**
 * Callback signature for tool execution.
 * Returns the raw tool result (any JSON-serialisable value) or throws.
 */
export type ToolExecutorFn = (
    name: string,
    args: Record<string, any>,
    originalPrompt: string,
) => Promise<any>;

/**
 * AgentRuntime — the core agent loop.
 *
 * WHY this class exists: the previous architecture called completeChat() once,
 * executed tools if requested, then immediately yielded the raw tool output to
 * the UI. The LLM never saw its own tool results, so it could not synthesize
 * a coherent answer, explain what it found, or decide whether to call more tools.
 *
 * The loop here is:
 *   1. complete(context, tools)         — tool-aware, non-streaming
 *   2a. type === 'tool_calls'           → execute tools, inject results, go to 1
 *   2b. type === 'text'                 → switch to stream(context) for the final answer
 *
 * After all tool results are injected into context, the streaming synthesis call
 * at step 2b gives the LLM full visibility over what each tool returned, enabling
 * it to write a coherent, contextualised response instead of dumping raw JSON.
 *
 * The stream() call is intentionally made WITHOUT tool definitions — at the
 * synthesis step we want prose, not more tool calls.
 */
export class AgentRuntime {
    private readonly maxIterations: number;
    private readonly tokenBudget: number;

    constructor({ maxIterations = 8, tokenBudget = 6000 }: AgentRuntimeOptions = {}) {
        this.maxIterations = maxIterations;
        this.tokenBudget = tokenBudget;
    }

    async *run(
        systemPrompt: string,
        history: ChatMessage[],
        userMessage: string,
        toolDefs: ToolDefinition[],
        cfg: LLMConfig,
        executeTool: ToolExecutorFn,
    ): AsyncGenerator<string> {
        const provider = createProvider(cfg);

        const context: RuntimeMessage[] = trimToTokenBudget(
            buildRuntimeMessages(systemPrompt, history, userMessage),
            this.tokenBudget,
        );

        // Fast path: no tools available — go directly to streaming.
        if (toolDefs.length === 0) {
            yield* provider.stream(context);
            return;
        }

        for (let iter = 0; iter < this.maxIterations; iter++) {
            const result = await provider.complete(context, toolDefs);
            appLogger.info(`[AgentRuntime] iter=${iter + 1} result=${result.type} provider=${cfg.provider}`);

            if (result.type === 'text') {
                // The LLM has finished reasoning. Stream the final answer so the UI
                // renders tokens progressively — tool results are already in context
                // so the LLM can produce a fully grounded synthesis.
                yield* provider.stream(context);
                return;
            }

            if (result.type === 'tool_calls' && result.toolCalls?.length) {
                const names = result.toolCalls.map(tc => tc.name).join(', ');
                appLogger.tool(`[AgentRuntime] executing tools: ${names}`);

                // Record the assistant's decision in context before executing,
                // so the next complete() call sees an accurate conversation state.
                context.push(provider.buildToolCallMessage(result.toolCalls));

                // Execute tools. Parallel execution is preferred; individual errors
                // are captured as { error } objects rather than thrown so the agent
                // loop continues and the LLM can observe the failure and adapt.
                const settled = await Promise.allSettled(
                    result.toolCalls.map(tc =>
                        executeTool(tc.name, tc.arguments, userMessage)
                            .then(r => ({ tc, r, err: undefined as string | undefined }))
                            .catch(e => ({ tc, r: undefined, err: e?.message ?? String(e) })),
                    ),
                );

                for (const s of settled) {
                    const { tc, r, err } =
                        s.status === 'fulfilled'
                            ? s.value
                            : { tc: null, r: undefined, err: String(s.reason) };
                    if (!tc) continue;

                    const resultStr = err
                        ? `Error: ${err}`
                        : typeof r === 'string'
                            ? r
                            : JSON.stringify(r ?? null);

                    context.push(provider.buildToolResultMessage(tc.id, tc.name, resultStr));
                    appLogger.tool(`[AgentRuntime] injected result for ${tc.name} (${resultStr.length} chars)`);
                }
                // Loop: the LLM will now see all tool results and either call more
                // tools or produce its final text response.
            }
        }

        // maxIterations exhausted — force a synthesis pass over whatever accumulated
        // context exists so the user always receives a response.
        appLogger.warn(`[AgentRuntime] maxIterations(${this.maxIterations}) reached — forcing final synthesis`);
        yield* provider.stream(context);
    }
}

/** Shared singleton — import this in mcpClient and any future orchestration code. */
export const agentRuntime = new AgentRuntime();
