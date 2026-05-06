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
import { PRIVACY_HERO, PRIVACY_SECTIONS } from './privacy-content';
import { PrivacyPage } from './privacy-page';

async function renderPrivacyPage() {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const route = createRoute({
    getParentRoute: () => rootRoute,
    path: '/privacy',
    component: PrivacyPage
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ['/privacy'] })
  });

  await router.load();

  return renderToStaticMarkup(<RouterProvider router={router} />);
}

describe('Privacy page SSR', () => {
  it('renders the hero title and all required section headings', async () => {
    const html = await renderPrivacyPage();

    expect(html).toContain(PRIVACY_HERO.title);
    expect(html).toContain(PRIVACY_HERO.eyebrow);

    for (const section of PRIVACY_SECTIONS) {
      expect(html).toContain(`id="${section.id}"`);
      expect(html).toContain(`aria-labelledby="${section.id}-heading"`);
      expect(html).toContain(`id="${section.id}-heading"`);
      expect(html).toContain(section.heading);
    }
  });

  it('renders the public footer without admin navigation', async () => {
    const html = await renderPrivacyPage();

    expect(html).toContain('anonshare — anonymous file sharing. no accounts. no trace.');
    expect(html).not.toContain('>Admin<');
  });

  it('does not render the informational rail', async () => {
    const html = await renderPrivacyPage();

    expect(html).not.toContain('How it works');
    expect(html).not.toContain('Supported rules');
  });
});
