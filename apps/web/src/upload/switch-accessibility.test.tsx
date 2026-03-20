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
import { HomePage } from '../routes/index';

describe('Upload page SSR — switch accessibility', () => {
  async function renderHomePage(): Promise<string> {
    const rootRoute = createRootRoute({ component: () => <Outlet /> });

    const homeRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/',
      component: HomePage
    });

    const router = createRouter({
      routeTree: rootRoute.addChildren([homeRoute]),
      history: createMemoryHistory({ initialEntries: ['/'] })
    });

    await router.load();
    return renderToStaticMarkup(<RouterProvider router={router} />);
  }

  it('renders one-time download switch with an explicit accessible name', async () => {
    const html = await renderHomePage();

    // The label text must exist with a stable ID
    expect(html).toContain('id="switch-one-time-label"');
    expect(html).toContain('One-time download');

    // The switch must reference the label via aria-labelledby
    expect(html).toContain('aria-labelledby="switch-one-time-label"');
    expect(html).toContain('role="switch"');
  });

  it('renders allow-preview switch with an explicit accessible name', async () => {
    const html = await renderHomePage();

    // The label text must exist with a stable ID
    expect(html).toContain('id="switch-preview-label"');
    expect(html).toContain('Allow preview');

    // The switch must reference the label via aria-labelledby
    expect(html).toContain('aria-labelledby="switch-preview-label"');
  });

  it('both switches have aria-checked state in initial render', async () => {
    const html = await renderHomePage();

    // Both switches start unchecked
    const switchMatches = html.match(/role="switch"[^>]*aria-checked="false"/g);
    expect(switchMatches).toBeTruthy();
    expect(switchMatches?.length).toBeGreaterThanOrEqual(2);
  });

  it('renders the drop zone with file input', async () => {
    const html = await renderHomePage();

    expect(html).toContain('type="file"');
    expect(html).toContain('Drag a file here or click to browse');
    expect(html).toContain('Up to 256 MB');
  });
});
