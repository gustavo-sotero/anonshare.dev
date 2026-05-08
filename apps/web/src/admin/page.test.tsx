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
import { AdminPage } from './page';

async function renderAdminPage(props: Parameters<typeof AdminPage>[0]) {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const adminRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/admin',
    component: () => <AdminPage {...props} />
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([adminRoute]),
    history: createMemoryHistory({ initialEntries: ['/admin'] })
  });
  await router.load();
  return renderToStaticMarkup(<RouterProvider router={router} />);
}

describe('AdminPage SSR', () => {
  it('renders the branded admin login gate without the public site frame', async () => {
    const html = await renderAdminPage({
      loaderData: {
        initialState: { kind: 'unauthenticated' },
        loginError: null
      }
    });

    expect(html).toContain('admin-login-card__brand');
    expect(html).toContain('anonshare');
    expect(html).toContain('Admin access');
    expect(html).toContain('Sign in to continue.');
    expect(html).toContain('Sign in with GitHub');
    expect(html).toContain(
      'The operations dashboard requires authentication with the allowlisted GitHub account.'
    );
    expect(html).toContain('anonshare — anonymous file sharing. no accounts. no trace.');
    expect(html).not.toContain('Share a file');
  });
});
