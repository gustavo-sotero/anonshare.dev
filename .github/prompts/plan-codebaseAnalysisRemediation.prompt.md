## Refactor Plan: Codebase Analysis Remediation Sweep

### Current State

The workspace is functionally healthy but carries a concentrated set of risks identified in the codebase review:

- Operational and documentation drift exists between the canonical root environment model implemented by the runtime scripts and the per-process environment model still described in deployment documentation.
- BullMQ ownership is split implicitly across API and worker runtime code while Redis ownership is partly centralized in infrastructure, and the API and worker currently declare different BullMQ versions.
- Public download telemetry is persisted on a best-effort basis with silent failure paths in the share route, which undermines auditability, admin diagnostics, and trend accuracy.
- API route modules repeat the same low-level helpers for DB resolution, cookie parsing, anonymous IP hashing, share-token parsing, and error-envelope construction.
- Public web correctness gaps remain in the primary funnel: upload switches do not have explicit accessible names, the share page keeps token-scoped local state without an explicit reset boundary, and SSR-facing date formatting is locale-sensitive.
- The admin web route and admin API route have become structural hot spots, combining transport, orchestration, state, parsing, feature rendering, and workflow logic in single large modules.
- GitHub OAuth pending state is currently process-local and stored in memory, which is not restart-safe and does not support multi-instance callback routing.
- Test coverage is strong around helpers and many route factories, but route-level web interaction coverage is still missing for the primary upload/share/admin flows and there are still untested branches in API observability/error handling.

### Target State

After this remediation program:

- The runtime, CI, local platform tooling, and deployment documentation all describe and enforce the same supported environment contract.
- BullMQ ownership is explicit and stable: queue names and retention remain contract-driven, connection creation is centralized behind a canonical adapter, producer and worker connection policies are documented and consistent, and package versions are aligned.
- Download event persistence remains non-blocking for user-facing latency but no longer fails silently; failures are logged with structured context and become diagnosable from operations and admin surfaces.
- Shared API route-support helpers eliminate drift in repeated concerns without breaking the existing route-factory testing pattern.
- The upload and share public flows are correct and accessible: switches have explicit names, token transitions do not leak previous token state, and SSR output is deterministic on first render.
- OAuth pending state is durable, single-use, TTL-bound, and restart-safe.
- Admin web and admin API code are reorganized by feature slice, reducing regression risk for later work and making route-level testing practical.
- CI and readiness checks exercise the newly hardened paths, including documentation accuracy, health smoke behavior, and expanded tests.

### Context Map

#### Files to Modify

