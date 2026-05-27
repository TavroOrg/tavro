import { test } from '../fixtures';
import { stubMcpServer } from '../../actions';
import { expectVisibleReadable, failIfPortalIssues, startPortalMonitor } from './portal-helpers';

test.describe('MCP connection', () => {
  test('loads catalog data through the MCP server', async ({ page, mockBackend: _ }) => {
    await page.addInitScript(() => {
      localStorage.setItem('tavro_mcp_access_token', 'playwright-mcp-token');
    });

    const monitor = startPortalMonitor(page);

    await stubMcpServer(page, [
      {
        name: 'Risk Classifier',
        identification: { agent_id: 'agent-001' },
        description: 'Classifies business risks using the MCP server.',
      },
      {
        name: 'Compliance Checker',
        identification: { agent_id: 'agent-002' },
        description: 'Checks policy coverage from MCP data.',
      },
    ]);

    await page.goto('/catalog');

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

    failIfPortalIssues('Catalog', monitor.stop());
  });
});
