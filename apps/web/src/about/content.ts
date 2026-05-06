export const ABOUT_PAGE_PATH = '/about';
export const ABOUT_PAGE_TITLE = 'anonshare | About';
export const ABOUT_PAGE_DESCRIPTION =
  'A non-commercial anonymous file-sharing platform built as a portfolio artifact. Learn about the product goals, architecture, operating model, and trade-offs.';

const DEFAULT_ABOUT_BASE_URL = 'http://localhost:3000';

export const ABOUT_HERO = {
  eyebrow: 'About this project',
  title: 'Anonymous sharing, built to be understood.',
  summary:
    'anonshare is a non-commercial personal R&D project that behaves like a real product: real uploads, enforced access rules, background jobs, moderation controls, and an operator dashboard. It exists to validate a Bun-first stack in a realistic product context and to make the architecture and trade-offs legible to anyone evaluating the technical thinking.'
};

export const ABOUT_SECTION_LINKS = [
  { href: '#problem', label: 'The problem' },
  { href: '#audience', label: 'Who it serves' },
  { href: '#goals', label: 'What v1 optimizes for' },
  { href: '#flow', label: 'System flow' },
  { href: '#architecture', label: 'Architecture' },
  { href: '#stack', label: 'Stack choices' },
  { href: '#operations', label: 'Operational controls' },
  { href: '#decisions', label: 'Decisions & trade-offs' },
  { href: '#limitations', label: 'Known limitations' },
  { href: '#scope', label: 'Not in v1' },
  { href: '#next', label: 'Next steps' }
];

type AboutSupportEnv = Readonly<Record<string, string | undefined>> & {
  VITE_SUPPORT_WALLET_ADDRESS?: string;
  VITE_SUPPORT_WALLET_LABEL?: string;
  VITE_SUPPORT_WALLET_QR_VALUE?: string;
};

export function getAboutSupportConfig(
  env: AboutSupportEnv = import.meta.env as AboutSupportEnv
): null | { address: string; label: string; qrValue: string } {
  const address = env.VITE_SUPPORT_WALLET_ADDRESS?.trim();

  if (!address) return null;

  const label = env.VITE_SUPPORT_WALLET_LABEL?.trim() || 'Crypto';
  const qrValue = env.VITE_SUPPORT_WALLET_QR_VALUE?.trim() || address;

  return { address, label, qrValue };
}

export const ABOUT_AUDIENCES = [
  {
    eyebrow: 'Primary audience',
    title: 'Anonymous uploader',
    body: 'Needs to share one file quickly without creating an account or handing over personal data.',
    aside:
      'Outcome: upload-first flow with one-time, expiration, and preview rules set before submission.'
  },
  {
    eyebrow: 'Primary audience',
    title: 'Recipient',
    body: 'Needs a clear answer when opening a link: preview, download, expired, hidden, deleted, or already consumed.',
    aside:
      'Outcome: public file pages make state explicit instead of collapsing every failure into a generic error.'
  },
  {
    eyebrow: 'Operator',
    title: 'Single admin',
    body: 'Needs moderation, lifecycle visibility, queue health, and storage awareness in one place without building a support team around the product.',
    aside: 'Outcome: a GitHub-protected dashboard with triage, queue telemetry, and anomaly review.'
  },
  {
    eyebrow: 'Portfolio reviewer',
    title: 'Engineer or recruiter',
    body: 'Needs to understand what the product does and why the architecture looks the way it does, without reading the whole repo first.',
    aside:
      'Outcome: this page turns implementation choices into an intentional, interview-ready narrative.'
  }
];

export const ABOUT_GOALS = [
  {
    eyebrow: 'Product goal',
    title: 'Fast anonymous sharing',
    body: 'Keep the path from landing page to copyable link short, while still making access rules explicit before upload begins.'
  },
  {
    eyebrow: 'Product goal',
    title: 'Trustworthy file state',
    body: 'Make recipients understand what happened to a file: available, expired, hidden, deleted, or consumed. State clarity matters as much as the download itself.'
  },
  {
    eyebrow: 'Operational goal',
    title: 'Solo-operable lifecycle',
    body: 'Favor boundaries, observability, and repairability so one person can run the system without silent failure becoming the default.'
  }
];

export const ABOUT_FLOW_STEPS = [
  { index: '01', label: 'Upload', desc: 'Validate file, MIME type, size, and options.' },
  {
    index: '02',
    label: 'Store',
    desc: 'Persist metadata in PostgreSQL and stream the object into S3-compatible storage.'
  },
  {
    index: '03',
    label: 'Share',
    desc: 'Generate an unguessable link with the configured access rules.'
  },
  {
    index: '04',
    label: 'Consume',
    desc: 'Download or preview, with one-time access enforced through a backend-controlled path.'
  },
  {
    index: '05',
    label: 'Lifecycle',
    desc: 'Expiration jobs, cleanup, and reconciliation maintain correctness over time.'
  },
  {
    index: '06',
    label: 'Moderate',
    desc: 'Reports, auto-hiding, and admin review reduce abuse exposure.'
  }
];

