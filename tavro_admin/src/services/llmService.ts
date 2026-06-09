export type LLMProvider = 'github_copilot' | 'openai' | 'azure_openai' | 'anthropic';

export const PROVIDER_LABELS: Record<LLMProvider, string> = {
    github_copilot: 'GitHub Copilot',
    openai:         'OpenAI',
    azure_openai:   'Azure OpenAI / Azure AI Foundry',
    anthropic:      'Anthropic (Claude)',
};

export const PROVIDER_HINTS: Record<LLMProvider, string> = {
    github_copilot: 'requires subscription',
    openai:         'api.openai.com',
    azure_openai:   'your-resource.openai.azure.com',
    anthropic:      'api.anthropic.com',
};
