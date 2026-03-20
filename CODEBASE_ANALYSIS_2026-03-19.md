# Codebase Analysis Report

Date: 2026-03-19

## Executive Summary

anonshare.dev is in a materially better state than an average side project of similar scope. The monorepo boundaries are real, the domain/contracts split is coherent, the public sharing flow avoids the common one-time-download trap of blind presigned delivery, and the codebase currently has no workspace typecheck or lint errors.

The main risks are not baseline correctness issues. They are concentrated in four areas:

1. Operational/documentation drift: the deployment guide still describes a per-process env model that conflicts with the root env model implemented by the apps and documented as canonical elsewhere.
2. Silent failure paths in audit-sensitive telemetry: download event persistence is best-effort to the point of disappearing silently.
3. Frontend correctness/accessibility gaps in core flows: the upload switches are not reliably named for assistive tech, and the share page carries token-scoped state that is not explicitly reset across token changes.
4. Growing structural concentration: the admin web route and admin API route are both large multi-responsibility modules, which is becoming a maintainability and performance constraint.

Overall health score: 79/100

Summary judgment:

- Architecture and domain model: strong
- Security posture: solid with a few availability trade-offs
- Frontend React engineering: mostly disciplined, but with high-value fixes still pending
- Maintainability: good today, trending downward in admin-heavy areas
- Observability and operational thinking: strong, but undermined by a few swallowed failures

## Detailed Findings

### Structure and Organization

Current state assessment:

- The top-level split between [apps/web](apps/web), [apps/api](apps/api), [apps/worker](apps/worker), and [packages](packages) is coherent and matches the architectural source of truth in [docs/architecture.md](docs/architecture.md) and [docs/conventions.md](docs/conventions.md).
- Cross-process responsibilities are well chosen: UI/SSR in web, domain HTTP in API, async lifecycle in worker, shared rules/contracts/infrastructure in packages.
- The structure is weakest inside the admin surface, where large single-file route modules are accumulating orchestration, view logic, transport code, and workflow logic together.

Issues identified:

1. Deployment documentation contradicts the implemented env model.

