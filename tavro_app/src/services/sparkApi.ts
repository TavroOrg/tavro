import type { SparkIdea, SparkConvertRequest } from '../types/spark';
import { appLogger } from './logger';
import { portalActivity } from './portalActivity';

const BASE = import.meta.env.VITE_TWIN_API_URL ?? '';
const V1 = `${BASE}/api/v1`;

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('tavro_access_token');
  const tenantId = localStorage.getItem('tavro_tenant_id');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(tenantId ? { 'x-tenant-id': tenantId } : {}),
  };
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${V1}${path}`, {
    ...init,
    headers: {
      ...authHeaders(),
      ...(init.headers ?? {}),
      'Cache-Control': 'no-cache',
    },
  });
  if (!res.ok) {
    const body = await res.text();
    const isHtml = body.trimStart().startsWith('<');
    const message = isHtml
      ? res.status === 504
        ? 'The request timed out. Please try again.'
        : `Unexpected error (${res.status}). Please try again.`
      : body.slice(0, 250);
    throw new Error(`API ${res.status}: ${message}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export interface UseCaseFields {
  title: string;
  description: string;
  business_problem_statement: string;
  expected_benefits: string;
  priority: string;
  solution_approach?: string;
  executive_summary?: string;
  assumptions?: string;
  quantified_financial_benefits?: string;
  total_financial_impact_summary?: string;
  implementation_cost_estimate?: string;
  return_on_investment?: string;
  risk_considerations?: string;
  implementation_roadmap?: string;
  recommendation?: string;
}

class SparkApi {
  /** Load stored ideas for a company (no generation). */
  async getIdeas(companyId: string, search?: string): Promise<SparkIdea[]> {
    const params = new URLSearchParams({ company_id: companyId });
    if (search && search.trim()) params.set('search', search.trim());
    const path = `/spark/ideas?${params.toString()}`;
    appLogger.req('Spark getIdeas', { companyId, search });
    const t0 = Date.now();
    const result = await req<SparkIdea[]>(path);
    appLogger.res('Spark getIdeas', { count: result.length }, Date.now() - t0);
    return result;
  }

