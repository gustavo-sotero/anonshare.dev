import { createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';

export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
    // Route all unmatched paths to the root notFoundComponent for a single,
    // predictable 404 surface. The flat public route tree has no nested
    // content hierarchy that would benefit from fuzzy local 404 rendering.
    notFoundMode: 'root'
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
