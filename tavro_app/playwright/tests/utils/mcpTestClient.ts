import type { APIRequestContext } from '@playwright/test';
import { randomUUID } from 'crypto';
import type { TenantSession } from './tenantClient';

/**
 * Minimal client for mcp_server/server.py's streamable-http MCP endpoint
 * (POST http://localhost:9001/zitadel/mcp). This is a genuinely different
 * surface from tavro_api's REST routes: tools here call a separate class,
 * AgentMetadataExporter, and derive tenant_id from the caller's real
 * ZITADEL access token (verified either via signed-JWT check or a live
 * ZITADEL userinfo round-trip — see mcp_server/zitadel_provider.py), not
 * from a client-supplied header. There is no bypass for a fabricated
 * token here, unlike tavro_api's x-tenant-id trust.
 *
 * Reuses the same real per-tenant access token already obtained via the
 * hosted-UI ZITADEL login in tests/setup/auth.setup.ts (TenantSession.token)
 * — no separate MCP-specific login is needed.
 */

const MCP_URL = process.env.MCP_URL || 'http://localhost:9001/zitadel/mcp';

export type McpSession = {
  request: APIRequestContext;
  token: string;
  sessionId: string;
};

export type McpToolResult = {
  /** Protocol-level error (e.g. a missing/invalid required argument) — the tool itself never ran. */
  isError: boolean;
  /** Parsed structuredContent (or JSON.parse of the text payload) on success; raw text on protocol error. */
  data: any;
};

async function mcpRequest(
  session: { request: APIRequestContext; token: string; sessionId?: string },
  body: Record<string, unknown>,
) {
  return session.request.post(MCP_URL, {
    headers: {
      Authorization: `Bearer ${session.token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(session.sessionId ? { 'mcp-session-id': session.sessionId } : {}),
    },
    data: body,
  });
}

export async function openMcpSession(request: APIRequestContext, tenantSession: TenantSession): Promise<McpSession> {
  const res = await mcpRequest(
    { request, token: tenantSession.token },
    {
      jsonrpc: '2.0',
      id: 'init',
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'playwright-test', version: '1.0' },
      },
    },
  );
  const sessionId = res.headers()['mcp-session-id'];
  if (!sessionId) {
    throw new Error(`MCP initialize did not return an mcp-session-id header. Status ${res.status()}: ${await res.text()}`);
  }
  return { request, token: tenantSession.token, sessionId };
}

export async function callMcpTool(
  session: McpSession,
  name: string,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  const res = await mcpRequest(session, {
    jsonrpc: '2.0',
    id: randomUUID(),
    method: 'tools/call',
    params: { name, arguments: { original_prompt: `playwright test: ${name}`, ...args } },
  });
  const body = await res.json();
  const result = body.result;
  const text: string = result?.content?.[0]?.text ?? '';

  if (result?.isError) {
    return { isError: true, data: text };
  }
  if (result?.structuredContent !== undefined) {
    return { isError: false, data: result.structuredContent };
  }
  try {
    return { isError: false, data: JSON.parse(text) };
  } catch {
    return { isError: false, data: text };
  }
}