| File | Purpose | Changes Needed |
|------|---------|----------------|
| docs/deploy.md | Production/deployment guide | Rewrite to match actual env contract, OAuth durability, trusted proxy assumptions, HTTPS, Redis/BullMQ ownership |
| docs/architecture.md | Canonical architecture source | Clarify env model, process health semantics, queue ownership, auth durability assumptions |
| docs/conventions.md | Engineering conventions | Record canonical runtime config rules, route-support extraction rules, admin slicing rules |
| docs/readiness-checklist.md | Manual release validation | Add checks for auth durability, queue ownership consistency, health asymmetry, docs/runtime parity |
| README.md | Developer/operator entrypoint | Keep onboarding consistent with the supported environment model |
| package.json | Root workspace scripts | Add or align verification scripts for consistency and docs/runtime checks |
| apps/api/package.json | API runtime manifest | Align BullMQ version and keep root env script semantics coherent |
| apps/worker/package.json | Worker runtime manifest | Align BullMQ version and worker lifecycle expectations |
| apps/api/src/queues.ts | API BullMQ producer construction | Move to canonical queue/connection factory layer |
| apps/worker/src/index.ts | Worker bootstrap | Consume canonical queue connection policy and align shutdown/health semantics |
| packages/contracts/src/schemas/jobs.ts | Queue contract registry | Keep queue names/retention as single source of truth |
| packages/infrastructure/src/config/index.ts | Env validation and config access | Expose canonical queue/auth/runtime config entrypoints if needed |
| packages/infrastructure/src/redis/index.ts | Shared Redis client/probe | Keep shared Redis ownership distinct from BullMQ while documenting the rule in code |
| packages/infrastructure/src/health/index.ts | Shared dependency health checks | Reflect any new auth/queue/readiness assumptions |
| packages/infrastructure/src/rate-limit/index.ts | Rate-limit primitives | Centralize degraded-open telemetry and blocked-metric signaling helpers |
| apps/api/src/routes/share.ts | Public metadata/download/preview route | Remove silent telemetry failures and consume shared helper layer |
| apps/api/src/routes/upload.ts | Public upload route | Reuse canonical helper layer and degraded-open telemetry path |
| apps/api/src/routes/report.ts | Public report route | Reuse canonical helper layer and degraded-open telemetry path |
| apps/api/src/routes/auth.ts | GitHub OAuth route | Replace in-memory pending state with durable store and shared cookie parsing helpers |
| apps/api/src/routes/admin.ts | Admin API monolith | Split by feature slice while preserving route contract |
| apps/api/src/app.ts | API app assembly | Keep mounted route surface stable during internal admin refactor |
| apps/api/src/routes/share.test.ts | Share route coverage | Add tests for failed event persistence/logging and degraded observability |
| apps/api/src/routes/upload.test.ts | Upload route coverage | Add tests for shared helper behavior and degraded metrics/logging |
| apps/api/src/routes/report.test.ts | Report route coverage | Add tests for shared helper behavior and degraded metrics/logging |
| apps/api/src/routes/auth.test.ts | Auth route coverage | Add durable-state TTL, single-use, restart-safe callback tests |
| apps/api/src/routes/admin.test.ts | Admin route coverage | Preserve response contracts through feature-slice extraction |
| apps/web/src/routes/index.tsx | Public upload page | Fix accessible naming for switches and keep UI semantics stable |
| apps/web/src/routes/share.$token.tsx | Public share page | Reset token-scoped state and make SSR-visible dates deterministic |
| apps/web/src/routes/admin.tsx | Admin web monolith | Move bootstrap/query parsing to router boundaries and split by feature |
| apps/web/src/admin/request-tracker.ts | Admin request state utility | Evolve from stale-result suppression to signal-backed cancellation ownership |
| apps/web/src/admin/access.ts | Admin access parsing | Keep typed access behavior stable during admin route refactor |
| apps/web/src/admin/dashboard.ts | Extracted admin helpers | Preserve and expand helper extraction seams |
| .github/workflows/ci.yml | CI pipeline | Run new checks/tests and enforce version/runtime consistency |

#### Dependencies (may need updates)

| File | Relationship |
|------|--------------|
| packages/contracts/src/schemas/admin.ts | Admin API and web route contracts depend on it |
| packages/contracts/src/errors.ts | Shared error codes used by upload/share/report helpers |
| packages/contracts/src/schemas/share.ts | Share token validation and response contracts for API/web |
| packages/contracts/src/schemas/upload.ts | Upload contracts used by API and public web flow |
| packages/contracts/src/schemas/report.ts | Report contracts used by API and public web flow |
| packages/domain/src/file-status.ts | Share/public availability logic depends on it |
| packages/domain/src/rules.ts | Preview support and upload rules depend on it |
| packages/infrastructure/src/db/client.ts | API lazy DB helpers currently wrap it repeatedly |
| packages/infrastructure/src/db/schema/download-events.ts | Share telemetry writes and admin reads depend on it |
| packages/infrastructure/src/db/schema/admin-sessions.ts | Auth and admin session enforcement depend on it |
| packages/infrastructure/src/config/system-settings.ts | Report/share/upload dynamic settings depend on it |
| apps/web/src/router.ts | Admin route loader/search changes must remain compatible with router setup |
| apps/web/src/routeTree.gen.ts | Route refactors must preserve file-route registration boundaries |
| apps/web/src/components/site-frame.tsx | Public/admin routes depend on shared shell consistency |

#### Test Files

