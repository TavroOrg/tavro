import type { LLMConfig, ChatMessage } from '../llmService';
import type { RuntimeMessage, ToolDefinition } from './types';
import type { ToolExecutorFn } from './runtime';
import { createProvider } from './providers/index';
import { buildRuntimeMessages, trimToTokenBudget } from './context';
import { appLogger } from '../logger';

export type { ToolDefinition, ToolExecutorFn };

/**
 * CopilotOrchestrator — sits above the LLM provider as the orchestration layer.
 *
 * Separation of concerns:
 *   CopilotOrchestrator  = session management, tool planning, synthesis direction
 *   LLM provider         = pure reasoning engine (OpenAI / Anthropic / Gemini)
 *   MCP server           = data and actions
 *
 * How it differs from AgentRuntime:
 *   1. Injects orchestration guidance into the system prompt so the LLM treats
 *      itself as a reasoning engine and calls tools proactively.
 *   2. After the tool phase completes, rewrites the system message with an
 *      explicit synthesis directive before the final stream() call — this
 *      prevents the LLM from issuing more tool calls during synthesis and
 *      produces a more coherent, grounded answer.
 *   3. Tracks every tool invoked in the session for auditability and to build
 *      the synthesis directive.
 */
export class CopilotOrchestrator {
    private readonly maxIterations: number;
    private readonly tokenBudget: number;

    constructor({ maxIterations = 8, tokenBudget = 6000 }: { maxIterations?: number; tokenBudget?: number } = {}) {
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
        requestId?: string,
    ): AsyncGenerator<string> {
        const provider = createProvider(cfg);
        if (requestId) provider.requestId = requestId;

        // Extend the system prompt with orchestration guidance.
        // The LLM is told its role explicitly: reason and call tools;
        // a separate synthesis step will follow.
        const orchestrationPrompt = buildOrchestrationPrompt(systemPrompt, toolDefs);

        const context: RuntimeMessage[] = trimToTokenBudget(
            buildRuntimeMessages(orchestrationPrompt, history, userMessage),
            this.tokenBudget,
        );

        if (isSimpleGreeting(userMessage) || isToolInventoryQuestion(userMessage)) {
            const greetingContext = trimToTokenBudget(
                buildRuntimeMessages(systemPrompt, history, userMessage),
                this.tokenBudget,
            );
            yield* provider.stream(greetingContext);
            return;
        }

        // Fast path: no tools — go straight to streaming.
        if (toolDefs.length === 0) {
            yield* provider.stream(context);
            return;
        }

        const executedTools: string[] = [];

        // ── Orchestration phase: tool planning and execution ──────────────────
        let iterCount = 0;
        for (; iterCount < this.maxIterations; iterCount++) {
            const result = await provider.complete(context, toolDefs);
            appLogger.info(`[CopilotOrchestrator] iter=${iterCount + 1} result=${result.type} provider=${cfg.provider}`);

            if (result.type === 'text') {
                if (result.content) {
                    // Model returned a text response — yield it directly.
                    yield result.content;
                    return;
                }
                // complete() returned empty text for any reason — fall through
                // to the synthesis phase so the model gets another chance.
                break;
            }

            if (result.type === 'tool_calls' && result.toolCalls?.length) {
                const names = result.toolCalls.map(tc => tc.name).join(', ');
                appLogger.tool(`[CopilotOrchestrator] dispatching tools: ${names}`);

                // Record the assistant's tool-call decision before executing
                // so the next iteration sees a consistent conversation state.
                context.push(provider.buildToolCallMessage(result.toolCalls));

                // Execute all tools in parallel; capture errors as result strings
                // rather than throwing so the LLM can observe failures and adapt.
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
                    executedTools.push(tc.name);
                    appLogger.tool(`[CopilotOrchestrator] injected result for ${tc.name} (${resultStr.length} chars)`);
                }
                // Continue: LLM will see all injected results and decide whether
                // to call more tools or move to synthesis.
            }
        }

        if (iterCount >= this.maxIterations) {
            appLogger.warn(`[CopilotOrchestrator] maxIterations(${this.maxIterations}) reached — forcing synthesis`);
        }

        // ── Synthesis phase ───────────────────────────────────────────────────
        // Replace the orchestration system prompt with a synthesis-focused one.
        // This signals clearly to the LLM: "stop calling tools, write the answer."
        if (context[0]?.role === 'system') {
            context[0] = {
                role: 'system',
                content: buildSynthesisPrompt(systemPrompt, executedTools),
            };
        }

        if (executedTools.length > 0) {
            // Tools were executed — the context contains tool_use and tool_result
            // messages. Anthropic requires the tools array to be present when
            // tool_result blocks appear in messages. Use complete() so the full
            // schema is sent, and pass the tool defs to satisfy that requirement.
            const synthResult = await provider.complete(context, toolDefs);
            if (synthResult.type === 'text' && synthResult.content) {
                yield synthResult.content;
                return;
            }
        }

        // No tools in context (or synthesis complete() also returned empty) —
        // stream is safe to call without the tools array.
        yield* provider.stream(context);
    }
}

function isSimpleGreeting(message: string): boolean {
    const normalized = message.trim().toLowerCase().replace(/[!.,\s]+$/g, '');
    return /^(hi|hello|hey|hiya|yo|namaste|good morning|good afternoon|good evening)$/.test(normalized);
}

function isToolInventoryQuestion(message: string): boolean {
    const normalized = message.trim().toLowerCase();
    return /\b(what|which|list|show)\b.*\b(tools?|capabilities|actions)\b/.test(normalized)
        || /\btools?\b.*\b(have|available|can use)\b/.test(normalized);
}

// ── Prompt builders ───────────────────────────────────────────────────────────

function buildOrchestrationPrompt(base: string, toolDefs: ToolDefinition[]): string {
    if (toolDefs.length === 0) return base;

    const toolList = toolDefs
        .map(t => {
            const req: string[] = (t.inputSchema?.required ?? []).filter((f: string) => f !== 'original_prompt');
            return `  • ${t.name}${req.length ? ` (required: ${req.join(', ')})` : ''}`;
        })
        .join('\n');

    return `${base}

## Orchestration Instructions
You are the reasoning engine. An orchestration layer manages your session, tool calls, and final synthesis.

### Your role in this phase
- Read the user's request carefully.
- Determine which tool(s) you need to call to gather the required data.
- Call the right tool(s) immediately — do not ask for confirmation, do not explain what you are about to do.
- If the first tool result reveals that another tool call is needed, make it.
- Once you have all necessary data, respond with plain text (no tool calls). The synthesis directive will take over.

### Available tools
${toolList}`;
}

function buildSynthesisPrompt(base: string, executedTools: string[]): string {
    const toolSummary = executedTools.length > 0
        ? `\nThe following tools were called to gather data: ${[...new Set(executedTools)].join(', ')}.`
        : '';

    return `${base}

## Synthesis Instructions${toolSummary}
All required data has been gathered. Write a complete, clear, and well-structured response that:
- Directly answers the user's question using the tool results above.
- Does NOT call any more tools.
- Is written in natural language — do not dump raw JSON or tool output verbatim.
- Highlights the most relevant findings concisely.`;
}

// ── Singleton ────────────────────────────────────────────────────────────────

export const copilotOrchestrator = new CopilotOrchestrator();
