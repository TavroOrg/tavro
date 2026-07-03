// Ã¢â€â‚¬Ã¢â€â‚¬ src/services/buildSystemPrompt.ts Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// Assembles a context-aware system prompt for the chat LLM.
// Called by mcpClient.chat() before each API call.
// The prompt changes based on what the user is currently viewing.

import type { ViewType, ViewData, BlueprintContext, AgentDetailContext, UseCaseDetailContext } from '../context/ChatContext';
import type { DataHubSearchResponse } from '../types/datahubContext';

// Ã¢â€â‚¬Ã¢â€â‚¬ Shared base instructions Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

const BASE = `You are Tavro AI Assistant - an intelligent assistant embedded in Tavro,
an enterprise AI governance and operations platform.
You are concise, specific, and grounded in the context provided.
Never make up data. If you don't know something, say so and suggest where to find it.
Format responses clearly using bullet points and bold text where helpful.`;

// Ã¢â€â‚¬Ã¢â€â‚¬ Context-specific instructions Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

function blueprintSection(data: BlueprintContext): string {
  const dimList = data.dimensions
    .map(d => `  - [${d.category}] ${d.label}${d.summary ? ': ' + d.summary : ''}`)
    .join('\n');

  const edgeList = data.edges?.length
    ? data.edges.map(e => `  - ${e.sourceLabel} -[${e.relType}]-> ${e.targetLabel}`).join('\n')
    : '  No relationships defined yet.';

  const activeSection = data.activeDimension
    ? `\nThe user is currently viewing this dimension:
  Label: ${data.activeDimension.label}
  Category: ${data.activeDimension.category}
  ${data.activeDimension.summary ? 'Summary: ' + data.activeDimension.summary : ''}`
    : '';

  return `
## Company Blueprint Context
Company: ${data.companyName}
Industry: ${data.industry}
Region: ${data.region}
${activeSection}

## Current Blueprint Dimensions (${data.dimensions.length} total)
${dimList || '  No dimensions defined yet.'}

## Dimension Relationships (dim_edge)
${edgeList}

## Your role in Blueprint mode
- Help the user understand, refine, and extend their company blueprint
- Suggest missing dimensions based on the company's industry
- Explain relationships between dimensions using the edges above
- Help draft summaries for new dimensions
- Answer questions about specific dimensions and how they connect
- Suggest AI use cases grounded in the blueprint dimensions and their relationships`;
}

