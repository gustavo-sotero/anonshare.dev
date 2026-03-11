# Engineering Conventions

This document consolidates the working conventions established in Module 1 so later modules can add behavior without re-litigating the project baseline.

## Naming

- Workspace packages use the `@anonshare/*` scope.
- App and package folders use `kebab-case`.
- TanStack file routes follow TanStack naming conventions such as `share.$token.tsx`.
- Environment variables are uppercase with `_` separators.
- Structured log `event` values use `snake_case`.
- Queue names use `kebab-case` so they remain easy to read in BullMQ tooling.

## Import Boundaries

- `apps/*` must never import from other apps.
- Shared code belongs in `packages/*` and is consumed through workspace aliases.
- Do not import package source files by deep relative path such as `../../packages/...`.
- Use `~/*` only for local app-internal imports.

## Environment Policy

- Each executable process owns its own `.env` file.
- The root `.env` is reserved for local Docker Compose infrastructure defaults.
- API and worker boot fail fast on missing required runtime variables.
- Web runtime entrypoints validate env, while the production build stays resilient enough to compile without private runtime secrets.
- Root operational scripts derive local connection URLs from the root `.env` instead of maintaining a separate migration-only config.

## Logging Baseline

- Emit logs through `@anonshare/infrastructure/logger`.
- Include `event` on every operational log.
- Include `actor`, `entity`, `outcome`, and `requestId` whenever they are known.
- HTTP request logs must record method, path, status, and duration.
- Prefer machine-parseable context over free-form text fields.

## Operational Commands

- `bun run infra:up` starts PostgreSQL, Redis, and MinIO.
- `bun run infra:check` validates application-facing connectivity, not just container health.
- `bun run verify` is the root quality gate before merging or handing off work.
- `bun run db:generate` and `bun run db:migrate` are the only supported entrypoints for Drizzle tooling.

## Module Boundaries

- Module 1 establishes topology, bootstrap, shared infrastructure, and governance only.
- Placeholder routes and handlers are acceptable when the corresponding product behavior is explicitly deferred to a later module.
- New module work should extend the existing shells and boundaries instead of bypassing them.