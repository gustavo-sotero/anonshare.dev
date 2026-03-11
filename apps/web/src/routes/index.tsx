import { createFileRoute, Link } from '@tanstack/react-router';
import { SiteFrame } from '~/components/site-frame';

export const Route = createFileRoute('/')({
  head: () => ({
    meta: [{ title: 'anonshare | Foundation cockpit' }]
  }),
  component: HomePage
});

function HomePage() {
  return (
    <SiteFrame
      eyebrow="Foundation live"
      title="Anonymous file sharing with a deliberate monorepo spine."
      summary="Module 1 now exposes the public shell, the admin shell scaffold, and a tokenized share route so the product surface can evolve without restructuring the app again."
    >
      <section className="panel panel--feature">
        <div className="panel__row">
          <p className="panel__label">What is already locked in</p>
          <span className="chip">Bun-first</span>
        </div>

        <div className="surface-grid">
          <article className="surface-card">
            <p className="surface-card__index">01</p>
            <h2>Public web shell</h2>
            <p>
              File routes, SSR-capable layout, shared styles, and noindex defaults are in place.
            </p>
          </article>

          <article className="surface-card">
            <p className="surface-card__index">02</p>
            <h2>API boundary</h2>
            <p>Hono owns domain endpoints, request IDs, secure headers, and structured logs.</p>
          </article>

          <article className="surface-card">
            <p className="surface-card__index">03</p>
            <h2>Worker bootstrap</h2>
            <p>
              BullMQ queues and recurring reconciliation are wired as independent process concerns.
            </p>
          </article>
        </div>
      </section>

      <section className="panel">
        <div className="panel__row">
          <p className="panel__label">Scaffold routes</p>
          <span className="chip chip--outline">Module 1</span>
        </div>

        <div className="action-row">
          <Link to="/about" className="button-link">
            Open architecture narrative
          </Link>
          <Link to="/admin" className="button-link button-link--ghost">
            Inspect admin shell
          </Link>
          <Link
            to="/share/$token"
            params={{ token: 'demo-token' }}
            className="button-link button-link--ghost"
          >
            Open token route
          </Link>
        </div>
      </section>
    </SiteFrame>
  );
}
