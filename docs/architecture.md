# Architecture Foundations

This document captures the technical boundaries and operating assumptions established in Module 1. It exists to keep later modules from silently drifting into tighter coupling or less predictable local execution.

Companion conventions live in `docs/conventions.md`.

## Process boundaries

- `apps/web`: TanStack Start application for public pages, SSR-capable routes, admin shell, and SSR request middleware.
- `apps/api`: Hono application for domain-facing HTTP endpoints, health endpoints, and internal operational HTTP entrypoints.
- `apps/worker`: BullMQ process for delayed jobs, reconciliation, cleanup, other asynchronous lifecycle work, and a dedicated health endpoint for orchestration.
- `packages/domain`: pure business rules, enums, and state transitions.
- `packages/contracts`: shared payload shapes and cross-process contracts.
- `packages/infrastructure`: configuration, logging, database, Redis, storage clients, rate limiting, queue connection factory, and OAuth state repository.

Apps must not import from other apps. Shared code goes through `packages/*` and is consumed through workspace aliases.
The storage boundary is Bun-first as well: S3-compatible access goes through Bun's native S3 API, not the AWS SDK.

## Redis roles

Redis backs four distinct concerns:

- **BullMQ queue state**: job persistence, delayed scheduling, and retry tracking for the `expire-file`, `cleanup-file`, and `reconcile` queues.
- **Rate limiting**: sliding-window counters for upload, report, and download endpoints.
- **Rate-limit blocked metrics**: daily counters used by the admin abuse dashboard.
- **OAuth pending state**: TTL-scoped, single-use tokens for the GitHub OAuth login flow (`GETDEL` for atomic consumption). Restart-safe because state lives in Redis, not in process memory.

Both the API (producer) and worker (consumer) connect to the same Redis instance. The queue connection factory in `@anonshare/infrastructure/queue` keeps producer and worker connection policies explicit, while the shared Redis client remains reserved for non-BullMQ concerns such as rate limiting, metrics, and OAuth state.

## Route module conventions

Large route files are split into feature-focused modules when they exceed ~500 lines. Each split uses a co-located directory whose name matches the original file so that existing import paths continue to resolve without changes. The directory must export a single `index.ts` with the same public surface as the original file.

Applied splits in `apps/api/src/routes/`:

- `admin/types.ts` — shared types, constants, and dependency injection contract
- `admin/helpers.ts` — pure utility functions (formatting, status resolution, anomaly normalisation)
- `admin/session.ts` — session validation and auth gate
- `admin/queue-health.ts` — queue health snapshot with timeout and degraded-open fallback
- `admin/queries.ts` — default database queries and queue accessors
- `admin/index.ts` — router factory and route handlers (re-exports `createAdminRouter`)
- `upload/types.ts`, `upload/helpers.ts`, `upload/index.ts` — presigned-upload flow extracted from `upload.ts`
- `share/types.ts`, `share/helpers.ts`, `share/index.ts` — share page, download, and preview routes extracted from `share.ts`

Applied split in `apps/worker/src/handlers/`:

- `reconcile/types.ts` — shared row and dependency types
- `reconcile/constants.ts` — shared thresholds
- `reconcile/helpers.ts` — shared pure helpers
- `reconcile/index.ts` — handler entry point; individual passes are in `reconcile/pass-*.ts`

Test files for split modules live alongside the production code in the same directory. Shared test builders are placed in a `test-helpers.ts` file (no `.test.` in the name so Bun does not run it as a test suite). Per-route or per-pass test files import from `./test-helpers` and `./index`.

The same pattern applies to the admin web module (`apps/web/src/admin/`) which extracts transport, formatters, and request tracking into separate files.
Admin web routes should prefer TanStack Router `validateSearch` and route loaders for initial bootstrap and search-param interpretation, leaving Effects for user-initiated refresh or other true client-side synchronization.

## Admin dashboard URL state

All admin tab navigation and tab-level filter/pagination state lives in URL search parameters, owned by `validateSearch` in `apps/web/src/routes/admin.tsx`. This keeps browser back/forward navigation meaningful and makes filter state shareable via URL.

- `AdminSearchParams` (`apps/web/src/admin/search-params.ts`) defines and validates all recognized search keys. Unrecognized keys are silently stripped.
- `AdminSearchUpdate` is a wider mapped type (`{ [K]: V | undefined }`) required by `exactOptionalPropertyTypes`; explicit `undefined` values signal "remove this key from the URL" and are stripped in `handleUpdateSearch` before merge.
- `loaderDeps` only includes navigation keys (`error`) that should actually trigger a data reload. Filter/pagination keys are excluded because filters are applied client-side against the dashboard snapshot without re-fetching.
- Tab components receive `searchState` and `onUpdateSearch` as optional props forwarded from the route. They derive filter/page values from `searchState` (with sensible defaults) and call `onUpdateSearch` on user interaction instead of managing local state.

## Rate Limiting and Degraded Mode

Rate limiting is centralised in `@anonshare/infrastructure/rate-limit` through the `applyRateLimit()` function. It is the single entry point for upload, download, and report limits.