| Test | Coverage |
|------|----------|
| apps/api/src/app.test.ts | API health, headers, request ID and global error handler |
| apps/api/src/routes/share.test.ts | Share metadata/download/preview, rate limits, one-time semantics |
| apps/api/src/routes/upload.test.ts | Upload lifecycle, storage failures, degraded-open rate limiting |
| apps/api/src/routes/report.test.ts | Report route behavior, auto-hide, degraded-open rate limiting |
| apps/api/src/routes/auth.test.ts | OAuth login/callback/logout, allowlist, state uniqueness and single-use |
| apps/api/src/routes/admin.test.ts | Admin session, stats, files, moderation, reports, downloads |
| packages/infrastructure/src/config/index.test.ts | Env derivation and validation |
| packages/infrastructure/src/redis/index.test.ts | Redis probe behavior |
| packages/infrastructure/src/health/index.test.ts | Shared health aggregation |
| apps/worker/src/health-server.test.ts | Worker health semantics |
| apps/worker/src/bootstrap/register-reconcile-scheduler.test.ts | Reconcile scheduler registration |
| apps/web/src/admin/request-tracker.test.ts | Stale-request suppression behavior |
| apps/web/src/admin/dashboard.test.ts | Extracted admin helper logic |
| apps/web/src/share/reporting.test.ts | Public reporting eligibility rules |
| apps/web/src/share/page-head.test.ts | Share-page head/noindex behavior |
| apps/web/src/about/page.test.tsx | Reference pattern for route-adjacent web rendering tests |
| apps/web/src/server/web-health.test.ts | Web health route behavior |

#### Reference Patterns

| File | Pattern |
|------|---------|
| apps/api/src/routes/upload.ts | Route factory with injectable deps and lazy DB resolution |
| apps/api/src/routes/share.ts | Public route factory with injectable deps and domain-contract integration |
| apps/api/src/routes/report.ts | Route-local rate limiting and status gating |
| apps/web/src/about/page.tsx | Thin route delegating to extracted page module |
| apps/web/src/admin/access.ts | Extracted typed access parsing outside route file |
| apps/web/src/admin/dashboard.ts | Extracted pure admin helper module |
| apps/web/src/share/reporting.ts | Extracted pure share-flow helper module |
| apps/web/src/about/page.test.tsx | Route-adjacent test placement outside src/routes |

### Risk Assessment

- [x] Breaking changes to internal runtime contracts are possible if queue/auth boundaries change without preserving response shapes.
- [x] Database migrations may be needed only if OAuth pending state is stored in PostgreSQL instead of Redis; the preferred plan below uses Redis to avoid schema churn.
- [x] Configuration changes are required because deploy docs and readiness expectations must reflect the supported env/auth/queue model.

### Execution Plan

#### Phase 0: Freeze the Supported Operational Contract

- [ ] Step 0.1: Define the supported production/runtime contract before code moves.
  Scope:
  - Root environment model remains canonical across local, CI, and runtime invocation.
  - OAuth pending state becomes durable and restart-safe.
  - BullMQ ownership is explicit and differentiated between producer and worker connection policy.
  - API and worker remain dependency-aware in `/health`; web remains process-aware unless deliberately broadened.
  Verify:
  - The contract is representable consistently in docs, runtime scripts, and tests without contradiction.

- [ ] Step 0.2: Decide the storage medium for OAuth pending state.
  Decision:
  - Use Redis rather than PostgreSQL because the state is short-lived, single-use, TTL-bound, and already depends on the same availability domain as the admin control plane.
  Verify:
  - The chosen store supports TTL, single-use consume semantics, and predictable behavior during restart.

#### Phase 1: Types, Contracts, and Infrastructure Boundaries

- [ ] Step 1.1: Align BullMQ dependency versions in [apps/api/package.json](apps/api/package.json) and [apps/worker/package.json](apps/worker/package.json).
  Outcome:
  - API and worker resolve the same BullMQ major/minor line.
  Verify:
  - Dependency graph resolves without divergent BullMQ ranges.

- [ ] Step 1.2: Introduce a canonical BullMQ connection/factory boundary.
  Likely target surface:
  - Shared queue factory/adapter under infrastructure or another shared package boundary.
  Responsibilities:
  - Build producer queue connections with HTTP-appropriate retry expectations.
  - Build worker connections with worker-appropriate settings.
  - Keep queue names and retention sourced from [packages/contracts/src/schemas/jobs.ts](packages/contracts/src/schemas/jobs.ts).
  Verify:
  - API producers and worker consumers can both consume the same factory without cross-app imports.

