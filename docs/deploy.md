# Deployment Guide

This document describes how to deploy anonshare.dev and the minimum hardening steps required before go-live.

## Architecture Overview

Three processes must be running in production:

| Process | Entry | Port | Description |
|---|---|---|---|
| `apps/web` | `bun run start` | 3000 | TanStack Start SSR application |
| `apps/api` | `bun run start` | 3001 | Hono REST API |
| `apps/worker` | `bun run start` | 3002 | BullMQ background jobs plus readiness endpoint |

The processes are deliberately independent and can be scaled or restarted individually. The environment-variable contract is shared across local development, CI, and deployment: local development reads it from the root `.env`, while CI and production inject the same variable names through the host platform or secret manager.

## Dokploy Deployment

For Dokploy, use the dedicated compose file at `docker-compose.dokploy.yml`.
Dokploy should track the `release` branch, not `main`.

- It builds three Bun slim images from the repository root: `web`, `api`, and `worker`.
- PostgreSQL and Redis are intentionally not part of this compose file. Create them as separate Dokploy-managed services and point the app stack to them through `DATABASE_URL` and `REDIS_URL`.
- Object storage is also external. Inject the canonical `STORAGE_*` variables through Dokploy.
- The compose file uses `env_file: .env` because Dokploy writes UI-defined variables to a sibling `.env` file instead of injecting them automatically into containers.
- The compose file uses `expose`, not `ports`, for the application services because Dokploy routes external traffic through Traefik and expects the public port to be selected in the Dokploy UI.
- Healthchecks are container-local and Bun-based, so they do not depend on `curl` being present in the slim image.
- Browser-side requests from `apps/web` always target `/api` on the same public origin. In Dokploy, the public app host must therefore route `/` to the `web` service and `/api` to the `api` service. A separate API-only domain is optional, but it does not replace the required same-origin `/api` route.
- The `web` service defaults `APP_API_URL` to `http://api:3001` inside the Compose network so SSR can talk to the `api` container directly. Override it only if you intentionally need a different internal route.
- The compose stack now includes a one-shot `migrate` service. `api` and `worker` wait for it to complete successfully, and `web` waits for a healthy `api`, so first boot does not race database schema creation.
- `.github/workflows/release-tag.yml` promotes only the latest CI-approved `main` SHA: it derives a deterministic annotated `release-*` tag from the commit timestamp plus short SHA, skips stale runs, and advances `release` only when the current `release` tip is still in `main`'s lineage.
- Promotion runs are serialized through a workflow concurrency lock, so lineage checks and branch updates happen one at a time.

Recommended Dokploy flow:

1. Create the app as a Docker Compose deployment, point it at `docker-compose.dokploy.yml`, and configure the Git branch as `release`.
2. Add all production variables in Dokploy's Environment tab.
3. Create the PostgreSQL and Redis services separately in Dokploy and copy their connection URLs into `DATABASE_URL` and `REDIS_URL`.
4. In Dokploy Domains, configure the public app host twice: `/` to the `web` service port `3000`, and `/api` to the `api` service port `3001`. If you expose the API on an additional dedicated host, treat that as optional extra routing rather than the primary browser path.
5. Deploy the stack. The `migrate` service applies pending migrations automatically before `api` and `worker` start serving traffic.
6. For rollback, push an older `release-*` tag back onto `release` and trigger a redeploy.

Example rollback command:

```bash
git push origin release-YYYYMMDDHHMMSS-<12-char-sha>:refs/heads/release
```

Recommended Dokploy environment values for this topology:

```dotenv
APP_BASE_URL=https://anonshare.dev
APP_API_URL=http://api:3001
```

`APP_BASE_URL` is the public browser origin. `APP_API_URL` is the internal SSR-to-API URL used by the `web` container inside the Compose network.

The compose file also defines an `ops` profile-backed service built from the `tooling` target in `Dockerfile`.
Use it for one-off operational commands that are not part of normal startup:

```bash
docker compose -f docker-compose.dokploy.yml --profile ops run --rm ops packages/infrastructure/src/scripts/seed.ts
docker compose -f docker-compose.dokploy.yml --profile ops run --rm ops packages/infrastructure/src/scripts/run-drizzle.ts migrate
```