export const ABOUT_ARCHITECTURE = [
  {
    kind: 'process' as const,
    name: 'apps/web',
    purpose: 'Public UI · Admin shell',
    detail:
      'TanStack Start with SSR. Serves the upload form, share pages, about page, and admin dashboard. The web app can consume shared contracts and domain helpers for display and validation, while mutations still go through the API boundary.'
  },
  {
    kind: 'process' as const,
    name: 'apps/api',
    purpose: 'Domain HTTP boundary',
    detail:
      'Hono on Bun. Handles upload, download, report, admin, and internal endpoints. Validates requests, orchestrates storage, and enforces access rules.'
  },
  {
    kind: 'process' as const,
    name: 'apps/worker',
    purpose: 'Async lifecycle work',
    detail:
      'BullMQ consumers on Bun. Processes expiration, cleanup, one-time post-download removal, and periodic reconciliation jobs.'
  },
  {
    kind: 'package' as const,
    name: 'packages/domain',
    purpose: 'Business rules',
    detail:
      'Pure TypeScript state transitions, file status rules, and validation invariants. No infrastructure dependencies.'
  },
  {
    kind: 'package' as const,
    name: 'packages/contracts',
    purpose: 'Shared types & schemas',
    detail:
      'Zod schemas for API requests and responses, error codes, and job payloads. Consumed by web, API, and worker without duplication.'
  },
  {
    kind: 'package' as const,
    name: 'packages/infrastructure',
    purpose: 'Platform primitives',
    detail:
      'Database connection, Drizzle schema and migrations, Redis client, S3-compatible storage adapter, rate limiter, logger, and config validation.'
  }
];

export const ABOUT_STACK = [
  {
    tech: 'Bun',
    why: 'Single runtime, package manager, bundler, and test runner. It reduces toolchain fragmentation and keeps the feedback loop fast enough for a solo project.'
  },
  {
    tech: 'TanStack Start',
    why: 'SSR, file-based routing, and type-safe loaders let the same web surface own public routes, share pages, and the admin shell without a second frontend architecture.'
  },
  {
    tech: 'Hono',
    why: 'Lightweight HTTP boundary with clean middleware semantics and strong Bun support. The API stays explicit instead of disappearing into framework magic.'
  },
  {
    tech: 'PostgreSQL + Drizzle',
    why: 'Relational storage with strong consistency guarantees for file state, reports, sessions, and anomalies. Drizzle keeps schema and migrations close to the code.'
  },
  {
    tech: 'Redis + BullMQ',
    why: 'Redis backs rate limiting, queue state, and fast operational lookups. BullMQ handles delayed expiration, retries, cleanup, and recurring reconciliation.'
  },
  {
    tech: 'S3-compatible storage',
    why: "Provider-agnostic object storage through Bun's native S3 API. MinIO works locally and production can target AWS S3 or Cloudflare R2 without rewriting the domain layer."
  },
  {
    tech: 'GitHub OAuth',
    why: 'A single allowlisted GitHub identity protects the admin surface. That matches the real operating model better than inventing a multi-user auth system early.'
  }
];

export const ABOUT_OPERATIONS = [
  {
    eyebrow: 'Observability',
    title: 'Structured logs with request correlation',
    body: 'API, worker, and operational scripts emit event-oriented logs with requestId, actor, entity, and outcome whenever those fields exist.'
  },
  {
    eyebrow: 'Readiness',
    title: 'Health checks that probe real dependencies',
    body: 'GET /health and bun run infra:check verify PostgreSQL, Redis, and storage contracts instead of assuming container health means application readiness.'
  },
  {
    eyebrow: 'Abuse control',
    title: 'Rate limiting on risky public surfaces',
    body: 'Upload, report, and repeated link access are Redis-backed and degrade safely when Redis is temporarily unavailable, preserving UX where feasible.'
  },
  {
    eyebrow: 'Operator UX',
    title: 'Queue and anomaly visibility in the dashboard',
    body: 'The admin surface exposes queue lag, failed jobs, report pressure, and lifecycle anomalies so moderation and operational issues do not stay invisible.'
  }
];

export const ABOUT_DECISIONS = [
  {
    decision: 'One-time download uses a backend-controlled path',
    rationale:
      'Blind presigned URLs cannot guarantee atomic consumption. Retries, partial transfers, and concurrent requests create race conditions, so the backend reserves consumption before streaming the file.',
    tradeoff:
      'Higher backend involvement than presigned-only delivery, but it preserves the one-time promise instead of approximating it.'
  },
  {
    decision: 'Storage is provider-agnostic',
    rationale:
      "The adapter targets S3-compatible APIs through Bun's native S3 support. MinIO runs locally, while R2 or S3 can back production without vendor-specific domain logic.",
    tradeoff:
      'Fewer vendor-specific optimizations up front, but lower lock-in and simpler portability.'
  },
  {
    decision: 'Reconciliation is a first-class concern',
    rationale:
      'Delayed jobs are necessary but not sufficient. A recurring reconciler repairs missed expirations, orphaned objects, and metadata-storage drift instead of hoping queues never miss.',
    tradeoff:
      'Adds scheduler and anomaly-management overhead, but keeps correctness from depending on one happy-path job execution.'
  },
  {
    decision: 'Auto-hide favors containment over certainty',
    rationale:
      'Anonymous upload raises moderation risk quickly. Files become hidden after a configurable report threshold so the public surface reacts before an admin can manually review every case.',
    tradeoff:
      'False positives remain possible, so restore is a first-class admin action rather than an afterthought.'
  },
  {
    decision: 'Web, API, and worker stay separate',
    rationale:
      'The web serves UI, the API owns domain mutations, and the worker owns asynchronous lifecycle work. That keeps the system understandable as it grows.',
    tradeoff:
      'Operationally heavier than a single process, but much harder to entangle by accident.'
  }
];