- [ ] Step 1.3: Introduce a durable OAuth pending-state repository.
  Likely surface:
  - Shared auth-state repository under infrastructure, backed by Redis.
  Responsibilities:
  - create(state, redirectTarget, expiresAt)
  - read(state)
  - consume(state) atomically
  - prune behavior delegated to TTL, not process-local sweeps
  Verify:
  - The repository can support callback validation after process restart.

- [ ] Step 1.4: Create an API route-support layer for repeated concerns.
  Likely helper categories:
  - lazy DB access
  - share-token parsing
  - anonymous IP hashing
  - cookie parsing
  - standard API error body creation
  - non-throwing telemetry helper
  Verify:
  - Upload/share/report/auth/admin can consume the helpers without altering public route behavior.

#### Phase 2: API Observability, Auth Durability, and Reliability

- [ ] Step 2.1: Replace silent download event writes in [apps/api/src/routes/share.ts](apps/api/src/routes/share.ts).
  Required behavior:
  - Event persistence remains non-blocking to the user request path.
  - Failure never disappears silently.
  - Structured logs include `event`, `requestId`, `entity`, `outcome`, `eventType`, and error summary.
  Affected branches:
  - blocked download event write
  - started download event write
  - completed download event write for standard path
  - completed download event write for one-time path
  Verify:
  - Simulated DB insert failure emits logs and leaves the HTTP response semantics unchanged.

- [ ] Step 2.2: Standardize degraded-open rate-limit telemetry.
  Required behavior:
  - Upload/share/report continue to degrade open where that remains the product decision.
  - Each degraded-open incident emits a structured operational signal.
  - Admin metrics fallback paths emit traceable degradation logs rather than only empty data.
  Verify:
  - Forced Redis limiter failure produces structured logs and an identifiable degraded state path.

- [ ] Step 2.3: Externalize OAuth pending state in [apps/api/src/routes/auth.ts](apps/api/src/routes/auth.ts).
  Required behavior:
  - State issuance persists durably with TTL.
  - State consumption is single-use and atomic.
  - Callback validation does not depend on instance affinity.
  - Logout/session behavior remains unchanged unless explicitly improved.
  Verify:
  - A callback after simulated restart still succeeds for valid pending state.
  - Reuse of the same state fails deterministically.

- [ ] Step 2.4: Reuse the new route-support layer in upload/share/report/auth/admin.
  Goal:
  - Remove helper duplication without changing route contracts.
  Verify:
  - Existing route-factory tests still pass with only helper imports changed.

#### Phase 3: Public Web Correctness and Accessibility

- [ ] Step 3.1: Fix upload switch semantics in [apps/web/src/routes/index.tsx](apps/web/src/routes/index.tsx).
  Required behavior:
  - Each switch has an explicit accessible name tied to visible text.
  - Prefer visible text reference semantics over fallback naming.
  - Preserve current visual layout and interaction model unless a native control yields a cleaner implementation.
  Verify:
  - Accessibility tooling can compute a stable accessible name for both toggles.

- [ ] Step 3.2: Reset token-scoped share-page state in [apps/web/src/routes/share.$token.tsx](apps/web/src/routes/share.$token.tsx).
  Required behavior:
  - `consumed`, `runtimeUnavailable`, preview state, and report-panel state cannot bleed from token A into token B.
  - Reset happens only on token identity change, not on unrelated loader revalidation.
  Verify:
  - Navigating from one share token to another within the same route instance produces isolated state.

- [ ] Step 3.3: Remove locale-sensitive SSR-visible formatting from [apps/web/src/routes/share.$token.tsx](apps/web/src/routes/share.$token.tsx).
  Preferred behavior:
  - First render is deterministic across server and client.
  - If client-local formatting is desired later, it happens after hydration without changing the initial markup contract.
  Verify:
  - Hydration no longer depends on server/client locale or timezone coincidence.

#### Phase 4: Admin Web Refactor

- [ ] Step 4.1: Move admin login-error parsing and initial bootstrap out of mount-time imperative effects.
  Preferred target:
  - Route-level search validation and route-level loader/bootstrap.
  Required behavior:
  - Search/query state is explicit and typed.
  - The route does not depend on direct `window.history` mutation for canonical initialization.
  Verify:
  - Initial admin load works with typed search state and does not require mount-time cleanup logic to become correct.

