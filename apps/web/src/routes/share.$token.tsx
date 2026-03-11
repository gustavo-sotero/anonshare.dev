import { createFileRoute, Link } from '@tanstack/react-router';
import { SiteFrame } from '~/components/site-frame';

export const Route = createFileRoute('/share/$token')({
  head: () => ({
    meta: [{ title: 'anonshare | Share route scaffold' }]
  }),
  component: ShareRoutePage
});

function ShareRoutePage() {
  const { token } = Route.useParams();

  return (
    <SiteFrame
      eyebrow="Token route"
      title="A public share surface already exists, even before file delivery is implemented."
      summary="The route shape is fixed now so Module 4 can focus on metadata, preview, download, and state handling instead of reworking the web topology."
    >
      <section className="panel panel--feature">
        <div className="panel__row">
          <p className="panel__label">Route parameter</p>
          <span className="token-chip">{token}</span>
        </div>

        <div className="surface-grid surface-grid--narrow">
          <article className="surface-card">
            <h2>Metadata block</h2>
            <p>
              Filename, size, MIME type, expiration and share policy will render here in Module 4.
            </p>
          </article>
          <article className="surface-card">
            <h2>Download and preview</h2>
            <p>Preview eligibility and one-time download semantics stay backend-controlled.</p>
          </article>
          <article className="surface-card">
            <h2>Unavailable states</h2>
            <p>Expired, hidden, deleted and consumed states will map to distinct UX messages.</p>
          </article>
        </div>
      </section>

      <section className="panel panel--muted">
        <p className="panel__label">Current state</p>
        <p className="panel__copy">
          This is a scaffold route only. The API endpoints behind share resolution are intentionally
          still returning placeholders until the public flow module is implemented.
        </p>
        <div className="action-row">
          <Link to="/" className="button-link button-link--ghost">
            Back to home
          </Link>
          <Link to="/about" className="button-link button-link--ghost">
            Review architecture notes
          </Link>
        </div>
      </section>
    </SiteFrame>
  );
}