- **Primary path**: fixed-window counter in Redis (atomic `INCR` / `EXPIRE`). The result includes `origin: 'redis'`.
- **Degraded path**: when Redis throws any error, `applyRateLimit` falls back automatically to a process-local fixed-window store backed by a `Map`. The result includes `origin: 'memory-fallback'` and a `rate_limit.degraded` warning is logged.

**Important multi-instance caveat**: the in-memory fallback is not shared across process instances. If the API runs in more than one replica, each replica maintains its own degraded counter. A client that spreads requests across replicas may see a higher effective limit than the configured value during a Redis outage. The fallback is intentionally conservative (same thresholds) and is strictly an emergency degraded mode, not a replacement for Redis.

Route handlers must not try/catch rate-limit calls directly. Use `applyRateLimit()` unconditionally and act on the returned `limited` flag.

## Admin Authentication and Cookie Signing

Admin authentication uses GitHub OAuth with a strict single-identity allowlist (`GITHUB_ALLOWED_USER_ID` must be a numeric GitHub user ID). After successful OAuth, the server creates a DB-backed session record and issues a signed cookie.

- Cookies are signed with `SESSION_SECRET` via Hono's `setSignedCookie` / `getSignedCookie` helpers. A tampered or unsigned cookie is rejected before the session DB lookup.
- Session records live in the `admin_sessions` table and are invalidated on explicit logout or DB-level expiry.
- Rotating `SESSION_SECRET` immediately invalidates all active admin sessions because every cookie verification will fail.
- The canonical cookie name is `ADMIN_SESSION_COOKIE_NAME` in `apps/api/src/routes/admin/types.ts`. Auth and admin routes must import that constant rather than duplicating the string.

## Configuration policy

- A single root `.env` file is the source of truth for all process runtime configuration.
- The same root `.env` also provides infrastructure defaults for Docker Compose.
- CI and deployed processes must use this same variable contract even when values are injected per process by the host platform.
- API and worker fail fast on invalid required environment variables.
- Web validates runtime server environment for development, but the production build remains resilient so CI can compile static assets without private runtime secrets.
- Root Drizzle tooling derives local connection settings from the root `.env` so operational commands stay aligned with Docker Compose without requiring a separate migration-only env file.

## Local platform assumptions

- PostgreSQL, Redis, and MinIO run through Docker Compose.
- Compose images are pinned to explicit MinIO release tags to preserve reproducibility.
- MinIO is treated strictly as an S3-compatible local target, not as a MinIO-specific application dependency.
- The `minio-init` container is responsible for idempotent default bucket creation.

## Logging baseline

- Structured logs are emitted through `@anonshare/infrastructure/logger`.
- Required baseline fields for operational events: `event`, `timestamp`, `outcome`, with `requestId`, `actor`, and `entity` whenever applicable.
- The API assigns or propagates `x-request-id` for every HTTP request and emits a completion log line with method, path, status, and duration.
- The web process applies the same request-completion logging baseline through TanStack Start request middleware.
- Hono's default text logger is intentionally not used so request logging stays fully structured.

## Local dependency readiness

- `bun run infra:check` derives local connection URLs from the root `.env` and validates PostgreSQL, Redis, and the configured storage bucket through the shared infrastructure package.
- The API `GET /health` endpoint uses the same shared probes at runtime and returns `503` when any dependency is degraded.
- The web `GET /health` endpoint confirms the SSR process is serving requests, and the worker `GET /health` endpoint reports readiness plus shared dependency state.
- Docker healthchecks answer container readiness; `infra:check` verifies that the application-facing contracts are reachable with the configured credentials and ports.

## Validation workflow

- `bun run verify:repo`: repository integrity gate for `bun.lock` presence, frozen Bun installs in CI, and the committed release promotion workflow contract.
- `bun run typecheck`: workspace TypeScript validation.
- `bun run lint`: Biome linting plus import-boundary enforcement.
- `bun run test`: foundational tests.
- `bun run build`: bundles the web, API, and worker entrypoints.
- `bun run verify:bullmq`: enforces the shared BullMQ dependency line across every workspace package that imports BullMQ.
- `bun run db:generate` / `bun run db:migrate`: root Drizzle tooling for schema evolution; see `docs/conventions.md` for the full migration workflow.
- `bun run verify`: aggregate quality gate used before commits, covering dependency readiness, typecheck, lint, tests, build, and migration validation.

The repository integrity contract is part of the architecture boundary: `bun.lock` must be committed, CI must keep using a frozen Bun install, and the release promotion workflow must keep promoting CI-approved `main` commits onto `release` so local, CI, and deployment all resolve the same operational graph.

## Local troubleshooting order

- Start with `docker compose ps` to confirm container-level health.
- Run `bun run infra:check` to verify the shared database, Redis, and storage contracts from application code.
- If the processes are already running, call `GET /health` on web, API, and worker to verify runtime readiness from each boundary.
- Recreate the local stack with `bun run infra:reset` when root `.env` credentials or ports change against persisted Docker volumes.