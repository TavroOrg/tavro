import { Page } from '@playwright/test';

/**
 * Intercepts all requests to the MCP server (port 9001 / /zitadel/mcp) and
 * returns stub responses so the catalog and playground work without a live backend.
 *
 * Uses a regex pattern (not glob) to reliably match cross-origin localhost URLs.
 * Returns a real mcp-session-id on initialize so the MCP client stops reconnecting
 * on every tool call.
 */
export async function stubMcpServer(page: Page, agents: any[], useCases: any[] = []): Promise<void> {
  const agentResponse = JSON.stringify({
    jsonrpc: '2.0',
    result: { content: [{ type: 'text', text: JSON.stringify({ agents, total_records: agents.length }) }] },
    id: 1,
  });

  const useCaseResponse = JSON.stringify({
    jsonrpc: '2.0',
    result: { content: [{ type: 'text', text: JSON.stringify({ use_cases: useCases, total_records: useCases.length }) }] },
    id: 1,
  });

  await page.route(/(localhost:9001|zitadel\/mcp)/, async (route) => {
    let method = '';
    let toolName = '';
    try {
      const body = JSON.parse(route.request().postData() || '{}');
      method = body.method || '';
      toolName = body.params?.name || '';
    } catch { /* ignore parse errors */ }

    if (method === 'initialize') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'mcp-session-id': 'demo-session-001', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          result: { capabilities: {}, serverInfo: { name: 'demo-mcp', version: '1.0' } },
          id: 'init',
        }),
      });
      return;
    }

    if (method === 'tools/list') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ jsonrpc: '2.0', result: { tools: [] }, id: 'tools_list' }),
      });
      return;
    }

    // create_* tools — return a minimal success record
    if (toolName.startsWith('create_')) {
      const created = JSON.stringify({
        id: `demo-${Date.now()}`,
        identifier: `demo-${Date.now()}`,
        use_case_id: `demo-uc-${Date.now()}`,
        agent_id: `demo-agent-${Date.now()}`,
        name: 'Demo Record Created',
        status: 'Proposed',
        message: 'Created successfully.',
      });
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ jsonrpc: '2.0', result: { content: [{ type: 'text', text: created }] }, id: 1 }),
      });
      return;
    }

    // get_ai_use_case → use case list, everything else → agent catalog
    const body = toolName.includes('use_case') ? useCaseResponse : agentResponse;
    await route.fulfill({ status: 200, contentType: 'application/json', body });
  });
}
