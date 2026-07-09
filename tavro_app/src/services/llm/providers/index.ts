import type { LLMConfig } from '../../llmService';
// Unused (dead code) — only 'copilot' is a supported top-level provider today.
// import { OpenAIProvider } from './openai';
// import { AnthropicProvider } from './anthropic';
// import { GeminiProvider } from './gemini';
import { CopilotProvider } from './copilot';

export type { ILLMProvider } from './base';

export function createProvider(cfg: LLMConfig) {
    switch (cfg.provider) {
        // Unused (dead code) — only Copilot (and its BYOK sub-providers) is supported.
        // case 'openai':    return new OpenAIProvider(cfg.model, cfg.apiKey);
        // case 'anthropic': return new AnthropicProvider(cfg.model, cfg.apiKey);
        // case 'gemini':    return new GeminiProvider(cfg.model, cfg.apiKey);
        case 'copilot':   return new CopilotProvider(cfg.model, cfg.apiKey, cfg.byok);
        default:          throw new Error(`Unknown LLM provider: ${(cfg as any).provider}`);
    }
}