The first command runs the idempotent seed script. The second manually reruns migrations when you need an explicit operational replay.

## Infrastructure Dependencies

All three processes depend on:

| Dependency | Purpose | Minimum version |
|---|---|---|
| PostgreSQL | Metadata, reports, sessions, anomalies | 16 |
| Redis | BullMQ queue state, rate limiting, rate-limit blocked metrics, OAuth pending state | 7 |
| S3-compatible object storage | File objects | Any S3-API compatible provider |

Supported S3-compatible providers: AWS S3, Cloudflare R2, MinIO (self-hosted). The storage adapter uses Bun's native S3 API and does not require the AWS SDK.

### Trusted Reverse Proxy

The API reads `X-Forwarded-For` for IP-based rate limiting and download event logging. In production, place all processes behind a reverse proxy (e.g. nginx, Caddy, Cloudflare) that sets this header reliably. The API HMAC-hashes the first IP from the header using `SESSION_SECRET` with a privacy-specific purpose prefix — it never stores raw addresses.

### HTTPS

All public browser-facing `APP_BASE_URL` values must use `https://` in any environment beyond local development. Public `APP_API_URL` values should also use `https://`.

Exception: in container-to-container deployments such as Dokploy Compose, `APP_API_URL` may be an internal HTTP service URL like `http://api:3001` when it is used only by SSR inside the private Docker network. In that topology, browser traffic must still arrive over HTTPS through the public `APP_BASE_URL` host and its `/api` route.

GitHub OAuth callbacks, admin session cookies, and presigned storage URLs depend on HTTPS for transport security.

### Queue Version Alignment

`apps/api` (job producer), `apps/worker` (job consumer), and `packages/infrastructure` (shared queue factory) all import BullMQ. They must stay on the same dependency line to avoid serialisation or protocol mismatches between shared queue code and the app processes that instantiate it.
Run `bun run verify:bullmq` from the workspace root before deployment or after dependency changes to enforce that parity automatically.

### Dependency Reproducibility

- `bun.lock` is a committed repository artifact, not a local-only cache file.
- CI installs dependencies with `bun install --frozen-lockfile`.
- `bun run verify:repo` mirrors that contract locally by failing when `bun.lock` is missing, when the CI workflow stops using a frozen Bun install, or when the release promotion workflow stops matching its required contract.

Treat lockfile drift as a release blocker: deployment, CI, and local verification must all describe the same dependency graph.

### Redis Ownership and Queue Connections

- Redis itself is a shared infrastructure dependency for BullMQ queue state, rate limiting, rate-limit blocked metrics, and OAuth pending state.
- BullMQ does not reuse the shared application Redis client. Producers and workers create their own queue connections through `@anonshare/infrastructure/queue` so connection policy stays explicit per role.
- The shared Redis client in `@anonshare/infrastructure/redis` is reserved for non-BullMQ concerns such as rate limiting, admin metrics, and OAuth state storage.

## Environment Variables

A single root `.env` file at the workspace root is the source of truth for local development and Docker Compose defaults. CI and production must inject the same variable names even when each process receives its own environment independently.

Canonical variable contract by process:

```
# Shared across web/api/worker
NODE_ENV=production
APP_BASE_URL=https://anonshare.dev
APP_API_URL=https://api.anonshare.dev
REDIS_URL=redis://host:6379

# API + worker
DATABASE_URL=postgres://user:pass@host:5432/anonsharedb
STORAGE_ENDPOINT=https://s3.amazonaws.com
STORAGE_ACCESS_KEY_ID=...
STORAGE_SECRET_ACCESS_KEY=...
STORAGE_BUCKET=anonshare-prod
STORAGE_REGION=us-east-1

# API only
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
GITHUB_ALLOWED_USER_ID=<your_numeric_github_id>
SESSION_SECRET=<random 64+ character string>
PORT=3001

# Worker only
WORKER_HEALTH_PORT=3002
```

