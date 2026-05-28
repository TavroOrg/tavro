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
    throw new Error(`API ${res.status}: ${body.slice(0, 250)}`);
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

  /** Generate fresh ideas, persist to DB, return them. */
  async generateIdeas(companyId: string, dimensions?: string[], direction?: string): Promise<SparkIdea[]> {
    const params = new URLSearchParams({ company_id: companyId });
    if (dimensions && dimensions.length > 0) params.set('dimensions', dimensions.join(','));
    if (direction && direction.trim()) params.set('direction', direction.trim());
    const path = `/spark/generate?${params.toString()}`;
    appLogger.req('Spark generateIdeas → request', { companyId, dimensions, direction: direction ?? '(none)' });
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
