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
import { PublicNotFoundPage, PublicUnexpectedErrorPage } from './public-error-page';

describe('PublicNotFoundPage SSR', () => {
  it('renders the 404 title and a home action without exposing admin navigation', async () => {
    const rootRoute = createRootRoute({ component: () => <Outlet /> });
    const route = createRoute({
      getParentRoute: () => rootRoute,
      path: '/',
      component: PublicNotFoundPage
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([route]),
      history: createMemoryHistory({ initialEntries: ['/'] })
    });

    await router.load();
    const html = renderToStaticMarkup(<RouterProvider router={router} />);

    expect(html).toContain('Page not found');
    expect(html).toContain('Go to home');
    expect(html).toContain('About anonshare');
    expect(html).not.toContain('>Admin<');
    expect(html).toContain('anonshare — anonymous file sharing. no accounts. no trace.');
  });
});

describe('PublicUnexpectedErrorPage SSR', () => {
  it('renders a public-safe error title with no internal exception details', async () => {
    const rootRoute = createRootRoute({ component: () => <Outlet /> });
    const route = createRoute({
      getParentRoute: () => rootRoute,
      path: '/',
      component: PublicUnexpectedErrorPage
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([route]),
      history: createMemoryHistory({ initialEntries: ['/'] })
    });

    await router.load();
    const html = renderToStaticMarkup(<RouterProvider router={router} />);

    expect(html).toContain('Something went wrong');
    expect(html).toContain('Go to home');
    // Must not leak internal exception messages, file paths, or stack traces
    expect(html).not.toContain('Error: ');
    expect(html).not.toContain('at Object.');
    expect(html).not.toContain('>Admin<');
    expect(html).toContain('anonshare — anonymous file sharing. no accounts. no trace.');
  });
});
