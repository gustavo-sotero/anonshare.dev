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
import { ABOUT_DECISIONS, ABOUT_FACTS, ABOUT_LIMITATIONS, ABOUT_SECTION_LINKS } from './content';
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
  it('renders the editorial structure and navigation for the public portfolio page', async () => {
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

    expect(html).toContain('Anonymous sharing, built to be understood.');
    expect(html).toContain('The problem');
    expect(html).toContain('Project facts');
    expect(html).toContain('On this page');
    expect(html.match(/<h2 class="panel__label"/g)?.length).toBe(13);

    for (const section of ABOUT_SECTION_LINKS) {
      expect(html).toContain(`href="${section.href}"`);
      expect(html).toContain(escapeHtml(section.label));

      const sectionId = section.href.slice(1);
      expect(html).toContain(`id="${sectionId}"`);
      expect(html).toContain(`aria-labelledby="${sectionId}-heading"`);
      expect(html).toContain(`id="${sectionId}-heading"`);
    }

    for (const fact of ABOUT_FACTS) {
      expect(html).toContain(escapeHtml(fact.label));
      expect(html).toContain(escapeHtml(fact.value));
    }

    for (const decision of ABOUT_DECISIONS) {
      expect(html).toContain(escapeHtml(decision.decision));
    }

    for (const limitation of ABOUT_LIMITATIONS) {
      expect(html).toContain(escapeHtml(limitation.title));
    }
  });
});
