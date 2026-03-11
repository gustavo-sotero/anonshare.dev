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
          <p className="brand-note">Module 1 foundation in motion</p>
        </div>

        <nav className="topbar__nav" aria-label="Primary">
          <Link to="/" className="nav-link">
            Home
          </Link>
          <Link to="/about" className="nav-link">
            About
          </Link>
          <Link to="/admin" className="nav-link">
            Admin shell
          </Link>
          <Link to="/share/$token" params={{ token: 'demo-token' }} className="nav-link">
            Share route
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
        <aside className="stack stack--rail">{rail ?? <FoundationRail />}</aside>
      </div>
    </main>
  );
}

function FoundationRail() {
  return (
    <>
      <section className="panel panel--muted">
        <p className="panel__label">Running surfaces</p>
        <div className="status-list">
          <div className="status-item">
            <span>Web</span>
            <strong>TanStack Start shell</strong>
          </div>
          <div className="status-item">
            <span>API</span>
            <strong>Hono boundary</strong>
          </div>
          <div className="status-item">
            <span>Worker</span>
            <strong>BullMQ bootstrap</strong>
          </div>
          <div className="status-item">
            <span>Local infra</span>
            <strong>Postgres, Redis, MinIO</strong>
          </div>
        </div>
      </section>

      <section className="panel panel--muted">
        <p className="panel__label">Operator checklist</p>
        <div className="command-list">
          <code>bun run infra:up</code>
          <code>bun run db:migrate</code>
          <code>bun run dev:api</code>
          <code>bun run dev:worker</code>
          <code>bun run dev:web</code>
        </div>
      </section>
    </>
  );
}
