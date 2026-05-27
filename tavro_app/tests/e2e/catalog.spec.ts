import { test, expect } from '../fixtures';
import { navigateToCatalog, searchAgents, stubMcpServer } from '../../actions';
import { expectVisibleReadable } from './portal-helpers';

async function useStubbedMcp(page: Parameters<typeof stubMcpServer>[0], agents: any[] = []): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('tavro_mcp_access_token', 'playwright-mcp-token');
  });
  await stubMcpServer(page, agents);
}

test.describe('Catalog page (/catalog)', () => {
  test('renders without crashing when agent list is empty', async ({ page }) => {
    await useStubbedMcp(page, []);
    await navigateToCatalog(page);
    await expect(page.getByRole('button', { name: /new agent|add agent|\+/i }).first()).toBeVisible({
      timeout: 8_000,
    });
  });

  test('search input is present and accepts input', async ({ page }) => {
    await useStubbedMcp(page, []);
    await navigateToCatalog(page);
    const input = page.getByRole('textbox').first();
    await expect(input).toBeVisible();
    await searchAgents(page, 'Risk');
    await expect(input).toHaveValue('Risk');
  });

  test('shows agent cards when the MCP server returns agents', async ({ page }) => {
    await useStubbedMcp(page, [
      {
        name: 'Risk Classifier',
        identification: { agent_id: 'agent-001' },
        description: 'Classifies business risks using the MCP server.',
      },
      {
        name: 'Compliance Checker',
        identification: { agent_id: 'agent-002' },
        description: 'Validates policies against regulation frameworks.',
      },
    ]);

    await navigateToCatalog(page);
    await expectVisibleReadable(
      page.getByRole('heading', { name: 'Risk Classifier' }),
      'the agent card heading "Risk Classifier"',
      'Catalog',
    );
    await expectVisibleReadable(
      page.getByRole('heading', { name: 'Compliance Checker' }),
      'the agent card heading "Compliance Checker"',
      'Catalog',
    );
  });

  test('shows a readable error when the MCP server rejects the connection', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('tavro_mcp_access_token', 'playwright-mcp-token');
    });
    await page.route(/(localhost:9001|zitadel\/mcp)/, async (route) => {
      const requestBody = route.request().postData() || '';
      if (requestBody.includes('"method":"initialize"')) {
        await route.fulfill({ status: 401, body: 'Unauthorized' });
        return;
      }
      await route.fulfill({ status: 401, body: 'Unauthorized' });
    });

    await navigateToCatalog(page);
    await expect(page.getByText(/MCP request unauthorized/i).first()).toBeVisible({
      timeout: 8_000,
    });
  });
});
