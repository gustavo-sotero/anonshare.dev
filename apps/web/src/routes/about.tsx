import { createFileRoute } from '@tanstack/react-router';
import { SiteFrame } from '~/components/site-frame';

export const Route = createFileRoute('/about')({
  head: () => ({
    meta: [{ title: 'anonshare | About the foundation' }]
  }),
  component: AboutPage
});

function AboutPage() {
  return (
    <SiteFrame
      eyebrow="Architecture notes"
      title="A portfolio project that starts with process boundaries, not screenshots."
      summary="This route exists in Module 1 so the narrative surface is already part of the application topology, even before the full portfolio page arrives in Module 8."
    >
      <section className="panel">
        <p className="panel__label">Why this stack</p>
        <div className="surface-grid surface-grid--narrow">
          <article className="surface-card">
            <h2>Bun workspaces</h2>
            <p>
              One runtime, one package manager, one fast verification loop for all apps and
              packages.
            </p>
          </article>
          <article className="surface-card">
            <h2>TanStack Start + Hono</h2>
            <p>
              UI composition stays separate from domain HTTP boundaries, which reduces future
              coupling pressure.
            </p>
          </article>
          <article className="surface-card">
            <h2>Redis + BullMQ</h2>
            <p>
              Lifecycle jobs are part of the platform baseline from day one, not a retrofit after
              features ship.
            </p>
          </article>
        </div>
      </section>

      <section className="panel panel--muted">
        <p className="panel__label">Current process boundaries</p>
        <div className="timeline">
          <div className="timeline__item">
            <strong>apps/web</strong>
            <p>Public pages, SSR-capable routes, and the future admin shell.</p>
          </div>
          <div className="timeline__item">
            <strong>apps/api</strong>
            <p>
              Domain-facing endpoints, health routes, and internal operational HTTP entrypoints.
            </p>
          </div>
          <div className="timeline__item">
            <strong>apps/worker</strong>
            <p>Expiration, cleanup, reconciliation, and other asynchronous lifecycle work.</p>
          </div>
        </div>
      </section>
    </SiteFrame>
  );
}