Do not maintain a separate, divergent env model for each process. The variable names above are the supported contract that must remain consistent with the runtime validators, CI, and operator documentation.

### Critical Security Values

- `SESSION_SECRET`: Generate with `openssl rand -hex 64`. Must be at least 32 characters. Rotate invalidates all admin sessions.
- `SESSION_SECRET` also keys anonymous IP pseudonyms used by rate limiting and download/report telemetry. Do not reuse it outside this application boundary.
- `GITHUB_ALLOWED_USER_ID`: Must be the numeric GitHub user ID (not the login name). Find yours at `https://api.github.com/users/<yourlogin>` under `id`. This is the sole admin access control.
- `STORAGE_SECRET_ACCESS_KEY`: Store in environment only, never commit to version control.

### Admin Session Cookies

- Admin authentication remains DB-backed; the cookie stores only the opaque session ID.
- The cookie is signed with Hono's signed-cookie helpers and `SESSION_SECRET`.
- Any tampering causes the cookie to be rejected before the session lookup runs.
- Rotating `SESSION_SECRET` invalidates every active admin session because existing cookie signatures stop verifying.

## Pre-Deployment Checklist

### Infrastructure

- [ ] PostgreSQL running and accessible with the configured `DATABASE_URL`
- [ ] Redis running and accessible with the configured `REDIS_URL`
- [ ] S3-compatible bucket created and accessible with the configured storage credentials
- [ ] The platform injects the canonical environment variables listed above into each process
- [ ] `GITHUB_ALLOWED_USER_ID` verified against `https://api.github.com/users/<yourlogin>`
- [ ] `bun.lock` is committed and matches the dependency graph being deployed
- [ ] `bun run verify:repo` passes from the workspace root
- [ ] `bun run verify:bullmq` passes from the workspace root so every BullMQ-consuming workspace package stays aligned

### Database

```bash
# Apply all pending migrations (idempotent)
cd packages/infrastructure
bun run db:migrate

# Seed initial system settings (idempotent, safe to re-run)
bun run db:seed
```

### Build

```bash
# Verify repository integrity before shipping
bun run verify:repo

# Verify the local quality gate and BullMQ parity before shipping
bun run verify

# Build all processes from the workspace root
bun run build
```

Artifacts land in:
- `apps/api/dist/index.js`
- `apps/worker/dist/index.js`
- `apps/web/dist/` (client assets + server entry)

## Health Verification

After starting all three processes, verify end-to-end readiness:

```bash
# API health (includes Postgres, Redis, Storage probes)
curl -f https://api.anonshare.dev/health

# Web process health
curl -f https://anonshare.dev/health

# Worker process health
curl -f https://worker.anonshare.dev/health

# API readiness via infra:check (from local dev or CI)
bun run infra:check
```

The API and worker `/health` endpoints return 200 when all dependencies are reachable and the process is ready, 503 when degraded. The web `/health` endpoint confirms the SSR process is serving requests.

- API `/health`: dependency-aware and should fail closed when PostgreSQL, Redis, or storage are degraded.
- Worker `/health`: dependency-aware and should fail closed until queues are ready and dependencies are reachable.
- Web `/health`: intentionally process-only; it verifies the SSR process is responding and does not probe PostgreSQL, Redis, or storage.

## Startup Order

1. Start PostgreSQL and Redis (external managed services or containers).
2. Apply migrations (`bun run db:migrate`) or let the Dokploy `migrate` service do it automatically.
3. Start `apps/api` — validates env on boot, fails fast if any required var is missing.
4. Start `apps/worker` — validates env on boot, opens `WORKER_HEALTH_PORT`, connects to queues, and registers the hourly reconcile scheduler.
5. Start `apps/web` after the API is healthy so SSR and upload flows do not boot against an unavailable backend.

For local and CI verification, run `bun run verify` from the workspace root. It includes dependency readiness, BullMQ version parity, typecheck, lint, tests, build, and migration validation.

## Timeouts and Retry Configuration

All default retry and timeout values are set in `@anonshare/contracts` and `packages/infrastructure/src/storage/index.ts`. Notable limits:

