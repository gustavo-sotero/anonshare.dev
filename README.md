# anonshare.dev

Anonymous file sharing. Upload, share, done.

> Portfolio project. Non-commercial R&D. The running app includes upload, share, download, preview, one-time download, expiration lifecycle, reporting, admin dashboard with GitHub OAuth, and a dedicated about page. Architecture notes remain in `docs/architecture.md`.

Foundation decisions and process boundaries are documented in `docs/architecture.md`.

---

## Stack

| Layer | Technology |
|---|---|
| Runtime | Bun |
| Web / SSR | TanStack Start (React) |
| API | Hono |
| Async jobs | BullMQ |
| Database | PostgreSQL + Drizzle ORM (Bun SQL) |
| Cache / queues | Redis (ioredis) |
| Storage | S3-compatible via Bun native S3 API (MinIO local, AWS S3 / R2 in production) |
| Auth | GitHub OAuth (single allowlisted admin) |

---

## Monorepo layout

```
apps/
  web/        # TanStack Start – public pages + admin shell
  api/        # Hono – domain API endpoints
  worker/     # BullMQ – lifecycle jobs and reconciliation
packages/
  domain/     # Pure business rules, enums, state machine
  contracts/  # Shared TypeScript types for API payloads and job data
  infrastructure/  # DB client, Redis client, storage adapter, config, logger
```

---

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.1
- [Docker](https://docs.docker.com/get-docker/) + Docker Compose v2

---

## Local development

### 1. Start infrastructure

Copy the infrastructure defaults first:

```sh
cp .env.example .env
```

PowerShell:

```powershell
Copy-Item .env.example .env
```

```sh
docker compose up -d
```

PostgreSQL → `localhost:5432`  
Redis → `localhost:6379`  
MinIO S3 API → `localhost:9000` (console → `localhost:9001`)

Wait for all services to report healthy:

```sh
docker compose ps
```

Validate real connectivity against PostgreSQL, Redis and the configured MinIO bucket from the same contracts the apps use:

```sh
bun run infra:check
```

After the API is running, `GET /health` on `http://localhost:3001/health` performs the same dependency probes and returns `200` only when PostgreSQL, Redis, and storage are reachable.

If PostgreSQL authentication fails after changing root `.env` credentials, the existing Docker volume is still using the previous database bootstrap. Run `bun run infra:reset` to recreate the local services with the current credentials.

### 2. Configure environment

Use a single root environment file for all apps:

```sh
cp .env.example .env
```

PowerShell:

```powershell
Copy-Item .env.example .env
```

Fill in `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_ALLOWED_USER_ID` and `SESSION_SECRET` in the root `.env`.

All local processes (`web`, `api`, `worker`) load variables from this same root `.env`.
In CI and production, inject the same variable names through the platform environment or secret manager instead of maintaining separate per-process env contracts.

If `docker compose up -d` fails with a Docker named pipe error on Windows, start Docker Desktop first and rerun the command.

### 3. Database tooling

```sh
bun run db:migrate
```

In Module 1 this command is intentionally a no-op because the application schema only starts in Module 2. The root database tooling now derives its local connection settings from the same root `.env` used by Docker Compose, so the command becomes active as soon as schema and migration files are added.

### 4. Start all services

Run all app dev servers with one command:

```sh
bun run dev
```

Or open three terminals:

```sh
bun run dev:api
bun run dev:worker
bun run dev:web
```

Or run them individually:

```sh
bun run --cwd apps/api dev
bun run --cwd apps/worker dev
bun run --cwd apps/web dev
```

---

## Useful commands

| Command | What it does |
|---|---|
| `bun run dev` | Run all app dev servers in parallel from the workspace root |
| `bun run verify` | Dependency check + typecheck + lint + tests + build + migration validation |
| `bun run build` | Bundle the web, API, and worker entrypoints |
| `bun run test` | Run foundational tests |
| `bun run check` | Biome format + lint with auto-fix |
| `bun run db:generate` | Generate Drizzle migration files from schema changes; in Module 1 it exits cleanly until schema files exist |
| `bun run db:migrate` | Apply pending migrations; in Module 1 it exits cleanly until migration files exist |
| `bun run infra:up` | Start Docker services |
| `bun run infra:down` | Stop Docker services (keep volumes) |
| `bun run infra:check` | Verify local PostgreSQL, Redis, and MinIO connectivity |
| `bun run infra:reset` | Stop + destroy volumes + restart (full local reset) |
| `bun run verify:bullmq` | Ensure the API and worker resolve the same BullMQ version |

---

## Reset local state

To wipe all local data (database, Redis, storage objects) and start fresh:

```sh
bun run infra:reset
```

This destroys named Docker volumes. All uploaded files and schema data are lost. Re-run migrations afterward.

## Troubleshooting

- `bun run infra:check` fails for PostgreSQL after changing `.env`: run `bun run infra:reset` so the persisted database volume is recreated with the current credentials.
- `bun run infra:check` fails for Redis or MinIO: verify `docker compose ps` shows healthy services, confirm the configured ports are not already in use on the host, and confirm the configured bucket exists or rerun `bun run infra:reset`.
- `http://localhost:3001/health` returns `503`: at least one dependency is unavailable to the API process. Use the JSON response to see which dependency is degraded before restarting the relevant service.
- `bun run dev:web` exits immediately: confirm the root `.env` exists and contains valid `APP_BASE_URL` and `APP_API_URL` values.

---

## Conventions

- **Imports**: use package aliases (`@anonshare/domain`, `@anonshare/contracts`, etc.) — not deep relative paths.
- **Packages vs Apps**: `packages/` are libraries with no runtime entry point. `apps/` are executable processes.
- **Environment**: all processes read from the single root `.env`. Variables are validated at boot — missing required vars crash immediately with a clear message.
- **Production env injection**: deploy processes may receive variables independently, but they must use the same canonical variable names documented in `docs/deploy.md`; do not invent per-process env models.
- **Readiness**: `bun run infra:check` validates local dependencies before app startup, and the API `GET /health` route reuses the same shared health probes at runtime.
- **Infrastructure config**: the root `.env` controls local PostgreSQL, Redis and MinIO credentials/ports used by Docker Compose.
- **Database tooling**: root Drizzle commands derive local connection settings from the root `.env` so operational scripts and Docker Compose stay aligned.
- **Logging**: use `logger` from `@anonshare/infrastructure/logger`. Always include an `event` field (snake_case), plus `actor`, `entity`, and `outcome` when they are known.
- **Dependencies**: never manually edit version strings in `package.json`. Use `bun add` / `bun remove`.
- **Storage integration**: use Bun's native S3 API through `@anonshare/infrastructure/storage`; do not reintroduce the AWS SDK client layer.

## Foundation docs

- `docs/architecture.md`: process boundaries, environment strategy, logging baseline and local platform assumptions.
- `docs/conventions.md`: naming, import-boundary, environment, and logging conventions for ongoing module work.

---

## Module roadmap

1. ✅ **Module 1** — Monorepo foundation
2. ✅ **Module 2** — Domain model, contracts, database schema
3. ✅ **Module 3** — Upload pipeline + storage integration
4. ✅ **Module 4** — Public share, download, preview flows
5. ✅ **Module 5** — Expiration, cleanup, reconciliation
6. ✅ **Module 6** — Abuse prevention, reports, auto-moderation
7. ✅ **Module 7** — GitHub auth, admin dashboard
8. ✅ **Module 8** — About page + portfolio narrative
9. ✅ **Module 9** — Observability, tests, CI, production hardening
