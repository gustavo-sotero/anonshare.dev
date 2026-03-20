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

Large route files are split into feature-focused modules when they exceed ~500 lines. The admin API uses a directory structure:

- `admin/types.ts` — shared types, constants, and dependency injection contract
- `admin/helpers.ts` — pure utility functions (formatting, status resolution, anomaly normalisation)
- `admin/session.ts` — session validation and auth gate
- `admin/queue-health.ts` — queue health snapshot with timeout and degraded-open fallback
- `admin/queries.ts` — default database queries and queue accessors
- `admin/index.ts` — router factory and route handlers

The same pattern applies to the admin web module (`apps/web/src/admin/`) which extracts transport, formatters, and request tracking into separate files.
Admin web routes should prefer TanStack Router `validateSearch` and route loaders for initial bootstrap and search-param interpretation, leaving Effects for user-initiated refresh or other true client-side synchronization.

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

- `bun run typecheck`: workspace TypeScript validation.
- `bun run lint`: Biome linting plus import-boundary enforcement.
- `bun run test`: foundational tests.
- `bun run build`: bundles the web, API, and worker entrypoints.
- `bun run verify:bullmq`: enforces the shared BullMQ dependency line between API producers and worker consumers.
- `bun run db:generate` / `bun run db:migrate`: root Drizzle tooling for schema evolution; see `docs/conventions.md` for the full migration workflow.
- `bun run verify`: aggregate quality gate used before commits, covering dependency readiness, typecheck, lint, tests, build, and migration validation.

## Local troubleshooting order

- Start with `docker compose ps` to confirm container-level health.
- Run `bun run infra:check` to verify the shared database, Redis, and storage contracts from application code.
- If the processes are already running, call `GET /health` on web, API, and worker to verify runtime readiness from each boundary.
- Recreate the local stack with `bun run infra:reset` when root `.env` credentials or ports change against persisted Docker volumes.