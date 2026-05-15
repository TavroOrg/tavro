import type { LLMConfig } from '../../llmService';
import { OpenAIProvider } from './openai';
import { AnthropicProvider } from './anthropic';
import { GeminiProvider } from './gemini';

export type { ILLMProvider } from './base';

export function createProvider(cfg: LLMConfig) {
    switch (cfg.provider) {
        case 'openai':    return new OpenAIProvider(cfg.model, cfg.apiKey);
        case 'anthropic': return new AnthropicProvider(cfg.model, cfg.apiKey);
        case 'gemini':    return new GeminiProvider(cfg.model, cfg.apiKey);
        default:          throw new Error(`Unknown LLM provider: ${(cfg as any).provider}`);
    }
}