- Canonical docs say the root .env is the source of truth for all processes in [docs/architecture.md](docs/architecture.md#L19) and [docs/conventions.md](docs/conventions.md#L21).
- The actual runtime scripts also load ../../.env in [apps/api/package.json](apps/api/package.json#L5), [apps/web/package.json](apps/web/package.json#L5), and [apps/worker/package.json](apps/worker/package.json#L5).
- But [docs/deploy.md](docs/deploy.md#L14) and [docs/deploy.md](docs/deploy.md#L31) still instruct operators to maintain separate per-process env files.

Why it matters:

- This is not a cosmetic docs issue. It creates a real operator footgun: a deployment can be configured according to the guide and still diverge from how the binaries are actually invoked.

Recommendation:

- Rewrite [docs/deploy.md](docs/deploy.md) to describe one supported production env model.
- If single-root env remains canonical, remove per-process examples and replace them with one root env contract plus process-specific required variable tables.

2. Internal admin organization has become monolithic.

- [apps/web/src/routes/admin.tsx](apps/web/src/routes/admin.tsx) is 2196 lines.
- [apps/api/src/routes/admin.ts](apps/api/src/routes/admin.ts) is 1782 lines.

Why it matters:

- These files already contain multiple responsibilities: auth/session bootstrapping, request helpers, data loading, tab-specific state, detail panels, moderation actions, queue health, anomaly views, and response shaping.
- The code still works, but it is now expensive to reason about, harder to test in slices, and likely to regress during future module work.

Recommendation:

- Split admin by feature slice rather than by arbitrary helpers.
- Web: extract route-level data loader/orchestrator, tab containers, detail panel, and transport client modules.
- API: extract session/auth gate, overview/stats, files, reports, downloads, anomalies, and queue health readers into separate route-support modules.

3. Queue ownership and Redis ownership are drifting.

- Infrastructure claims to expose a shared Redis client in [packages/infrastructure/src/redis/index.ts](packages/infrastructure/src/redis/index.ts#L13).
- API constructs BullMQ queues ad hoc in [apps/api/src/queues.ts](apps/api/src/queues.ts#L14).
- Worker also constructs its own BullMQ queues/workers directly and explicitly works around version-mismatch concerns in [apps/worker/src/index.ts](apps/worker/src/index.ts#L30).
- BullMQ versions are already misaligned between [apps/api/package.json](apps/api/package.json#L13) and [apps/worker/package.json](apps/worker/package.json#L13).

Verdict:

- ❌ Hacky. This solves immediate compatibility but weakens ownership boundaries.

Recommendation:

- Centralize queue connection creation behind a small shared queue adapter or explicit infrastructure boundary.
- Align BullMQ versions across workspaces.
- Keep the current "URL not shared Redis instance" rule if it is the correct fix, but document it as the rule instead of leaving it as a comment-local workaround.

### Code Consistency

Consistency metrics and patterns:

- Workspace errors: none from the editor problem surface.
- Suppression usage is low. Only 3 matches were found: generated route output in [apps/web/src/routeTree.gen.ts](apps/web/src/routeTree.gen.ts#L1) and two targeted accessibility ignores for media captions in [apps/web/src/routes/share.$token.tsx](apps/web/src/routes/share.$token.tsx#L206) and [apps/web/src/routes/share.$token.tsx](apps/web/src/routes/share.$token.tsx#L215).
- Generated-file casts in [apps/web/src/routeTree.gen.ts](apps/web/src/routeTree.gen.ts#L22) through [apps/web/src/routeTree.gen.ts](apps/web/src/routeTree.gen.ts#L42) are acceptable because the file is generated.

Deviations and inconsistencies found:

1. Route-level helper duplication in the API.

- Lazy DB singleton pattern duplicated in [apps/api/src/routes/upload.ts](apps/api/src/routes/upload.ts#L36), [apps/api/src/routes/share.ts](apps/api/src/routes/share.ts#L35), [apps/api/src/routes/report.ts](apps/api/src/routes/report.ts#L23), [apps/api/src/routes/auth.ts](apps/api/src/routes/auth.ts#L146), and [apps/api/src/routes/admin.ts](apps/api/src/routes/admin.ts#L158).
- IP hashing duplicated in [apps/api/src/routes/share.ts](apps/api/src/routes/share.ts#L48) and [apps/api/src/routes/report.ts](apps/api/src/routes/report.ts#L41), with a near-equivalent variant in [apps/api/src/routes/upload.ts](apps/api/src/routes/upload.ts#L19).
- Cookie parsing duplicated in [apps/api/src/routes/auth.ts](apps/api/src/routes/auth.ts#L43) and [apps/api/src/routes/admin.ts](apps/api/src/routes/admin.ts#L168).
- Error envelope helpers are repeated in upload/share/report route modules.

Verdict:

- ⚠️ Acceptable today, but drift-prone.

Recommendation:

- Extract a small internal route-support layer for:
  - lazy DB access
  - anonymous IP hashing / trust boundary handling
  - cookie parsing
  - standard API error bodies
  - share-token parsing

2. Silent catch style is inconsistently acceptable.

- There are 14 direct `.catch(() => {})` matches across app code.
- Some are acceptable cleanup paths, such as stream reader cancellation in [apps/web/src/routes/share.$token.tsx](apps/web/src/routes/share.$token.tsx#L294).
- Others suppress operational signals in API routes, especially [apps/api/src/routes/share.ts](apps/api/src/routes/share.ts#L410), [apps/api/src/routes/share.ts](apps/api/src/routes/share.ts#L431), [apps/api/src/routes/share.ts](apps/api/src/routes/share.ts#L526), [apps/api/src/routes/share.ts](apps/api/src/routes/share.ts#L600), and rate-limit metric paths such as [apps/api/src/routes/report.ts](apps/api/src/routes/report.ts#L113).

Recommendation:

- Keep silent cleanup only where failure is genuinely irrelevant and locally self-healing.
- Everywhere else, replace it with a non-throwing helper that logs with context.

### Best Practices Compliance

Adherence assessment:

- Strong alignment with separation of concerns at the monorepo level.
- Good use of shared contracts and domain helpers across surfaces.
- Good security hygiene in query construction and input schema validation.
- Most violations are local engineering trade-offs, not foundational architectural mistakes.

Violations with code references:

1. In-memory OAuth state store is deployment-fragile.

- [apps/api/src/routes/auth.ts](apps/api/src/routes/auth.ts#L22) uses `pendingOAuthStates` as an in-process Map.
- State is created in [apps/api/src/routes/auth.ts](apps/api/src/routes/auth.ts#L241), read in [apps/api/src/routes/auth.ts](apps/api/src/routes/auth.ts#L295), and consumed in [apps/api/src/routes/auth.ts](apps/api/src/routes/auth.ts#L309).

Assessment:

- ⚠️ Acceptable with caveats.
- The code clearly documents that it is intended for single-instance admin auth, and it includes expiry pruning and single-use consumption.
- It becomes fragile under API restarts or multi-instance callback routing.

Recommendation:

- Either document single-instance as a hard deployment constraint in [docs/deploy.md](docs/deploy.md), or move OAuth state to Redis / database if independent scaling is a real target.

2. Request tracking avoids stale commits but does not cancel obsolete fetches.

- The request tracker itself is sound in [apps/web/src/admin/request-tracker.ts](apps/web/src/admin/request-tracker.ts#L1).
- Admin transport helpers accept AbortSignal in [apps/web/src/routes/admin.tsx](apps/web/src/routes/admin.tsx#L114) and [apps/web/src/routes/admin.tsx](apps/web/src/routes/admin.tsx#L132).
- But tab loaders call these helpers without a signal, for example in [apps/web/src/routes/admin.tsx](apps/web/src/routes/admin.tsx#L641), [apps/web/src/routes/admin.tsx](apps/web/src/routes/admin.tsx#L939), [apps/web/src/routes/admin.tsx](apps/web/src/routes/admin.tsx#L1165), and [apps/web/src/routes/admin.tsx](apps/web/src/routes/admin.tsx#L1301).

Assessment:

- ⚠️ Acceptable.
- This protects UI correctness but not backend/network cost.

Recommendation:

- Pair the request tracker with AbortController ownership so last-request-wins also cancels stale network work.

3. Admin route is client-waterfall driven.

- [apps/web/src/routes/admin.tsx](apps/web/src/routes/admin.tsx#L1944) loads dashboard state inside an effect after rendering a loading shell.

Assessment:

- ⚠️ Acceptable for current scope, but not aligned with the stronger SSR/route-loader patterns already used elsewhere.

Recommendation:

- Move admin session/bootstrap fetches to route-level loading where feasible, then keep client refresh only for interactive refresh/revalidation.

### Clean Code Analysis

Readability and maintainability metrics:

- [apps/web/src/routes/admin.tsx](apps/web/src/routes/admin.tsx): 2196 lines
- [apps/api/src/routes/admin.ts](apps/api/src/routes/admin.ts): 1782 lines
- [apps/web/src/routes/share.$token.tsx](apps/web/src/routes/share.$token.tsx): 890 lines
- [apps/api/src/routes/share.ts](apps/api/src/routes/share.ts): 817 lines

Code smells and anti-patterns detected:

1. Local state on the share page is not explicitly keyed to token changes.

- Token-scoped state is initialized in [apps/web/src/routes/share.$token.tsx](apps/web/src/routes/share.$token.tsx#L479) through [apps/web/src/routes/share.$token.tsx](apps/web/src/routes/share.$token.tsx#L496).
- There is no token-reset effect for consumed, preview, runtime unavailable, or report panel state.

Risk:

- If the same route instance is reused across token transitions, stale state from file A can bleed into file B.

Recommendation:

- Reset token-scoped UI state when token changes, or remount the token-scoped subtree using the token as a key.

2. Login error parsing and URL cleanup are coupled into route mount logic.

- [apps/web/src/routes/admin.tsx](apps/web/src/routes/admin.tsx#L1952) parses query params and mutates history in a mount effect.

Assessment:

- ⚠️ Acceptable, but brittle and harder to test than route-search parsing.

Recommendation:

- Prefer route-search parsing through the router boundary, which would make the error state explicit and testable without touching `window.history` imperatively.

3. Silent local logout on server failure hides a real inconsistency.

- [apps/web/src/routes/admin.tsx](apps/web/src/routes/admin.tsx#L1987) swallows logout POST failures and proceeds locally.

Assessment:

- ⚠️ Acceptable for UX continuity, but it should at least surface a non-blocking warning in the UI or logs.

### Performance and Efficiency Review

Performance strengths:

- The upload route applies a content-length preflight check before multipart parsing in [apps/api/src/routes/upload.ts](apps/api/src/routes/upload.ts#L248).
- Bun transport body size is capped in [apps/api/src/index.ts](apps/api/src/index.ts#L25).
- Text preview streaming in [apps/web/src/routes/share.$token.tsx](apps/web/src/routes/share.$token.tsx#L250) avoids fully buffering large text files in the browser.
- One-time downloads use backend-controlled compare-and-set instead of blind client-only coordination in [apps/api/src/routes/share.ts](apps/api/src/routes/share.ts#L443).

Performance issues identified:

1. Admin requests are last-result-wins, not last-request-aborts.

- Obsolete requests still run to completion despite request tracking.
- This can create unnecessary backend load during rapid filter changes.

2. Large route modules prevent easy code-splitting and increase mental overhead.

- The monolithic admin route bundles multiple tab flows into a single route module.

3. Server-side locale-sensitive date formatting on share pages risks hydration churn.

- [apps/web/src/routes/share.$token.tsx](apps/web/src/routes/share.$token.tsx#L776) uses `toLocaleDateString(undefined, ...)` in an SSR route.

Recommendation:

- Format dates with a deterministic locale/time-zone on the server, or render a machine-readable timestamp and localize on the client after hydration if product requirements demand client-local time.

### Security Audit

Security strengths:

- SQL injection resistance is strong: query construction consistently uses Drizzle rather than interpolated SQL.
- Input validation is good across upload/report/admin auth flows using shared schemas.
- Share tokens are validated before DB work in the public share flow.
- One-time download delivery uses an atomic compare-and-set pattern, which is the correct architectural shape for this product.
- Session allowlisting uses the stable numeric GitHub ID rather than login name.

Vulnerabilities and risks:

1. Download audit events can disappear silently.

- Started/completed/blocked event inserts are deliberately non-blocking in [apps/api/src/routes/share.ts](apps/api/src/routes/share.ts#L410), [apps/api/src/routes/share.ts](apps/api/src/routes/share.ts#L431), [apps/api/src/routes/share.ts](apps/api/src/routes/share.ts#L526), and [apps/api/src/routes/share.ts](apps/api/src/routes/share.ts#L600).

Severity:

- High

Why it matters:

- This does not create unauthorized access, but it weakens forensic reliability, usage reporting, and admin visibility exactly in the code path where observability matters most.

Remediation:

- Replace fire-and-forget silent inserts with a shared helper that logs failures with requestId/fileId/eventType.
- Consider an outbox/job pattern if event durability matters more than request latency.

2. Rate limiting is intentionally permissive under Redis degradation.

- Report degradation is explicit in [apps/api/src/routes/report.ts](apps/api/src/routes/report.ts#L145).
- Similar patterns exist in upload/share rate limiting.

Severity:

- Medium

Assessment:

- ⚠️ Acceptable trade-off, not a bug by itself.
- It preserves availability but opens a temporary abuse window during Redis outages.

Remediation:

- Keep the degraded-open strategy if that is the product decision, but surface a strong operational alert and dashboard signal when it occurs.

3. X-Forwarded-For is trusted as the anonymous rate-limit source.

- [apps/api/src/routes/upload.ts](apps/api/src/routes/upload.ts#L201), [apps/api/src/routes/report.ts](apps/api/src/routes/report.ts#L86), and [apps/api/src/routes/share.ts](apps/api/src/routes/share.ts#L151) read forwarded IP headers directly.

Severity:

- Medium

Assessment:

- This is normal behind a trusted reverse proxy.
- It should be documented as a deployment assumption so the app is not run behind an unsanitized proxy chain.

4. HTTPS enforcement is configuration-dependent.

- OAuth redirect construction uses base URL configuration in [apps/api/src/routes/auth.ts](apps/api/src/routes/auth.ts#L243) and [apps/api/src/routes/auth.ts](apps/api/src/routes/auth.ts#L333).

Severity:

- Low to medium

Assessment:

- This is acceptable if deployment validation guarantees HTTPS in production.
- The deploy guide should state it explicitly.

### Solution Intelligence Assessment

#### Evaluated Implementations

| Implementation | Verdict | Assessment |
|---|---|---|
| One-time download compare-and-set in [apps/api/src/routes/share.ts](apps/api/src/routes/share.ts#L443) | ✅ Intelligent | Solves the actual race condition at the backend boundary rather than pretending presigned URLs are atomic |
| Transactional report auto-hide in [apps/api/src/routes/report.ts](apps/api/src/routes/report.ts#L200) | ✅ Intelligent | Good domain fit and correct consistency boundary |
| Shared request tracker in [apps/web/src/admin/request-tracker.ts](apps/web/src/admin/request-tracker.ts) | ⚠️ Acceptable | Good stale-response guard, but incomplete without actual request cancellation |
| In-memory OAuth state in [apps/api/src/routes/auth.ts](apps/api/src/routes/auth.ts#L22) | ⚠️ Acceptable | Coherent for single-instance deployments, fragile otherwise |
| Silent download event persistence failures in [apps/api/src/routes/share.ts](apps/api/src/routes/share.ts#L410) | ❌ Hacky | Hides failures in an audit-sensitive path |
| Deploy guide env model in [docs/deploy.md](docs/deploy.md#L14) | ❌ Hacky | Contradicts the implemented runtime contract |
| Queue/Redis ownership split between [apps/api/src/queues.ts](apps/api/src/queues.ts), [apps/worker/src/index.ts](apps/worker/src/index.ts), and [packages/infrastructure/src/redis/index.ts](packages/infrastructure/src/redis/index.ts) | ❌ Hacky | Solves version friction with local workarounds instead of a stable ownership rule |
| Upload access-rule switches in [apps/web/src/routes/index.tsx](apps/web/src/routes/index.tsx#L333) | ❌ Hacky | Core UI control is visually fine but semantically under-specified for assistive tech |

#### Detailed Hacky Findings And Refactoring Recommendations

1. Silent audit-event persistence

Problem:

- The code uses fire-and-forget inserts with `.catch(() => {})` in the download path.

Why this is hacky:

- It makes failures disappear instead of handling them intentionally.
- It optimizes for a clean request path by sacrificing observability integrity.

Before:

```ts
resolveDb()
  .insert(downloadEvents)
  .values({ fileId: file.id, eventType: 'completed', ipHash })
  .catch(() => {});
```

After:

```ts
void persistDownloadEvent({
  db: resolveDb(),
  logger,
  requestId,
  fileId: file.id,
  eventType: 'completed',
  ipHash,
});

async function persistDownloadEvent(params: {
  db: ReturnType<typeof createDb>;
  logger: typeof logger;
  requestId: string;
  fileId: string;
  eventType: 'started' | 'completed' | 'blocked';
  ipHash: string | null;
}) {
  try {
    await params.db.insert(downloadEvents).values({
      fileId: params.fileId,
      eventType: params.eventType,
      ipHash: params.ipHash,
    });
  } catch (err) {
    params.logger.error('Download event persistence failed', {
      event: 'download_event_persist_failed',
      requestId: params.requestId,
      entity: { type: 'file', id: params.fileId },
      outcome: 'failure',
      eventType: params.eventType,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
```

2. Deployment guide contradicting runtime reality

Problem:

- The deploy guide tells operators to manage separate env files even though the implemented processes load a shared root env.

Why this is hacky:

- It patches documentation around old assumptions instead of documenting the actual system.

Before:

```md
Each process reads its own `.env` file.

# apps/api/.env
...

# apps/web/.env
...
```

After:

```md
The supported deployment model uses one root environment contract.
All processes read from the same deployment environment, while each process
consumes only the variables relevant to it.

Required by API:
- APP_BASE_URL
- DATABASE_URL
- REDIS_URL
- ...

Required by Web:
- APP_BASE_URL
- APP_API_URL

Required by Worker:
- DATABASE_URL
- REDIS_URL
- WORKER_HEALTH_PORT
- ...
```

3. Queue ownership drift

Problem:

- Queue creation lives partly in app code, partly in infrastructure commentary, with mismatched BullMQ versions already present.

Why this is hacky:

- The current code works, but the ownership rule is implicit and fragile.

Before:

```ts
const connection = { url: config.redisUrl };
const expireQueue = new Queue(QUEUE_EXPIRE_FILE, { connection });
```

After:

```ts
const connection = createQueueConnection();
const expireQueue = createLifecycleQueue(QUEUE_EXPIRE_FILE, connection);
```

Where:

- `createQueueConnection()` is the canonical place that encodes the "URL-based connection, not shared Redis client" rule.
- API and worker both depend on the same adapter and same BullMQ version.

4. Upload switches without explicit accessible names

Problem:

- The visible labels are outside the button semantics, so the switches are not reliably named for assistive technology.

Why this is hacky:

- The control looks correct but skips the semantic contract of the component.

Before:

```tsx
<label className="option-row">
  <div className="option-row__text">
    <span className="option-row__name">One-time download</span>
  </div>
  <button type="button" role="switch" aria-checked={oneTime}>
    <span className="toggle__thumb" />
  </button>
</label>
```

After:

```tsx
<label className="option-row">
  <div className="option-row__text">
    <span id="one-time-label" className="option-row__name">One-time download</span>
  </div>
  <button
    type="button"
    role="switch"
    aria-labelledby="one-time-label"
    aria-checked={oneTime}
  >
    <span className="toggle__thumb" />
  </button>
</label>
```

#### Prioritized Hacky Solutions Ordered By Risk And Impact

1. Silent download audit-event loss in [apps/api/src/routes/share.ts](apps/api/src/routes/share.ts#L410)
2. Deploy guide env-model drift in [docs/deploy.md](docs/deploy.md#L14)
3. Queue ownership/version drift across API, worker, and infrastructure boundaries
4. Upload switches lacking explicit accessible names in [apps/web/src/routes/index.tsx](apps/web/src/routes/index.tsx#L333)

### Frontend, React 19, and Hooks Review

Frontend architecture assessment:

- The web app generally keeps presentation and orchestration separate better than many small projects.
- The about page and site shell are clean, SSR-aware, and semantically structured.
- The share page appropriately uses a route loader and route head generation in [apps/web/src/routes/share.$token.tsx](apps/web/src/routes/share.$token.tsx#L26).
- The admin surface is the main exception: it concentrates data fetching, navigation, mutation flows, and multiple subviews into a single route file.

React-specific findings:

1. There is not broad misuse of effects for derived state.

- Only 9 `useEffect` matches were found in the web app, mostly in admin and preview-loading flows.
- This is a good sign. The codebase is not using effects as a generic state-synchronization crutch.

2. The highest-value React issue is token-scoped state on the share page.

- [apps/web/src/routes/share.$token.tsx](apps/web/src/routes/share.$token.tsx#L479) through [apps/web/src/routes/share.$token.tsx](apps/web/src/routes/share.$token.tsx#L496) keep consumed, preview, and reporting state locally.
- There is no explicit reset keyed to token changes.

3. SSR date formatting is locale-sensitive.

- [apps/web/src/routes/share.$token.tsx](apps/web/src/routes/share.$token.tsx#L776) uses locale-sensitive formatting in an SSR route.

4. Admin bootstrapping is effect-first rather than route-loader-first.

- [apps/web/src/routes/admin.tsx](apps/web/src/routes/admin.tsx#L1944) fetches core dashboard state after initial render.
- This is workable, but it underuses the router and guarantees an initial client loading shell.

5. Accessibility gap in the upload switches is a real product issue.

- [apps/web/src/routes/index.tsx](apps/web/src/routes/index.tsx#L333) and [apps/web/src/routes/index.tsx](apps/web/src/routes/index.tsx#L354) should be treated as a high-priority frontend fix because they sit on the primary funnel.

Good patterns worth preserving:

- Shared runtime response parsing and defensive narrowing on the share page.
- The request tracker abstraction in [apps/web/src/admin/request-tracker.ts](apps/web/src/admin/request-tracker.ts) as a protection against stale async state commits.
- Limited use of effects overall.
- Semantic layout in [apps/web/src/components/site-frame.tsx](apps/web/src/components/site-frame.tsx).

Testing gaps on the frontend:

- Current web tests are helper and SSR oriented: [apps/web/src/about/page.test.tsx](apps/web/src/about/page.test.tsx), [apps/web/src/share/page-head.test.ts](apps/web/src/share/page-head.test.ts), [apps/web/src/share/reporting.test.ts](apps/web/src/share/reporting.test.ts), [apps/web/src/admin/request-tracker.test.ts](apps/web/src/admin/request-tracker.test.ts), [apps/web/src/admin/dashboard.test.ts](apps/web/src/admin/dashboard.test.ts).
- There are no route-level tests for the core upload page, share page interactions, or admin dashboard interaction flows.

## Actionable Recommendations

Priority 0: correctness and operator clarity

1. Fix the upload switch accessibility semantics in [apps/web/src/routes/index.tsx](apps/web/src/routes/index.tsx#L333).
2. Replace silent download-event catches in [apps/api/src/routes/share.ts](apps/api/src/routes/share.ts#L410).
3. Rewrite [docs/deploy.md](docs/deploy.md) to match the real env and topology contract.

Priority 1: maintainability and frontend correctness

1. Reset share-page token-scoped state on token changes.
2. Remove locale-sensitive SSR date formatting from [apps/web/src/routes/share.$token.tsx](apps/web/src/routes/share.$token.tsx#L776).
3. Add AbortController-based cancellation to admin requests.
4. Split the admin web and API routes by feature slice.

Priority 2: operational hardening

1. Decide whether single-instance OAuth state is a hard product constraint or a temporary shortcut.
2. Define and document the canonical queue/Redis ownership rule.
3. Surface degraded-open rate-limiting states more aggressively in admin/ops visibility.

Priority 3: testing depth

1. Add route-level tests for upload controls and share-page state transitions.
2. Add admin interaction tests covering login error parsing, access loss, and rapid filter changes.

## Appendix

### Metrics and Statistics

- Workspace errors: 0
- Large route files:
  - [apps/web/src/routes/admin.tsx](apps/web/src/routes/admin.tsx): 2196 lines
  - [apps/api/src/routes/admin.ts](apps/api/src/routes/admin.ts): 1782 lines
  - [apps/web/src/routes/share.$token.tsx](apps/web/src/routes/share.$token.tsx): 890 lines
  - [apps/api/src/routes/share.ts](apps/api/src/routes/share.ts): 817 lines
- `useEffect` matches in web app: 9
- direct `.catch(() => {})` matches in app code: 14
- route-level accessibility ignore comments: 2 targeted ignores in share media previews
- web test files found: 9, but none covering the primary upload/share/admin routes end to end

### Tools and Methodologies Used

- Architectural baseline review against [docs/architecture.md](docs/architecture.md) and [docs/conventions.md](docs/conventions.md)
- Workspace problem scan through editor diagnostics
- Pattern searches for suppressions, hooks, `any`, silent catches, and duplication
- Focused subagent reviews for architecture, frontend/React, and security/performance
- Manual validation of cited code paths in API, web, worker, infrastructure, and docs

### References and Resources

- [docs/architecture.md](docs/architecture.md)
- [docs/conventions.md](docs/conventions.md)
- [docs/deploy.md](docs/deploy.md)
- [apps/api/src/routes/share.ts](apps/api/src/routes/share.ts)
- [apps/api/src/routes/auth.ts](apps/api/src/routes/auth.ts)
- [apps/web/src/routes/index.tsx](apps/web/src/routes/index.tsx)
- [apps/web/src/routes/share.$token.tsx](apps/web/src/routes/share.$token.tsx)
- [apps/web/src/routes/admin.tsx](apps/web/src/routes/admin.tsx)