- [ ] Step 4.2: Upgrade request tracking to real cancellation in [apps/web/src/admin/request-tracker.ts](apps/web/src/admin/request-tracker.ts).
  Required behavior:
  - Stale requests are aborted, not only ignored on completion.
  - Transport helpers consume `AbortSignal` consistently.
  Verify:
  - Rapid filter changes cancel obsolete network work and preserve last-request-wins semantics.

- [ ] Step 4.3: Slice [apps/web/src/routes/admin.tsx](apps/web/src/routes/admin.tsx) by feature.
  Recommended extraction boundaries:
  - admin route bootstrap/loader module
  - transport client module
  - files tab module
  - reports tab module
  - downloads tab module
  - storage/queues/anomalies modules
  - file inspection/detail module
  - top-level route component module
  Constraints:
  - Keep tests and helper modules outside `src/routes` when route scanning could misinterpret them.
  Verify:
  - Route registration remains stable and feature modules become individually testable.

- [ ] Step 4.4: Revisit logout-failure handling in the admin route.
  Required behavior:
  - UX continuity can remain optimistic, but the inconsistency should not be fully silent.
  Verify:
  - A failed logout request leaves an inspectable signal in UI or logs.

#### Phase 5: Admin API Refactor

- [ ] Step 5.1: Slice [apps/api/src/routes/admin.ts](apps/api/src/routes/admin.ts) by feature.
  Recommended extraction boundaries:
  - session/auth gate
  - queue-health and rate-limit metrics readers
  - overview/stats
  - file list/detail/moderation
  - reports list/resolve
  - downloads
  - anomalies and normalization helpers
  Constraints:
  - Keep [apps/api/src/app.ts](apps/api/src/app.ts) mounting surface stable.
  Verify:
  - Public admin API contract remains unchanged while implementation modules become smaller.

- [ ] Step 5.2: Reuse the canonical route-support layer across the admin API slices.
  Goal:
  - Remove duplicate cookie/session parsing and error shaping.
  Verify:
  - Admin tests remain green while helper duplication is reduced.

#### Phase 6: Documentation and Operational Readiness Alignment

- [ ] Step 6.1: Rewrite [docs/deploy.md](docs/deploy.md) to describe only the supported deployment contract.
  Must cover:
  - root/shared env contract
  - trusted reverse proxy expectation for `X-Forwarded-For`
  - HTTPS requirement for auth/base URLs
  - Redis role for rate limiting, BullMQ, and OAuth pending state
  - queue ownership and version alignment
  - process topology and health endpoint meanings
  Verify:
  - The deploy guide no longer contradicts runtime scripts or CI env usage.

- [ ] Step 6.2: Update [docs/architecture.md](docs/architecture.md), [docs/conventions.md](docs/conventions.md), [docs/readiness-checklist.md](docs/readiness-checklist.md), and [README.md](README.md).
  Goal:
  - Keep source-of-truth docs mutually consistent.
  Verify:
  - A new operator can derive the same runtime model from any of the canonical docs.

#### Phase 7: Tests and Verification Expansion

- [ ] Step 7.1: Extend API tests for observability/error branches.
  Required additions:
  - share route logs on failed event persistence
  - auth route durable pending-state TTL and restart-safe callback behavior
  - admin degraded metrics fallback branches
  Verify:
  - New tests fail before the remediation and pass after.

- [ ] Step 7.2: Add route-adjacent web tests for primary flows.
  Required additions:
  - upload switch accessibility naming
  - share token transition state reset
  - admin login error/search parsing
  - admin request cancellation behavior
  - admin logout failure signaling
  Constraints:
  - Place tests in safe non-route directories following the existing about/share/admin helper pattern.
  Verify:
  - The primary web flows gain route-level or route-adjacent behavior coverage.

- [ ] Step 7.3: Harden CI in [.github/workflows/ci.yml](.github/workflows/ci.yml) and root scripts.
  Suggested checks:
  - workspace verify
  - focused test execution for new suites
  - health smoke
  - dependency/version consistency check for BullMQ
  - docs/runtime contract sanity checks where practical
  Verify:
  - CI would catch the drift patterns identified in the original analysis.

