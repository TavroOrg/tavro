import type { SparkIdea, SparkConvertRequest } from '../types/spark';
import { appLogger } from './logger';

const BASE = import.meta.env.VITE_TWIN_API_URL ?? '';
const V1 = `${BASE}/api/v1`;

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('tavro_access_token');
  return token
    ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    : { 'Content-Type': 'application/json' };
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

  /** Stream fresh ideas via SSE — yields each SparkIdea as it arrives from the server. */
  async *generateIdeasStream(
    companyId: string,
    dimensions?: string[],
    direction?: string,
    ideaCount?: number,
    companyName?: string,
    industry?: string,
    region?: string,
  ): AsyncGenerator<SparkIdea> {
    const params = new URLSearchParams({ company_id: companyId });
    if (dimensions && dimensions.length > 0) params.set('dimensions', dimensions.join(','));
    if (direction && direction.trim()) params.set('direction', direction.trim());
    if (ideaCount) params.set('idea_count', String(ideaCount));
    if (companyName && companyName.trim()) params.set('company_name', companyName.trim());
    if (industry && industry.trim()) params.set('industry', industry.trim());
    if (region && region.trim()) params.set('region', region.trim());

    const res = await fetch(`${V1}/spark/generate/stream?${params}`, {
      method: 'POST',
      headers: authHeaders(),
    });

    if (!res.ok || !res.body) {
      const body = await res.text();
      const isHtml = body.trimStart().startsWith('<');
      const message = isHtml
        ? res.status === 504
          ? 'The request timed out. Please try again.'
          : `Unexpected error (${res.status}). Please try again.`
        : body.slice(0, 250);
      throw new Error(`API ${res.status}: ${message}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let lastEvent = '';

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
              yield JSON.parse(raw) as SparkIdea;
            } catch { /* skip malformed */ }
          }
          lastEvent = '';
        }
      }
    }
  }

  /** Generate fresh ideas, persist to DB, return them. */
  async generateIdeas(companyId: string, dimensions?: string[], direction?: string, ideaCount?: number, companyName?: string, industry?: string, region?: string): Promise<SparkIdea[]> {
    const params = new URLSearchParams({ company_id: companyId });
    if (dimensions && dimensions.length > 0) params.set('dimensions', dimensions.join(','));
    if (direction && direction.trim()) params.set('direction', direction.trim());
    if (ideaCount) params.set('idea_count', String(ideaCount));
    if (companyName && companyName.trim()) params.set('company_name', companyName.trim());
    if (industry && industry.trim()) params.set('industry', industry.trim());
    if (region && region.trim()) params.set('region', region.trim());
    const path = `/spark/generate?${params.toString()}`;
    appLogger.req('Spark generateIdeas → request', { companyId, dimensions, direction: direction ?? '(none)', ideaCount });
    const t0 = Date.now();
    try {
      const result = await req<SparkIdea[]>(path, { method: 'POST' });
      appLogger.res('Spark generateIdeas ← response', {
        count: result.length,
        direction: direction ?? '(none)',
        titles: result.slice(0, 3).map(i => i.title),
      }, Date.now() - t0);
      return result;
    } catch (err) {
      appLogger.error('Spark generateIdeas failed', { error: (err as Error).message, direction });
      throw err;
    }
  }

  /** Delete specific ideas by ID. */
  async deleteIdeas(companyId: string, ideaIds: string[]): Promise<void> {
    const params = new URLSearchParams({ company_id: companyId, idea_ids: ideaIds.join(',') });
    appLogger.req('Spark deleteIdeas', { companyId, count: ideaIds.length });
    const t0 = Date.now();
    await req<void>(`/spark/ideas?${params.toString()}`, { method: 'DELETE' });
    appLogger.res('Spark deleteIdeas', { deleted: ideaIds.length }, Date.now() - t0);
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
