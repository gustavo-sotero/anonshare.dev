import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

type SiteFrameProps = {
  eyebrow: string;
  title: string;
  summary: string;
  children: ReactNode;
  rail?: ReactNode;
};

export function SiteFrame({ eyebrow, title, summary, children, rail }: SiteFrameProps) {
  return (
    <main className="site-shell">
      <div className="site-shell__backdrop" aria-hidden="true" />

      <header className="topbar">
        <div>
          <Link to="/" className="brand-mark">
            anonshare
          </Link>
          <p className="brand-note">Anonymous file sharing</p>
        </div>

        <nav className="topbar__nav" aria-label="Primary">
          <Link to="/" className="nav-link">
            Share a file
          </Link>
          <Link to="/about" className="nav-link">
            About
          </Link>
          <Link to="/admin" className="nav-link">
            Admin
          </Link>
        </nav>
      </header>

      <section className="hero-card">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="hero-card__summary">{summary}</p>
      </section>

      <div className="layout-grid">
        <section className="stack">{children}</section>
        <aside className="stack stack--rail">{rail ?? <InfoRail />}</aside>
      </div>
    </main>
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
