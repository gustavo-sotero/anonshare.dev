import { Link } from '@tanstack/react-router';
import { SiteFrame } from '~/components/site-frame';

export function PublicNotFoundPage() {
  return (
    <SiteFrame
      eyebrow="Error"
      title="Page not found"
      summary="This URL does not match anything on anonshare."
      noRail
    >
      <section className="panel panel--unavailable">
        <div className="unavail-icon" aria-hidden="true">
          ⊘
        </div>
        <p className="unavail-message">
          The page you are looking for does not exist. The address may be wrong, or the page may
          have been removed.
        </p>
        <div className="action-row">
          <Link to="/" className="button-link">
            Go to home
          </Link>
          <Link to="/about" className="button-link button-link--ghost">
            About anonshare
          </Link>
        </div>
      </section>
    </SiteFrame>
  );
}

// TanStack Router passes { error, reset } to errorComponent. The error is intentionally
// not exposed in the UI to prevent leaking internal implementation details publicly.
export function PublicUnexpectedErrorPage(_props: { error?: unknown; reset?: () => void }) {
  return (
    <SiteFrame
      eyebrow="Error"
      title="Something went wrong"
      summary="An unexpected error occurred while loading this page."
      noRail
    >
      <section className="panel panel--unavailable">
        <div className="unavail-icon" aria-hidden="true">
          ⊘
        </div>
        <p className="unavail-message">
          We were unable to load this page. Please return to the home page and try again.
        </p>
        <div className="action-row">
          <Link to="/" className="button-link">
            Go to home
          </Link>
        </div>
      </section>
    </SiteFrame>
  );
}