| Operation | Timeout | Retries |
|---|---|---|
| Storage write | 10 minutes | 3 (back off) |
| Storage read | 5 minutes | 3 (back off) |
| Storage metadata | 15 seconds | 3 (back off) |
| Expire job | — | 3 (exponential 5s) |
| Cleanup job | — | 3 (exponential 5s) |
| Reconcile job | — | 3 (linear 5s) |

## Backup and Recovery

### Database Backup

PostgreSQL is the primary system of record. Back it up using standard `pg_dump`:

```bash
pg_dump --format=custom --no-acl --no-owner \
  "$DATABASE_URL" > anonshare-$(date +%Y%m%d-%H%M%S).dump
```

Restore:
```bash
pg_restore --dbname="$DATABASE_URL" --no-acl --no-owner anonshare-YYYYMMDD-HHMMSS.dump
```

### Storage Objects

Object storage is backed by the provider's own durability guarantees. For R2 or S3, enable versioning or cross-region replication if needed. For self-hosted MinIO, configure replication or backup the `minio_data` volume.

### Redis

Redis contains ephemeral but operationally important state: BullMQ job queues, rate-limit counters, rate-limit blocked metrics, and OAuth pending state tokens (TTL-scoped, single-use). Persistence is desirable for queue durability but not strictly required. Losing Redis on restart means in-flight jobs may need to be re-enqueued by the reconciler, and any in-progress OAuth login flows will need to be restarted by the user.

Configure AOF persistence in Redis for best queue durability:
```
appendonly yes
appendfsync everysec
```

## Recovering from Common Failures

### Worker crashed with in-flight jobs

BullMQ keeps job state in Redis. Restarting the worker process will resume processing. Jobs in `active` state when the worker crashed will be retried according to `attempts` settings.

### Database unreachable

The API returns 503 until the database recovers. The worker's BullMQ connections to Redis remain independent — jobs continue to queue and will drain when the database returns.

### Storage unreachable

Upload requests will fail with 503 (validated pre-condition). Active download links that use presigned URLs remain valid until URL expiry. Cleanup jobs will fail with `transient` error and retry.

### Reconciler detects orphan

The reconciler logs `reconciliation.anomaly_detected` events with `type` and `fileId`. These surface in the admin dashboard under **Anomalies**. Follow the anomaly record to investigate. Confirmed orphaned objects can be deleted manually from the storage provider console; confirmed orphaned DB records can be marked `deleted` via the admin moderation endpoint.

### One-shot null-expiration repair

Legacy active/expiring rows with a null expiration timestamp are no longer repaired in the steady-state reconcile loop. Use the one-shot operational script instead:

```bash
bun --env-file=.env packages/infrastructure/src/scripts/repair-null-expiration.ts
```

Run it deliberately during maintenance windows or after importing legacy data. The worker reconcile loop now assumes that any such legacy backfill is handled out-of-band.

## Dependency Upgrade Policy

- Do not upgrade pinned infrastructure images (PostgreSQL, Redis, MinIO) without testing migration path.
- The Drizzle schema must be migrated forward, never backwards. See `docs/conventions.md` for the migration workflow.
- Bun runtime upgrades: test with `bun run verify` before deploying.

## Known Limitations (v1)

- Single admin only. The GitHub allowlist is a single `GITHUB_ALLOWED_USER_ID`.
- No password-protected shares, E2E encryption, or malware scanning.
- Preview is restricted to images, video, audio, PDF, and plain text. Other MIME types show download only.
- Large file uploads (near 256 MB) may require reverse proxy body size configuration (`client_max_body_size` in nginx, etc.).
- Rate limits are Redis-backed. If Redis is unavailable and degraded mode is active, the API falls back to a per-process in-memory fixed-window counter. In a multi-replica deployment the in-memory fallback is not shared across instances, so the effective rate limit is multiplied by the replica count during an outage. The fallback is intentionally conservative and is strictly for short outages; restore Redis as quickly as possible.
- Job deduplication depends on BullMQ job IDs. If Redis is wiped, duplicate jobs may run during the next reconcile sweep.
