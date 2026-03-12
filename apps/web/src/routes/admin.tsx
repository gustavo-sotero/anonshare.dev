import { createFileRoute } from '@tanstack/react-router';
import { SiteFrame } from '~/components/site-frame';

export const Route = createFileRoute('/admin')({
  head: () => ({
    meta: [{ title: 'anonshare | Admin' }, { name: 'robots', content: 'noindex, nofollow' }]
  }),
  component: AdminShellPage
});

function AdminShellPage() {
  return (
    <SiteFrame
      eyebrow="Admin shell"
      title="The operator surface is scaffolded before the auth and moderation flows land."
      summary="Module 1 only establishes the shell and information architecture. GitHub OAuth, operational metrics, and moderation actions remain intentionally deferred to later modules."
    >
      <section className="panel">
        <p className="panel__label">Planned admin sections</p>
        <div className="surface-grid surface-grid--narrow">
          <article className="surface-card">
            <h2>Overview</h2>
            <p>File totals, status breakdown, queue health, and storage usage.</p>
          </article>
          <article className="surface-card">
            <h2>Files</h2>
            <p>Moderation actions, filters by lifecycle state, and detailed inspection.</p>
          </article>
          <article className="surface-card">
            <h2>Reports</h2>
            <p>Abuse triage, thresholds, and reversible decisions with audit context.</p>
          </article>
        </div>
      </section>

      <section className="panel panel--muted">
        <p className="panel__label">Boundary check</p>
        <p className="panel__copy">
          This route is presentation-only on purpose. Authentication and data access stay in the API
          boundary until Module 7 defines the full contract.
        </p>
      </section>
    </SiteFrame>
  );
}
