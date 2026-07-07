// ── src/types/datahubContext.ts ───────────────────────────────────────────────

export interface DataHubSearchResult {
  label: string;
  entity_type: string | null;
  chunk_text: string;
  schema: string | null;
  vendor: string | null;
  application: string | null;
  column_count: string | null;
  relevance: number | null;
}

export interface DataHubSearchResponse {
  query: string;
  mode?: 'semantic' | 'exact';
  count: number;
  total?: number;
  results: DataHubSearchResult[];
}

export interface DataHubSearchOptions {
  query: string;
  companyId?: string;
  limit?: number;
  schema?: string;
  vendor?: string;
  application?: string;
  entityType?: string;
  countOnly?: boolean;
}