function agentDetailSection(data: AgentDetailContext): string {
  const fields = Object.entries(data)
    .filter(([k]) => !['agentId'].includes(k))
    .map(([k, v]) => `  ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join('\n');

  return `
## Agent Context
The user is viewing a specific agent:
${fields}

## Your role in Agent Detail mode
- Answer questions about this specific agent
- Analyse its risk level, configuration, and use cases
- Compare it to best practices for AI agents in this context
- Suggest improvements or flag concerns
- The company blueprint may provide additional context about the business environment`;
}

function useCaseDetailSection(data: UseCaseDetailContext): string {
  const fields = Object.entries(data)
    .filter(([k]) => !['useCaseId'].includes(k))
    .map(([k, v]) => `  ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join('\n');

  return `
## AI Use Case Context
The user is viewing a specific use case:
${fields}

## Your role in Use Case Detail mode
- Answer questions about this use case
- Assess feasibility, risk, and business value
- Suggest agents or approaches to implement it
- Identify dependencies and prerequisites
- The company blueprint provides the business context for this use case`;
}

function catalogSection(viewType: 'agent_catalog' | 'use_case_catalog'): string {
  if (viewType === 'agent_catalog') {
    return `
## Your role in Agent Catalog mode
- Help the user understand the overall agent landscape
- Compare agents, identify gaps, highlight high-risk agents
- Suggest new agents based on the company blueprint
- Answer questions about agent lifecycle and governance`;
  }
  return `
## Your role in Use Case Catalog mode
- Help the user understand the portfolio of AI use cases
- Prioritise use cases by business value and feasibility
- Identify gaps and suggest new use cases
- Answer questions about use case status and progress`;
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Blueprint context block (appended to non-blueprint views) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// When a user is NOT in blueprint mode, we still want to inject a summary
// of the company context if it's available in the session.

function compactBlueprintBlock(data: BlueprintContext): string {
  const topDims = data.dimensions.slice(0, 12)
    .map(d => `${d.category}: ${d.label}`)
    .join(', ');
  const topEdges = data.edges?.slice(0, 8)
    .map(e => `${e.sourceLabel} -[${e.relType}]-> ${e.targetLabel}`)
    .join(', ');
  return `
## Company Blueprint (background context)
Company: ${data.companyName} | Industry: ${data.industry} | Region: ${data.region}
Key dimensions: ${topDims || 'none defined yet'}${topEdges ? `\nKey relationships: ${topEdges}` : ''}`;
}

// Ã¢â€â‚¬Ã¢â€â‚¬ DataHub PGVector search results (per-turn, query-scoped) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// Built from a direct semantic search against twin.datahub_context run for
// THIS turn's user message - never the full catalog, never a capped snapshot.
// Omitted entirely when the search found nothing relevant to the query.

function relevantDataHubBlock(data: DataHubSearchResponse): string {
  if (!data.results.length) return '';
  const entryList = data.results
    .map(r => `  - [${r.entity_type ?? 'dataset'}] ${r.label}${r.schema ? ` (schema: ${r.schema})` : ''}${r.vendor ? ` - vendor: ${r.vendor}` : ''}${r.application ? ` - application: ${r.application}` : ''}\n    ${r.chunk_text.replace(/\n/g, '\n    ')}`)
    .join('\n');
  const mode = data.mode === 'exact' ? 'exact metadata filter' : 'semantic search';
  const total = data.total && data.total !== data.count ? ` Showing ${data.count} of ${data.total} matching assets.` : '';

  return `
## DataHub Metadata - relevant to this message (${mode}, query: "${data.query}")
The following DataHub assets were retrieved live from twin.datahub_context for this message.${total} If the user asks to show or list these assets, answer from the rows below directly. Do not say PolicyCenter/DataHub metadata is unavailable when rows are listed here. Ground any statement about tables, columns, schemas, vendors, or applications strictly in these entries. Never invent asset names beyond what is listed here. If what the user needs is not here, say the current DataHub context does not show it.
${entryList}`;
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Main export Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

export function buildSystemPrompt(
  viewType: ViewType,
  viewData: ViewData,
  /** Pass the blueprint context from BlueprintContext if available */
  blueprintCtx?: BlueprintContext | null,
  /** Results of a per-turn DataHub semantic search scoped to the current user message */
  datahubResults?: DataHubSearchResponse | null,
): string {
  const parts: string[] = [BASE];
  if (datahubResults) parts.push(relevantDataHubBlock(datahubResults));

  switch (viewType) {
    case 'blueprint':
      if (viewData && 'companyId' in viewData) {
        parts.push(blueprintSection(viewData as BlueprintContext));
      }
      break;

    case 'agent_detail':
      if (viewData && 'agentId' in viewData) {
        parts.push(agentDetailSection(viewData as AgentDetailContext));
      }
      if (blueprintCtx) parts.push(compactBlueprintBlock(blueprintCtx));
      break;

    case 'use_case_detail':
      if (viewData && 'useCaseId' in viewData) {
        parts.push(useCaseDetailSection(viewData as UseCaseDetailContext));
      }
      if (blueprintCtx) parts.push(compactBlueprintBlock(blueprintCtx));
      break;

    case 'agent_catalog':
    case 'use_case_catalog':
      parts.push(catalogSection(viewType));
      if (blueprintCtx) parts.push(compactBlueprintBlock(blueprintCtx));
      break;

    default:
      parts.push(`
## Your role
Help the user navigate Tavro. You can discuss AI use cases, agents,
risk assessments, and company blueprints.`);
      if (blueprintCtx) parts.push(compactBlueprintBlock(blueprintCtx));
  }

  return parts.join('\n');
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Suggested prompts per view Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

export function getSuggestedPrompts(viewType: ViewType, viewData: ViewData): string[] {
  switch (viewType) {
    case 'blueprint':
      const bpData = viewData as BlueprintContext | null;
      if (bpData?.activeDimension) {
        return [
          `Explain the ${bpData.activeDimension.label} dimension`,
          `What risks are linked to ${bpData.activeDimension.label}?`,
          `Suggest related dimensions for ${bpData.activeDimension.label}`,
          `Draft a summary for ${bpData.activeDimension.label}`,
        ];
      }
      return [
        'What dimensions am I missing for my industry?',
        'Suggest AI use cases based on my blueprint',
        'Which dimensions have the highest risk exposure?',
        'How do my strategy and risk dimensions connect?',
      ];

    case 'agent_detail':
      const agentData = viewData as AgentDetailContext | null;
      return [
        agentData ? `Summarise the ${agentData.agentName} agent` : 'Summarise this agent',
        'What is the risk level and why?',
        'How does this agent connect to our blueprint?',
        'What use cases does this agent support?',
      ];

    case 'use_case_detail':
      const ucData = viewData as UseCaseDetailContext | null;
      return [
        ucData ? `Overview of ${ucData.title}` : 'Overview of this use case',
        'Which agents are needed to implement this?',
        'What is the business impact?',
        'What risks should I consider?',
      ];

    case 'agent_catalog':
      return [
        'Which agents are high risk?',
        'Show me agents without use cases',
        'Suggest new agents based on our blueprint',
        'Which agents need review?',
      ];

    case 'use_case_catalog':
      return [
        'Which use cases are highest priority?',
        'What use cases are in progress?',
        'Suggest use cases we are missing',
        'Which use cases have no assigned agents?',
      ];

    default:
      return [
        'What can you help me with?',
        'Show me high-risk agents',
        'What AI use cases should we prioritise?',
        'How complete is our company blueprint?',
      ];
  }
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Context badge label Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// Shown in the chat header so users know what context the chat is grounded in.

export function getContextBadge(viewType: ViewType, viewData: ViewData): string | null {
  switch (viewType) {
    case 'blueprint':
      const bp = viewData as BlueprintContext | null;
      if (bp?.activeDimension) return bp.activeDimension.label;
      if (bp) return `${bp.companyName} Blueprint`;
      return 'Blueprint';
    case 'agent_detail':
      const ag = viewData as AgentDetailContext | null;
      return ag ? ag.agentName : 'Agent';
    case 'use_case_detail':
      const uc = viewData as UseCaseDetailContext | null;
      return uc ? uc.title : 'Use Case';
    case 'agent_catalog':    return 'Agent Catalog';
    case 'use_case_catalog': return 'Use Case Catalog';
    default:                 return null;
  }
}
