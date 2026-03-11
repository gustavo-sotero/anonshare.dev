# Architecture Foundations

This document captures the technical boundaries and operating assumptions established in Module 1. It exists to keep later modules from silently drifting into tighter coupling or less predictable local execution.

Companion conventions live in `docs/conventions.md`.

## Process boundaries

- `apps/web`: TanStack Start application for public pages, SSR-capable routes, and the future admin shell.
- `apps/api`: Hono application for domain-facing HTTP endpoints, health endpoints, and internal operational HTTP entrypoints.
- `apps/worker`: BullMQ process for delayed jobs, reconciliation, cleanup, and other asynchronous lifecycle work.
- `packages/domain`: pure business rules, enums, and state transitions.
- `packages/contracts`: shared payload shapes and cross-process contracts.
- `packages/infrastructure`: configuration, logging, database, Redis, and storage clients.

Apps must not import from other apps. Shared code goes through `packages/*` and is consumed through workspace aliases.
The storage boundary is Bun-first as well: S3-compatible access goes through Bun's native S3 API, not the AWS SDK.

## Configuration policy

- Every process owns its own `.env` file.
- Infrastructure defaults for Docker Compose live in the root `.env`.
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
- Hono's default text logger is intentionally not used so request logging stays fully structured.

## Local dependency readiness

- `bun run infra:check` derives local connection URLs from the root `.env` and validates PostgreSQL, Redis, and the configured storage bucket through the shared infrastructure package.
- The API `GET /health` endpoint uses the same shared probes at runtime and returns `503` when any dependency is degraded.
- Docker healthchecks answer container readiness; `infra:check` verifies that the application-facing contracts are reachable with the configured credentials and ports.

## Validation workflow

- `bun run typecheck`: workspace TypeScript validation.
- `bun run lint`: Biome linting plus import-boundary enforcement.
- `bun run test`: foundational tests.
- `bun run build`: bundles the web, API, and worker entrypoints.
- `bun run db:generate` / `bun run db:migrate`: root Drizzle tooling; during Module 1 they exit cleanly until schema and migration files exist.
- `bun run verify`: aggregate quality gate used before commits and later in CI.

## Local troubleshooting order

- Start with `docker compose ps` to confirm container-level health.
- Run `bun run infra:check` to verify the shared database, Redis, and storage contracts from application code.
- If the API is already running, call `GET /health` to verify runtime readiness from the HTTP boundary.
- Recreate the local stack with `bun run infra:reset` when root `.env` credentials or ports change against persisted Docker volumes.