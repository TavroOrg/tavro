import type { RuntimeMessage, InternalCompletionResult, ToolDefinition, ToolCallRecord } from '../types';

/**
 * Provider capability interface.
 *
 * WHY: The existing llmService.ts functions are transport-focused (one function per
 * provider per mode). ILLMProvider is capability-focused: each provider owns the full
 * lifecycle of a turn — both non-streaming (for tool-call detection in the agent loop)
 * and streaming (for the final synthesis step), plus the message-building utilities
 * that encode tool calls and results into each provider's native wire format.
 *
 * This separation is what makes multi-step tool injection possible: the runtime asks
 * the provider how to represent "assistant called tools" and "tool returned results"
 * without knowing anything about the provider's wire format.
 */
export interface ILLMProvider {
    readonly name: string;

    /** Non-streaming, tool-aware completion — used for every agent loop iteration. */
    complete(messages: RuntimeMessage[], tools: ToolDefinition[]): Promise<InternalCompletionResult>;

    /**
     * Streaming completion — used only for the final synthesis turn.
     * Tools are intentionally NOT passed: after all MCP results are injected into
     * context, we want the LLM to synthesize, not call more tools.
     */
    stream(messages: RuntimeMessage[]): AsyncGenerator<string>;

    /** Builds the assistant message that records a multi-tool decision in context. */
    buildToolCallMessage(toolCalls: ToolCallRecord[]): RuntimeMessage;

    /** Builds the result message to inject after executing a tool. */
    buildToolResultMessage(toolCallId: string, toolName: string, result: string): RuntimeMessage;
}
