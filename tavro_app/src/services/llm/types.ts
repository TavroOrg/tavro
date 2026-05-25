// Internal runtime types for the agent loop and provider adapters.
//
// Provider-facing API types that consumers (ChatPanel, Settings, mcpClient) already
// depend on — LLMConfig, LLMProvider, ChatMessage, ToolCall, CompletionResult — live
// in llmService.ts and are intentionally left there for backwards compatibility.

/** The canonical internal message format shared by all provider adapters. */
export interface RuntimeMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    /** Tool calls issued by the assistant in this turn — present on assistant messages only */
    tool_calls?: ToolCallRecord[];
    /** References the id from tool_calls — present on 'tool' role messages only */
    tool_call_id?: string;
    /** Tool name — required by some providers in tool result messages */
    name?: string;
}

export interface ToolCallRecord {
    id: string;
    name: string;
    arguments: Record<string, any>;
}

/** Normalised tool definition; each provider converts this to its wire format. */
export interface ToolDefinition {
    name: string;
    description: string;
    inputSchema: Record<string, any>;
}

export type CompletionResultType = 'text' | 'tool_calls';

/** Result returned by ILLMProvider.complete() — used internally by AgentRuntime. */
export interface InternalCompletionResult {
    type: CompletionResultType;
    content?: string;
    toolCalls?: ToolCallRecord[];
}
