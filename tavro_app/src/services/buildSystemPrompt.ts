// ── src/services/buildSystemPrompt.ts ────────────────────────────────────────
// Assembles a context-aware system prompt for the chat LLM.
// Called by mcpClient.chat() before each API call.
// The prompt changes based on what the user is currently viewing.

import type { ViewType, ViewData, BlueprintContext, AgentDetailContext, UseCaseDetailContext } from '../context/ChatContext';
import { detectArtifacts } from '../utils/artifactDetector';
import { buildArtifactSystemInstruction } from '../utils/artifactTemplates';

// ── Shared base instructions ──────────────────────────────────────────────────

const BASE = `You are Tavro AI Assistant — an intelligent assistant embedded in Tavro,
an enterprise AI governance and operations platform.
You are concise, specific, and grounded in the context provided.
Never make up data. If you don't know something, say so and suggest where to find it.
Format responses clearly using bullet points and bold text where helpful.`;

// ── Context-specific instructions ─────────────────────────────────────────────

function blueprintSection(data: BlueprintContext): string {
  const dimList = data.dimensions
    .map(d => `  • [${d.category}] ${d.label}${d.summary ? ': ' + d.summary : ''}`)
    .join('\n');

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

## Your role in Blueprint mode
- Help the user understand, refine, and extend their company blueprint
- Suggest missing dimensions based on the company's industry
- Explain relationships between dimensions
- Help draft summaries for new dimensions
- Answer questions about specific dimensions
- Suggest AI use cases grounded in the blueprint dimensions`;
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

// ── Blueprint context block (appended to non-blueprint views) ─────────────────
// When a user is NOT in blueprint mode, we still want to inject a summary
// of the company context if it's available in the session.

function compactBlueprintBlock(data: BlueprintContext): string {
  const topDims = data.dimensions.slice(0, 12)
    .map(d => `${d.category}: ${d.label}`)
    .join(', ');
  return `
## Company Blueprint (background context)
Company: ${data.companyName} | Industry: ${data.industry} | Region: ${data.region}
Key dimensions: ${topDims || 'none defined yet'}`;
}

// ── Main export ───────────────────────────────────────────────────────────────

export function buildSystemPrompt(
  viewType: ViewType,
  viewData: ViewData,
  /** Pass the blueprint context from BlueprintContext if available */
  blueprintCtx?: BlueprintContext | null,
  /** The current user message — used to detect structured artifact intent */
  userMessage?: string,
): string {
  const parts: string[] = [BASE];

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

  // When the user is requesting structured project artifacts, inject the
  // document-generation instructions. This is done after the view-specific
  // sections so artifact instructions always appear at the end of the prompt.
  if (userMessage) {
    const artifacts = detectArtifacts(userMessage);
    if (artifacts.length > 0) {
      parts.push(buildArtifactSystemInstruction(artifacts, blueprintCtx));
    }
  }

  return parts.join('\n');
}

// ── Suggested prompts per view ────────────────────────────────────────────────

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

// ── Context badge label ───────────────────────────────────────────────────────
// Shown in the chat header so users know what context the chat is grounded in.

export function getContextBadge(viewType: ViewType, viewData: ViewData): string | null {
  switch (viewType) {
    case 'blueprint':
      const bp = viewData as BlueprintContext | null;
      if (bp?.activeDimension) return `📌 ${bp.activeDimension.label}`;
      if (bp) return `🏢 ${bp.companyName} Blueprint`;
      return '🏗 Blueprint';
    case 'agent_detail':
      const ag = viewData as AgentDetailContext | null;
      return ag ? `🤖 ${ag.agentName}` : '🤖 Agent';
    case 'use_case_detail':
      const uc = viewData as UseCaseDetailContext | null;
      return uc ? `💡 ${uc.title}` : '💡 Use Case';
    case 'agent_catalog':    return '📋 Agent Catalog';
    case 'use_case_catalog': return '📋 Use Case Catalog';
    default:                 return null;
  }
}
