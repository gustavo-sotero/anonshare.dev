import { createFileRoute } from '@tanstack/react-router';
import { AdminPage } from '~/admin/page';
import { type AdminRouteLoaderData, loadAdminRouteData } from '~/admin/route-state';
import { parseAdminSearchParams } from '~/admin/search-params';

export const Route = createFileRoute('/admin')({
  validateSearch: parseAdminSearchParams,
  loaderDeps: ({ search }) => ({ error: search.error ?? null }),
  loader: ({ deps, abortController }) =>
    loadAdminRouteData({ error: deps.error, signal: abortController.signal }),
  head: () => ({
    meta: [{ title: 'anonshare | Admin' }, { name: 'robots', content: 'noindex, nofollow' }]
  }),
  component: AdminRoutePage
});

function AdminRoutePage() {
  return <AdminPage loaderData={Route.useLoaderData() as AdminRouteLoaderData} />;
}
