import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { AdminPage } from '~/admin/page';
import { type AdminRouteLoaderData, loadAdminRouteData } from '~/admin/route-state';
import { parseAdminSearchParams } from '~/admin/search-params';
import type { AdminTab } from '~/admin/transport';

export const Route = createFileRoute('/admin')({
  validateSearch: parseAdminSearchParams,
  loaderDeps: ({ search }) => ({
    error: search.error ?? null,
    tab: search.tab ?? null,
    fileId: search.fileId ?? null
  }),
  loader: ({ deps, abortController }) =>
    loadAdminRouteData({ error: deps.error, signal: abortController.signal }),
  head: () => ({
    meta: [{ title: 'anonshare | Admin' }, { name: 'robots', content: 'noindex, nofollow' }]
  }),
  component: AdminRoutePage
});

function AdminRoutePage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: '/admin' });

  const handleNavigate = (tab: AdminTab, fileId: string | null) => {
    void navigate({
      search: (prev) => {
        const next: typeof prev = { ...prev };
        if (tab === 'overview') {
          delete next.tab;
        } else {
          next.tab = tab;
        }
        if (fileId === null) {
          delete next.fileId;
        } else {
          next.fileId = fileId;
        }
        return next;
      }
    });
  };

  return (
    <AdminPage
      loaderData={Route.useLoaderData() as AdminRouteLoaderData}
      {...(search.tab !== undefined ? { initialTab: search.tab } : {})}
      {...(search.fileId !== undefined ? { initialFileId: search.fileId } : {})}
      onNavigate={handleNavigate}
    />
  );
}