### Verification Matrix

#### Runtime Verification
- [ ] `bun run verify` passes at workspace level.
- [ ] `bun run infra:check` passes against local Docker Compose dependencies.
- [ ] API `/health` still reflects dependency-aware state.
- [ ] Worker `/health` still reflects readiness plus dependency-aware state.
- [ ] Web `/health` remains intentionally process-only unless explicitly redesigned.

#### API Verification
- [ ] Share route returns unchanged public semantics while logging failed download-event inserts.
- [ ] Upload/share/report degrade-open behavior remains deliberate and observable.
- [ ] OAuth callback works after simulated API restart and rejects reused state.
- [ ] Admin endpoints preserve response shapes while being backed by smaller internal modules.

#### Web Verification
- [ ] Upload toggles expose stable accessible names.
- [ ] Share-page token transitions do not leak previous token state.
- [ ] SSR-visible expiration text is deterministic on initial render.
- [ ] Admin search/bootstrap state comes from router boundaries instead of only mount effects.
- [ ] Rapid admin filter changes cancel obsolete requests.

#### Documentation Verification
- [ ] Deploy docs, README, architecture docs, and conventions no longer contradict each other.
- [ ] OAuth durability and queue ownership rules are explicit, not hidden in source comments.

### Rollback Plan

If a phase introduces instability, revert in this order:

1. Revert admin web/admin API internal slicing while preserving any already-verified shared helpers and tests.
2. Revert the new queue/auth adapter implementations while keeping docs/tests that describe the intended target state in a separate branch if necessary.
3. Revert OAuth durable-state integration only if it causes functional auth regression, then temporarily document the single-instance constraint explicitly before retrying.
4. Revert route-support extraction only if it changes route behavior; avoid reverting localized public-flow fixes that are already independently verified.

### Risks

- Refactoring admin slices and helper extraction at the same time can blur regressions.
  Mitigation:
  - Extract shared helpers first, then move features one slice at a time while preserving route entrypoints.

- Switching OAuth state to Redis changes a critical login path.
  Mitigation:
  - Fail closed, cover TTL and reuse semantics in tests, and document availability dependency clearly.

- Queue ownership cleanup can accidentally change producer latency or worker retry behavior.
  Mitigation:
  - Preserve the producer/worker distinction in the factory contract rather than forcing one universal connection mode.

- Deterministic SSR formatting can reduce the immediate “local time” feel of the UI.
  Mitigation:
  - Keep first render deterministic; add optional client enhancement later if desired.

- Web route tests can interfere with TanStack route scanning if misplaced.
  Mitigation:
  - Follow the existing route-adjacent test placement pattern already used outside `src/routes`.

### Non-Goals For This Plan

- No implementation starts in this document.
- No redesign of the public visual language or admin information architecture beyond what is necessary to support correctness and maintainability.
- No change to one-time download product semantics.
- No broad migration of web `/health` to dependency-aware checks unless explicitly chosen later.

### Suggested PR Breakdown

1. PR 1: Queue/auth/runtime contract groundwork
   Includes:
   - BullMQ version alignment
   - canonical queue connection boundary
   - durable OAuth pending-state repository skeleton
   - docs stub updates only where needed to avoid active contradiction during the branch

2. PR 2: API observability and route-support extraction
   Includes:
   - non-silent download-event persistence helper
   - degraded-open telemetry helper
   - shared route-support extraction for upload/share/report/auth/admin
   - focused API tests

3. PR 3: Public web correctness fixes
   Includes:
   - upload switch accessible naming
   - share token-state reset
   - deterministic SSR date formatting
   - route-adjacent web tests for public flows

4. PR 4: Admin auth/bootstrap and cancellation
   Includes:
   - admin search/bootstrap migration to router boundaries
   - request cancellation upgrade
   - logout inconsistency signaling
   - admin web behavior tests

5. PR 5: Admin API/web slicing
   Includes:
   - feature-slice extraction of admin API and admin web route
   - contract-preserving test updates

6. PR 6: Docs/readiness/CI hardening
   Includes:
   - full deploy/docs alignment
   - readiness checklist update
   - CI enforcement for the new guarantees
