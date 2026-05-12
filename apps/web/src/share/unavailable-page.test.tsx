import { describe, expect, it } from 'bun:test';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider
} from '@tanstack/react-router';
import { renderToStaticMarkup } from 'react-dom/server';
import { UnavailableFilePageFromCode } from './unavailable-page';

async function renderUnavailablePage() {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });

  const unavailableRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => (
      <UnavailableFilePageFromCode code="file_hidden" reportPanel={<div>Report slot</div>} />
    )
  });

  const router = createRouter({
    routeTree: rootRoute.addChildren([unavailableRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] })
  });

  await router.load();
  return renderToStaticMarkup(<RouterProvider router={router} />);
}

describe('UnavailableFilePage SSR', () => {
  it('renders generic hidden-file copy without revealing moderation details', async () => {
    const html = await renderUnavailablePage();

    expect(html).toContain('Unavailable');
    expect(html).toContain('This file is not available.');
    expect(html).toContain('Share a new file');
    expect(html).toContain('Report slot');
    expect(html).not.toContain('moderated');
    expect(html).not.toContain('reported');
  });
});
