// ── src/types/playground.ts ───────────────────────────────────────────────────

export type InfraProvider =
  | 'claude'          // Anthropic API direct — works today, no cloud setup needed
  | 'azure_foundry'   // Azure AI Foundry Agent Service
  | 'aws_bedrock';    // AWS Bedrock

export interface InfraProviderMeta {
  id:          InfraProvider;
  label:       string;
  shortLabel:  string;
  description: string;
  available:   boolean;   // false = coming soon, UI shows disabled state
  icon:        string;    // emoji used as icon placeholder
  configKeys:  string[];  // env/settings keys needed to activate
}

export const INFRA_PROVIDERS: InfraProviderMeta[] = [
  {
    id:          'claude',
    label:       'Claude (Anthropic)',
    shortLabel:  'Claude',
    description: 'Direct Anthropic API. No cloud setup required — works immediately with your existing API key.',
    available:   true,
    icon:        '🤖',
    configKeys:  ['ANTHROPIC_API_KEY'],
  },
  {
    id:          'azure_foundry',
    label:       'Azure AI Foundry',
    shortLabel:  'Azure',
    description: 'Azure AI Agent Service with GPT-4o, Phi-4, and custom tool calling. Ideal for M365 environments.',
    available:   true,
    icon:        '☁️',
    configKeys:  ['AZURE_AI_FOUNDRY_ENDPOINT', 'AZURE_AI_FOUNDRY_KEY'],
  },
  {
    id:          'aws_bedrock',
    label:       'AWS Bedrock',
    shortLabel:  'AWS',
    description: 'Amazon Bedrock with Claude 3, Llama, Mistral, and other models. Easy access to foundation models via AWS.',
    available:   true,
    icon:        '🔶',
    configKeys:  ['BEDROCK_ACCESS_KEY', 'BEDROCK_SECRET_KEY', 'BEDROCK_REGION'],
  },
];

// ── Agent prototype configuration ────────────────────────────────────────────

export interface AgentTool {
  id:          string;
  name:        string;
  description: string;
  enabled:     boolean;
  source:      'mcp' | 'builtin' | 'custom';
}

export const BUILTIN_TOOLS: AgentTool[] = [
  { id: 'web_search',        name: 'Web search',          description: 'Search the public web for current information', enabled: false, source: 'builtin' },
  { id: 'code_interpreter',  name: 'Code interpreter',     description: 'Execute Python for data analysis and calculations', enabled: false, source: 'builtin' },
  { id: 'file_search',       name: 'File / document search', description: 'Search uploaded documents and knowledge bases', enabled: false, source: 'builtin' },
  { id: 'blueprint_context', name: 'Company Blueprint',    description: 'Read company blueprint dimensions as context', enabled: true, source: 'mcp' },
];

export interface PlaygroundConfig {
  // Source
  useCaseId:    string;
  useCaseTitle: string;

  // Infrastructure
  provider:     InfraProvider;
  model:        string;

  // Agent identity
  agentName:    string;
  systemPrompt: string;

  // Capability
  tools:        AgentTool[];
  temperature:  number;   // 0.0 – 1.0
  maxTokens:    number;

  // Blueprint context
  companyId?:   string;
  companyName?: string;

  // Agent type (drives Code tab visibility)
  agentType?:   string;
}

export interface PlaygroundMessage {
  id:        string;
  role:      'user' | 'assistant' | 'system';
  content:   string;
  timestamp: Date;
  streaming?: boolean;
  tokens?:   number;
}

export interface PlaygroundObservation {
  id:        string;
  type:      'gap' | 'works_well' | 'needs_info' | 'unexpected' | 'note';
  content:   string;
  messageId?: string;
  createdAt: Date;
}

export const OBSERVATION_TYPES: Record<PlaygroundObservation['type'], { label: string; color: string; bg: string }> = {
  gap:        { label: 'Gap found',         color: 'text-rose-700 dark:text-rose-300',    bg: 'bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-800' },
  works_well: { label: 'Works well',        color: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800' },
  needs_info: { label: 'Needs information', color: 'text-amber-700 dark:text-amber-300',  bg: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800' },
  unexpected: { label: 'Unexpected',        color: 'text-violet-700 dark:text-violet-300', bg: 'bg-violet-50 dark:bg-violet-900/20 border-violet-200 dark:border-violet-800' },
  note:       { label: 'Note',              color: 'text-slate-700 dark:text-slate-300',  bg: 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700' },
};

// ── Model options per provider ────────────────────────────────────────────────

export const PROVIDER_MODELS: Record<InfraProvider, string[]> = {
  claude:        ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5-20251001'],
  azure_foundry: ['gpt-4o', 'gpt-4o-mini', 'phi-4'],
  aws_bedrock:   ['gpt-oss-120b', 'gpt-oss-20b', 'gpt-oss-safeguard-120b'],
};