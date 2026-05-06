import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { SiteFooter } from '~/components/site-footer';

type SiteFrameProps = {
  eyebrow: string;
  title: string;
  summary: string;
  children: ReactNode;
  rail?: ReactNode;
  noRail?: boolean;
};

export function SiteFrame({ eyebrow, title, summary, children, rail, noRail }: SiteFrameProps) {
  return (
    <>
      <main className="site-shell">
        <header className="topbar">
          <Link to="/" className="brand-mark">
            anonshare
          </Link>

          <nav className="topbar__nav" aria-label="Primary">
            <Link to="/" className="nav-link">
              Share a file
            </Link>
            <Link to="/about" className="nav-link">
              About
            </Link>
          </nav>
        </header>

        <div className="page-header">
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p className="page-header__summary">{summary}</p>
        </div>

        {noRail ? (
          <div className="layout-grid layout-grid--single">
            <section className="stack">{children}</section>
          </div>
        ) : (
          <div className="layout-grid">
            <section className="stack">{children}</section>
            <aside className="stack stack--rail">{rail ?? <InfoRail />}</aside>
          </div>
        )}
      </main>

      <SiteFooter />
    </>
  );
}

function InfoRail() {
  return (
    <>
      <section className="panel panel--muted">
        <p className="panel__label">How it works</p>
        <div className="status-list">
          <div className="status-item">
            <span>Step 1</span>
            <strong>Pick a file — up to 256 MB</strong>
          </div>
          <div className="status-item">
            <span>Step 2</span>
            <strong>Set access rules and expiration</strong>
          </div>
          <div className="status-item">
            <span>Step 3</span>
            <strong>Copy the link and share it</strong>
          </div>
          <div className="status-item">
            <span>Privacy</span>
            <strong>No account, no tracking</strong>
          </div>
        </div>
      </section>

      <section className="panel panel--muted">
        <p className="panel__label">Supported rules</p>
        <div className="status-list">
          <div className="status-item">
            <span>One-time</span>
            <strong>Link expires after first download</strong>
          </div>
          <div className="status-item">
            <span>Expiration</span>
            <strong>Auto-delete after 1 h to 30 d</strong>
          </div>
          <div className="status-item">
            <span>Preview</span>
            <strong>Images, video, audio, PDF, text</strong>
          </div>
        </div>
      </section>
    </>
  );
}
