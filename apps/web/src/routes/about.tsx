import { createFileRoute } from '@tanstack/react-router';
import { SiteFrame } from '~/components/site-frame';

export const Route = createFileRoute('/about')({
  head: () => ({
    meta: [
      { title: 'anonshare | About' },
      {
        name: 'description',
        content:
          'A non-commercial anonymous file-sharing platform built as a portfolio artifact. Learn about the architecture, stack decisions, and trade-offs.'
      },
      { name: 'robots', content: 'index, follow' }
    ]
  }),
  component: AboutPage
});

// ─── about page ───────────────────────────────────────────────────────────────

function AboutPage() {
  return (
    <SiteFrame
      eyebrow="About this project"
      title="Anonymous sharing, built to be understood."
      summary="anonshare is a non-commercial file-sharing platform built as a portfolio artifact. It demonstrates product thinking, modern architecture, and operational maturity — not just feature breadth."
      rail={<AboutRail />}
    >
      {/* ── The problem ─────────────────────────────────────────────────── */}
      <section className="panel about-prose" id="problem">
        <p className="panel__label">The problem</p>
        <p className="about-prose__body">
          Most file-sharing tools require an account, track usage, or bury access rules behind
          paywalls. Sometimes you just need to send one file — no sign-up, no tracking, no strings
          attached.
        </p>
        <p className="about-prose__body">
          anonshare lets anyone upload a file, configure access rules — one-time download,
          expiration, in-browser preview — and get a shareable link. Recipients open the link and
          see exactly what's available. No accounts exist on either side.
        </p>
        <p className="about-prose__body about-prose__body--muted">
          This project is intentionally non-commercial. It exists to validate a modern Bun-first
          stack in a realistic application with storage, jobs, caching, and moderation flows — and
          to serve as a portfolio artifact for technical and product conversations.
        </p>
      </section>

      {/* ── System flow ─────────────────────────────────────────────────── */}
      <section className="panel panel--muted" id="flow">
        <p className="panel__label">System flow</p>
        <p className="about-prose__body">
          From upload to cleanup, the system moves a file through a well-defined lifecycle with
          clear state transitions.
        </p>
        <div className="about-flow">
          <FlowStep index="01" label="Upload" desc="Validate file, MIME type, size, and options." />
          <FlowArrow />
          <FlowStep
            index="02"
            label="Store"
            desc="Persist metadata in PostgreSQL, object in S3-compatible storage."
          />
          <FlowArrow />
          <FlowStep
            index="03"
            label="Share"
            desc="Generate an unguessable link with the configured access rules."
          />
          <FlowArrow />
          <FlowStep
            index="04"
            label="Consume"
            desc="Download or preview — one-time links invalidate atomically."
          />
          <FlowArrow />
          <FlowStep
            index="05"
            label="Lifecycle"
            desc="Expiration jobs, cleanup, and reconciliation maintain correctness over time."
          />
          <FlowArrow />
          <FlowStep
            index="06"
            label="Moderate"
            desc="Reports, auto-hiding, and admin review keep the platform safe."
          />
        </div>
      </section>

      {/* ── Architecture ────────────────────────────────────────────────── */}
      <section className="panel" id="architecture">
        <p className="panel__label">Architecture</p>
        <p className="about-prose__body">
          The monorepo splits responsibilities across three independently runnable processes and two
          shared packages. Each process has a clear boundary — no cross-app imports.
        </p>
        <div className="about-arch-grid">
          <ArchCard
            kind="process"
            name="apps/web"
            purpose="Public UI · Admin shell"
            detail="TanStack Start with SSR. Serves the upload form, share pages, about page, and the admin dashboard. Routes call the API — never accesses domain logic directly."
          />
          <ArchCard
            kind="process"
            name="apps/api"
            purpose="Domain HTTP boundary"
            detail="Hono on Bun. Handles upload, download, report, admin, and internal endpoints. Validates requests, orchestrates storage, and enforces access rules."
          />
          <ArchCard
            kind="process"
            name="apps/worker"
            purpose="Async lifecycle work"
            detail="BullMQ consumers on Bun. Processes expiration, cleanup, one-time post-download removal, and periodic reconciliation jobs."
          />
          <ArchCard
            kind="package"
            name="packages/domain"
            purpose="Business rules"
            detail="Pure TypeScript — file state machine, status transitions, validation rules, and invariants. No infrastructure dependencies."
          />
          <ArchCard
            kind="package"
            name="packages/contracts"
            purpose="Shared types & schemas"
            detail="Zod schemas for API requests and responses, error codes, and job payloads. Consumed by web, API, and worker without duplication."
          />
          <ArchCard
            kind="package"
            name="packages/infrastructure"
            purpose="Platform primitives"
            detail="Database connection, Drizzle schema and migrations, Redis client, S3-compatible storage adapter, rate limiter, logger, and config validation."
          />
        </div>
      </section>

      {/* ── Stack choices ───────────────────────────────────────────────── */}
      <section className="panel panel--muted" id="stack">
        <p className="panel__label">Stack choices</p>
        <p className="about-prose__body">
          Every choice was made for a reason — here's a brief justification for each.
        </p>
        <div className="about-stack-grid">
          <StackCard
            tech="Bun"
            why="Single runtime, package manager, bundler, and test runner. Eliminates toolchain fragmentation and dramatically speeds up the inner dev loop."
          />
          <StackCard
            tech="TanStack Start"
            why="Full-stack React framework with SSR, file-based routing, and type-safe data loading. Lets the web surface own both public pages and admin shell without a separate frontend build step."
          />
          <StackCard
            tech="Hono"
            why="Lightweight, edge-ready HTTP framework. Clean middleware model, native Bun support, and minimal abstraction overhead keep the API surface fast and explicit."
          />
          <StackCard
            tech="PostgreSQL + Drizzle"
            why="Relational storage with strong consistency guarantees. Drizzle provides type-safe schema modeling and migration tooling that integrates cleanly with Bun SQL."
          />
          <StackCard
            tech="Redis + BullMQ"
            why="Redis backs rate limiting, caching, and queue state. BullMQ provides delayed jobs, retries, and scheduling — essential for lifecycle management, not a retrofit."
          />
          <StackCard
            tech="S3-compatible storage"
            why="Provider-agnostic object storage via Bun's native S3 API. Works with MinIO locally, AWS S3 or Cloudflare R2 in production — no AWS SDK dependency."
          />
          <StackCard
            tech="GitHub OAuth"
            why="Single-admin authentication with stable identity verification. The sole allowed GitHub account gets dashboard access — no multi-user complexity."
          />
        </div>
      </section>

      {/* ── Key decisions & trade-offs ──────────────────────────────────── */}
      <section className="panel" id="decisions">
        <p className="panel__label">Key decisions & trade-offs</p>
        <div className="about-decisions">
          <DecisionCard
            decision="One-time download uses a backend-controlled path"
            rationale="Blind presigned URLs can't guarantee atomic consumption — retries, partial transfers, and concurrent requests create race conditions. The backend reserves consumption before streaming the file, using a transactional lock to prevent double delivery."
            tradeoff="Slightly higher backend bandwidth cost vs. presigned-only delivery, but guarantees the core one-time promise to the uploader."
          />
          <DecisionCard
            decision="Storage is provider-agnostic"
            rationale="The adapter targets any S3-compatible API using Bun's native S3 support. MinIO runs locally; R2 or S3 slot in for production without code changes."
            tradeoff="No vendor-specific optimizations (e.g., CloudFront integration) out of the box, but avoids lock-in and keeps costs predictable."
          />
          <DecisionCard
            decision="Reconciliation is a first-class concern"
            rationale="Delayed jobs alone are not a sufficient lifecycle guarantee. A periodic reconciler catches missed expirations, orphaned objects, and metadata–storage drift — turning eventual problems into eventual consistency."
            tradeoff="Adds operational overhead (scheduler, anomaly tracking), but makes the system self-healing rather than silently degrading."
          />
          <DecisionCard
            decision="Auto-hide by report threshold"
            rationale="Anonymous upload creates moderation risk. Files are automatically hidden from public access after a configurable number of reports, reducing exposure time while the admin reviews."
            tradeoff="False positives are possible, but the admin can restore any hidden file. Speed of containment matters more than perfection for a solo-operated platform."
          />
          <DecisionCard
            decision="Three processes, not one monolith"
            rationale="Separating web, API, and worker means each can be deployed, scaled, and debugged independently. The web process never runs domain logic; the worker never serves HTTP."
            tradeoff="More operational surface than a single process, but the boundaries prevent coupling from creeping in as the system grows."
          />
        </div>
      </section>

      {/* ── Not in v1 ───────────────────────────────────────────────────── */}
      <section className="panel panel--muted" id="scope">
        <p className="panel__label">What's deliberately not in v1</p>
        <p className="about-prose__body">
          These aren't gaps — they're scoping decisions. Each was considered and excluded to keep v1
          focused and shippable.
        </p>
        <div className="about-exclusions">
          <ExclusionItem label="Multi-user accounts" why="Anonymity is the core UX." />
          <ExclusionItem
            label="Billing & subscriptions"
            why="Non-commercial — hobby-budget infrastructure only."
          />
          <ExclusionItem
            label="End-to-end encryption"
            why="Requires client-side key management that complicates the anonymous flow."
          />
          <ExclusionItem
            label="Malware scanning"
            why="Needs a scanning service integration — planned for a future version."
          />
          <ExclusionItem
            label="Password-protected shares"
            why="Adds authentication to an otherwise zero-friction flow."
          />
          <ExclusionItem
            label="Multi-admin support"
            why="Single operator for v1 — one GitHub identity, one session."
          />
          <ExclusionItem
            label="Folder & collaboration features"
            why="anonshare is single-file, single-link — not a workspace product."
          />
        </div>
      </section>

      {/* ── What's next ─────────────────────────────────────────────────── */}
      <section className="panel" id="next">
        <p className="panel__label">Possible next steps</p>
        <p className="about-prose__body">
          These are areas worth exploring after v1 stabilizes — not commitments, but informed
          directions.
        </p>
        <div className="about-next-grid">
          <NextItem
            label="Presigned uploads"
            desc="Move large file bodies off the application server for lower latency and bandwidth cost."
          />
          <NextItem
            label="Malware scanning"
            desc="Run uploaded files through a scanning service before activation to reduce abuse risk."
          />
          <NextItem
            label="Password-protected links"
            desc="Add optional passphrase to share links for an additional access layer."
          />
          <NextItem
            label="Download analytics"
            desc="Richer per-file insights for the admin dashboard — geography, timing, device breakdown."
          />
        </div>
      </section>
    </SiteFrame>
  );
}

