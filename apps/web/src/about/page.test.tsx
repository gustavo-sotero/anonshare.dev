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
import { ABOUT_DECISIONS, ABOUT_HERO, ABOUT_LIMITATIONS, ABOUT_SECTION_LINKS } from './content';
import { AboutPage } from './page';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll("'", '&#x27;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

describe('About page SSR', () => {
  it('renders the editorial structure and footer for the public portfolio page', async () => {
    const rootRoute = createRootRoute({
      component: () => <Outlet />
    });

    const aboutRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/about',
      component: AboutPage
    });

    const router = createRouter({
      routeTree: rootRoute.addChildren([aboutRoute]),
      history: createMemoryHistory({ initialEntries: ['/about'] })
    });

    await router.load();

    const html = renderToStaticMarkup(<RouterProvider router={router} />);

    expect(html).toContain(ABOUT_HERO.title);
    expect(html).toContain('The problem');
    expect(html).toContain('anonshare — anonymous file sharing. no accounts. no trace.');
    expect(html).not.toContain('Project facts');
    expect(html).not.toContain('On this page');
    expect(html).not.toContain('about-toc__link');

    for (const section of ABOUT_SECTION_LINKS) {
      const sectionId = section.href.slice(1);
      expect(html).toContain(`id="${sectionId}"`);
      expect(html).toContain(`aria-labelledby="${sectionId}-heading"`);
      expect(html).toContain(`id="${sectionId}-heading"`);
    }

    for (const decision of ABOUT_DECISIONS) {
      expect(html).toContain(escapeHtml(decision.decision));
    }

    for (const limitation of ABOUT_LIMITATIONS) {
      expect(html).toContain(escapeHtml(limitation.title));
    }
  });
});
