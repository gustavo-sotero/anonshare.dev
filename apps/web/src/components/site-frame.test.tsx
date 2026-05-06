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
import { SiteFrame } from './site-frame';

async function renderSiteFrame(options: { noRail?: boolean } = {}) {
  const rootRoute = createRootRoute({
    component: () => <Outlet />
  });

  const frameRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => {
      const siteFrameProps = {
        eyebrow: 'Anonymous file sharing',
        title: 'Share files without a trace.',
        summary: 'No accounts, no tracking. Upload a file and share the link.',
        ...(options.noRail ? { noRail: true } : {})
      };

      return (
        <SiteFrame {...siteFrameProps}>
          <section>Body copy</section>
        </SiteFrame>
      );
    }
  });

  const router = createRouter({
    routeTree: rootRoute.addChildren([frameRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] })
  });

  await router.load();

  return renderToStaticMarkup(<RouterProvider router={router} />);
}

describe('SiteFrame SSR', () => {
  it('renders the redesigned public nav and footer without exposing an admin link', async () => {
    const html = await renderSiteFrame();

    expect(html).toContain('Share a file');
    expect(html).toContain('About');
    expect(html).not.toContain('>Admin<');
    expect(html).toContain('How it works');
    expect(html).toContain('anonshare — anonymous file sharing. no accounts. no trace.');
    expect(html).toContain('Feito por Gustavo Sotero');
  });

  it('exposes legal page links in the footer', async () => {
    const html = await renderSiteFrame();

    expect(html).toContain('href="/terms"');
    expect(html).toContain('href="/privacy"');
  });

  it('suppresses the informational rail when the noRail variant is requested', async () => {
    const html = await renderSiteFrame({ noRail: true });

    expect(html).not.toContain('How it works');
    expect(html).not.toContain('Supported rules');
  });
});