// ─── sub-components ───────────────────────────────────────────────────────────

function FlowStep({
  index,
  label,
  desc
}: Readonly<{ index: string; label: string; desc: string }>) {
  return (
    <div className="about-flow__step">
      <span className="about-flow__index">{index}</span>
      <strong className="about-flow__label">{label}</strong>
      <p className="about-flow__desc">{desc}</p>
    </div>
  );
}

function FlowArrow() {
  return (
    <div className="about-flow__arrow" aria-hidden="true">
      <svg width="20" height="12" viewBox="0 0 20 12" fill="none" role="img" aria-label="arrow">
        <path
          d="M0 6h16m0 0l-4-4.5M16 6l-4 4.5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

function ArchCard({
  kind,
  name,
  purpose,
  detail
}: Readonly<{ kind: 'process' | 'package'; name: string; purpose: string; detail: string }>) {
  return (
    <article className={`about-arch-card about-arch-card--${kind}`}>
      <div className="about-arch-card__head">
        <span className="about-arch-card__kind">{kind === 'process' ? 'Process' : 'Package'}</span>
        <code className="about-arch-card__name">{name}</code>
      </div>
      <strong className="about-arch-card__role">{purpose}</strong>
      <p className="about-arch-card__detail">{detail}</p>
    </article>
  );
}

function StackCard({ tech, why }: Readonly<{ tech: string; why: string }>) {
  return (
    <article className="about-stack-card">
      <strong className="about-stack-card__tech">{tech}</strong>
      <p className="about-stack-card__why">{why}</p>
    </article>
  );
}

function DecisionCard({
  decision,
  rationale,
  tradeoff
}: Readonly<{ decision: string; rationale: string; tradeoff: string }>) {
  return (
    <article className="about-decision-card">
      <strong className="about-decision-card__title">{decision}</strong>
      <p className="about-decision-card__rationale">{rationale}</p>
      <p className="about-decision-card__tradeoff">
        <span className="about-decision-card__tradeoff-label">Trade-off:</span> {tradeoff}
      </p>
    </article>
  );
}

function ExclusionItem({ label, why }: Readonly<{ label: string; why: string }>) {
  return (
    <div className="about-exclusion">
      <strong className="about-exclusion__label">{label}</strong>
      <span className="about-exclusion__why">{why}</span>
    </div>
  );
}

function NextItem({ label, desc }: Readonly<{ label: string; desc: string }>) {
  return (
    <article className="about-next-card">
      <strong className="about-next-card__label">{label}</strong>
      <p className="about-next-card__desc">{desc}</p>
    </article>
  );
}

// ─── rail ─────────────────────────────────────────────────────────────────────

function AboutRail() {
  return (
    <>
      <section className="panel panel--muted">
        <p className="panel__label">Project facts</p>
        <div className="status-list">
          <div className="status-item">
            <span>Type</span>
            <strong>Portfolio / R&D</strong>
          </div>
          <div className="status-item">
            <span>Team</span>
            <strong>Solo developer</strong>
          </div>
          <div className="status-item">
            <span>Runtime</span>
            <strong>Bun-first</strong>
          </div>
          <div className="status-item">
            <span>Storage</span>
            <strong>S3-compatible</strong>
          </div>
          <div className="status-item">
            <span>Max file</span>
            <strong>256 MB</strong>
          </div>
          <div className="status-item">
            <span>Max retention</span>
            <strong>30 days</strong>
          </div>
        </div>
      </section>

      <nav className="panel panel--muted" aria-label="Page sections">
        <p className="panel__label">On this page</p>
        <div className="about-toc">
          <a href="#problem" className="about-toc__link">
            The problem
          </a>
          <a href="#flow" className="about-toc__link">
            System flow
          </a>
          <a href="#architecture" className="about-toc__link">
            Architecture
          </a>
          <a href="#stack" className="about-toc__link">
            Stack choices
          </a>
          <a href="#decisions" className="about-toc__link">
            Decisions & trade-offs
          </a>
          <a href="#scope" className="about-toc__link">
            Not in v1
          </a>
          <a href="#next" className="about-toc__link">
            Next steps
          </a>
        </div>
      </nav>
    </>
  );
}