  /**
   * Stream fresh ideas via SSE — yields each SparkIdea as it arrives.
   *
   * Flow:
   *  1. GET /spark/context (Python — DB context: candidates or company nodes + edges)
   *  2. POST /copilot-api/spark/generate/stream (copilot server — same AI infra as AI Assistant)
   *  3. POST /spark/ideas/batch (Python — persist ideas to DB)
   */
  async *generateIdeasStream(
    companyId: string,
    dimensions?: string[],
    direction?: string,
    ideaCount?: number,
    companyName?: string,
    industry?: string,
    region?: string,
  ): AsyncGenerator<SparkIdea> {
    appLogger.req('Spark generateIdeasStream', { companyId, dimensions, direction: direction ?? '(none)', ideaCount });
    const t0 = Date.now();

    // Step 1: fetch DB context (candidates / company nodes / edges)
    const ctxParams = new URLSearchParams({ company_id: companyId });
    if (dimensions && dimensions.length > 0) ctxParams.set('dimensions', dimensions.join(','));
    if (direction && direction.trim()) ctxParams.set('direction', direction.trim());
    if (ideaCount) ctxParams.set('idea_count', String(ideaCount));

    const ctxRes = await fetch(`${V1}/spark/context?${ctxParams}`, {
      headers: authHeaders(),
    });
    if (!ctxRes.ok) {
      const body = await ctxRes.text();
      throw new Error(`Spark context fetch failed (${ctxRes.status}): ${body.slice(0, 200)}`);
    }
    const context = await ctxRes.json();

    // Step 2: stream ideas through the copilot server (same AI infrastructure as AI Assistant)
    const streamRes = await fetch('/copilot-api/spark/generate/stream', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        mode: context.mode,
        candidates: context.candidates,
        companyNodes: context.company_nodes,
        direction: direction?.trim() || null,
        companyName: companyName?.trim() || null,
        industry: industry?.trim() || null,
        region: region?.trim() || null,
        edges: context.edges,
        ideaCount: ideaCount ?? 5,
        similarAgents: context.similar_agents,
      }),
    });

    if (!streamRes.ok || !streamRes.body) {
      const body = await streamRes.text().catch(() => '');
      const isHtml = body.trimStart().startsWith('<');
      const message = isHtml
        ? streamRes.status === 504
          ? 'The request timed out. Please try again.'
          : `Unexpected error (${streamRes.status}). Please try again.`
        : body.slice(0, 250);
      throw new Error(`Spark stream failed: ${message}`);
    }

    const reader = streamRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let lastEvent = '';
    const ideas: SparkIdea[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          lastEvent = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          const raw = line.slice(6).trim();
          if (lastEvent === 'error') {
            try {
              const err = JSON.parse(raw);
              throw new Error(err.message || 'Generation failed');
            } catch (e) {
              if (e instanceof SyntaxError) throw new Error('Generation failed');
              throw e;
            }
          }
          if (lastEvent === 'idea' && raw && raw !== '{}') {
            try {
              const idea = JSON.parse(raw) as SparkIdea;
              ideas.push(idea);
              yield idea;
            } catch { /* skip malformed */ }
          }
          lastEvent = '';
        }
      }
    }

    // Step 3: persist ideas to DB
    if (ideas.length > 0) {
      try {
        await fetch(`${V1}/spark/ideas/batch`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({
            company_id: companyId,
            ideas,
            clear_existing: !(direction?.trim()),
          }),
        });
      } catch (err) {
        appLogger.error('Spark ideas/batch save failed (non-fatal)', { error: (err as Error).message });
      }
    }

    appLogger.res('Spark generateIdeasStream', { count: ideas.length, direction: direction ?? '(none)' }, Date.now() - t0);
  }

  /** Delete specific ideas by ID. */
  async deleteIdeas(companyId: string, ideaIds: string[]): Promise<void> {
    const params = new URLSearchParams({ company_id: companyId, idea_ids: ideaIds.join(',') });
    appLogger.req('Spark deleteIdeas', { companyId, count: ideaIds.length });
    const t0 = Date.now();
    await req<void>(`/spark/ideas?${params.toString()}`, { method: 'DELETE' });
    appLogger.res('Spark deleteIdeas', { deleted: ideaIds.length }, Date.now() - t0);
    portalActivity.record(`Deleted ${ideaIds.length} Spark idea${ideaIds.length === 1 ? '' : 's'}`, 'amber');
  }

  /** Persist a user's reaction and updated popularity score for an idea. */
  async updateIdeaReaction(
    companyId: string,
    ideaId: string,
    reaction: 'like' | 'dislike' | null,
  ): Promise<{ idea_id: string; user_reaction: 'like' | 'dislike' | null; popularity_score: number }> {
    const params = new URLSearchParams({ company_id: companyId });
    appLogger.req('Spark updateIdeaReaction', { companyId, ideaId, reaction });
    const t0 = Date.now();
    const result = await req<{ idea_id: string; user_reaction: 'like' | 'dislike' | null; popularity_score: number }>(
      `/spark/ideas/${encodeURIComponent(ideaId)}/reaction?${params.toString()}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ reaction }),
      },
    );
    appLogger.res('Spark updateIdeaReaction', { ideaId, reaction: result.user_reaction }, Date.now() - t0);
    return result;
  }

  /** Delete all stored ideas for a company. */
  async resetIdeas(companyId: string): Promise<void> {
    const params = new URLSearchParams({ company_id: companyId });
    appLogger.req('Spark resetIdeas', { companyId });
    await req<void>(`/spark/ideas?${params.toString()}`, { method: 'DELETE' });
    appLogger.res('Spark resetIdeas', {});
    portalActivity.record('Reset Spark ideas', 'amber');
  }

  /** Expand a Spark idea into full AI use case fields + agent recommendation via Claude. */
  async convertIdea(payload: SparkConvertRequest): Promise<{ use_case_fields: UseCaseFields; agent_recommendation: Record<string, unknown> | null }> {
    appLogger.req('Spark convertIdea → request', { ideaId: payload.idea_id, title: payload.title });
    const t0 = Date.now();
    try {
      const resp = await req<{ use_case_fields: UseCaseFields; agent_recommendation: Record<string, unknown> | null }>('/spark/convert', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      appLogger.res('Spark convertIdea ← response', {
        title: resp.use_case_fields.title,
        hasAgent: !!resp.agent_recommendation,
      }, Date.now() - t0);
      return resp;
    } catch (err) {
      appLogger.error('Spark convertIdea failed', { error: (err as Error).message });
      throw err;
    }
  }
}

export const sparkApi = new SparkApi();
