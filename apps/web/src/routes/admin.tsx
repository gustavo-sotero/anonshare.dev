import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { AdminPage } from '~/admin/page';
import { type AdminRouteLoaderData, loadAdminRouteData } from '~/admin/route-state';
import {
  type AdminSearchParams,
  type AdminSearchUpdate,
  parseAdminSearchParams
} from '~/admin/search-params';
import type { AdminTab } from '~/admin/transport';

export const Route = createFileRoute('/admin')({
  validateSearch: parseAdminSearchParams,
  loaderDeps: ({ search }) => ({
    error: search.error ?? null
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

  const handleNavigate = useCallback(
    (tab: AdminTab, fileId: string | null) => {
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
    },
    [navigate]
  );

  const handleUpdateSearch = useCallback(
    (updates: AdminSearchUpdate) => {
      void navigate({
        search: (prev) => {
          const next = { ...prev } as Record<string, unknown>;
          for (const [key, val] of Object.entries(updates)) {
            if (val === undefined) {
              delete next[key];
            } else {
              next[key] = val;
            }
          }
          return next as AdminSearchParams;
        }
      });
    },
    [navigate]
  );

  return (
    <AdminPage
      loaderData={Route.useLoaderData() as AdminRouteLoaderData}
      activeTab={search.tab ?? 'overview'}
      inspectedFileId={search.fileId ?? null}
      searchState={search}
      onNavigate={handleNavigate}
      onUpdateSearch={handleUpdateSearch}
    />
  );
}
