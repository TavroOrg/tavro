import { test } from '../fixtures';
import {
  expectNonEmptyPage,
  expectVisibleReadable,
  failIfPortalIssues,
  openRoute,
  startPortalMonitor,
} from './portal-helpers';

const PORTAL_ROUTES = [
  { path: '/', label: 'Home' },
  { path: '/catalog', label: 'Catalog' },
  { path: '/use-cases', label: 'AI Use Cases' },
  { path: '/blueprint', label: 'Blueprint' },
  { path: '/compliance', label: 'Compliance' },
  { path: '/audit', label: 'Audit' },
  { path: '/applications', label: 'Business Applications' },
  { path: '/processes', label: 'Business Processes' },
  { path: '/insights', label: 'Insights' },
  { path: '/settings', label: 'Settings' },
  { path: '/playground', label: 'Playground' },
] as const;

test.describe('Portal smoke test', () => {
  for (const { path, label } of PORTAL_ROUTES) {
    test(`opens ${label} without crashing`, async ({ page, mockBackend: _ }) => {
      const monitor = startPortalMonitor(page);

      await openRoute(page, path, label);
      await expectNonEmptyPage(page, label);

      if (path === '/') {
        await expectVisibleReadable(
          page.getByRole('heading', { name: /Tavro Agent BizOps/i }),
          'the main portal heading',
          label,
        );
      }

      if (path === '/catalog') {
        await expectVisibleReadable(
          page.getByRole('textbox').first(),
          'the catalog search box',
          label,
        );
      }

      if (path === '/playground') {
        await expectVisibleReadable(
          page.getByRole('button', { name: /start session and interact/i }).first(),
          'the playground action button',
          label,
        );
      }

      failIfPortalIssues(label, monitor.stop());
    });
  }
});