export const ABOUT_LIMITATIONS = [
  {
    eyebrow: 'Known limitation',
    title: 'Uploads are server-mediated in v1',
    body: 'The initial upload path prioritizes observability and simpler consistency handling over the lower bandwidth cost of direct presigned uploads.'
  },
  {
    eyebrow: 'Known limitation',
    title: 'Preview is intentionally narrow',
    body: 'Only supported MIME types are previewable, and one-time files never expose preview because that would undermine single-consumption semantics.'
  },
  {
    eyebrow: 'Known limitation',
    title: 'Moderation is intentionally simple',
    body: 'Auto-hide is threshold-based and operated by one admin. It is designed for fast containment in a solo project, not for enterprise review workflows.'
  },
  {
    eyebrow: 'Known limitation',
    title: 'The product favors depth over breadth',
    body: 'anonshare is intentionally narrower than consumer file-sharing suites. The point of v1 is to make trade-offs explicit, not to imitate every adjacent product feature.'
  }
];

export const ABOUT_EXCLUSIONS = [
  {
    label: 'Multi-user accounts',
    why: 'Anonymity is the core UX for uploaders and recipients.'
  },
  {
    label: 'Billing & subscriptions',
    why: 'The project is non-commercial and optimized for hobby-budget infrastructure.'
  },
  {
    label: 'End-to-end encryption',
    why: 'Client-side key management would materially complicate the anonymous flow and recovery model.'
  },
  {
    label: 'Malware scanning',
    why: 'Useful, but it requires an extra scanning service and a different activation model than v1 currently ships.'
  },
  {
    label: 'Password-protected shares',
    why: 'That adds auth-like friction to a product whose main value is a zero-onboarding share path.'
  },
  {
    label: 'Multi-admin support',
    why: 'The operating model is one allowlisted GitHub identity, not a team console.'
  },
  {
    label: 'Folder & collaboration features',
    why: 'anonshare is a single-file, single-link workflow rather than a workspace product.'
  }
];

export const ABOUT_NEXT_STEPS = [
  {
    label: 'Presigned uploads',
    desc: 'Move large file bodies off the application server for lower latency and lower bandwidth cost.',
    impact:
      'Would improve throughput, but requires a tighter activation handshake so metadata and storage remain consistent.'
  },
  {
    label: 'Malware scanning',
    desc: 'Scan uploads before activation to reduce abuse and operator risk.',
    impact:
      'Improves trust and moderation posture, but adds a new service dependency and longer activation paths.'
  },
  {
    label: 'Password-protected links',
    desc: 'Add an optional passphrase layer to public share links.',
    impact:
      'Raises recipient-side protection, but changes the current open-link-immediately product shape.'
  },
  {
    label: 'Richer download analytics',
    desc: 'Expand per-file telemetry for the admin dashboard beyond counts and queue signals.',
    impact:
      'Improves investigation and capacity planning, but increases data-retention and privacy-design decisions.'
  }
];

function normalizeBaseUrl(baseUrl?: string): string {
  return (baseUrl?.trim() || DEFAULT_ABOUT_BASE_URL).replace(/\/+$/, '');
}

export function getAboutUrl(baseUrl?: string): string {
  return `${normalizeBaseUrl(baseUrl)}${ABOUT_PAGE_PATH}`;
}

export function getAboutHead(baseUrl?: string) {
  const url = getAboutUrl(baseUrl);

  return {
    meta: [
      { title: ABOUT_PAGE_TITLE },
      { name: 'description', content: ABOUT_PAGE_DESCRIPTION },
      { name: 'robots', content: 'index, follow' },
      { property: 'og:type', content: 'website' },
      { property: 'og:site_name', content: 'anonshare' },
      { property: 'og:title', content: ABOUT_PAGE_TITLE },
      { property: 'og:description', content: ABOUT_PAGE_DESCRIPTION },
      { property: 'og:url', content: url },
      { name: 'twitter:card', content: 'summary' },
      { name: 'twitter:title', content: ABOUT_PAGE_TITLE },
      { name: 'twitter:description', content: ABOUT_PAGE_DESCRIPTION }
    ],
    links: [{ rel: 'canonical', href: url }]
  };
}
