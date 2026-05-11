# Readiness Checklist

This document is the manual go-live checklist for anonshare.dev. Execute it before publishing any deployment that will serve real users. All checks should pass before the project is considered portfolio-ready.

## 1. Critical Flows

Execute each flow end-to-end in the target environment.

### 1.1 Anonymous Upload

- [ ] Landing page loads at `APP_BASE_URL` with the upload form visible
- [ ] File picker and drag-and-drop both trigger file selection
- [ ] Option controls (one-time, preview, expiration) appear and are functional
- [ ] Setting `one-time` disables `allow preview` and vice versa
- [ ] Expiration dropdown offers only valid values (1d, 7d, 30d, none)
- [ ] Upload of a small file (< 1 MB) succeeds with progress feedback
- [ ] Upload of a file at the limit (near 256 MB) succeeds
- [ ] Upload of a file exceeding the limit is rejected with a clear error
- [ ] After success, the share link is displayed with copy and open actions
- [ ] The copy action places the full URL in the clipboard

### 1.2 Share Page and Download

- [ ] Opening the share link shows the file page with correct metadata (filename, size, type)
- [ ] Status badge reads "Active" for a freshly uploaded file
- [ ] The "Download" button downloads the file with the correct filename
- [ ] Browser downloads the file without opening a new preview tab for binary types
- [ ] Opening the link in a private/incognito window works as expected

### 1.3 Preview

- [ ] Upload an image with `allow preview` enabled → share page shows the image inline
- [ ] Upload a PDF with `allow preview` enabled → share page renders PDF preview
- [ ] Upload a text file with `allow preview` enabled → share page renders truncated preview with notice
- [ ] File with `allow preview` disabled → no preview section is shown
- [ ] Upload with `one-time` + accidental `allow preview` → backend rejects the combination

### 1.4 One-Time Download

- [ ] Upload a file with `one-time` enabled
- [ ] Download it once → file downloads successfully
- [ ] Open the same link again → page shows "consumed" state with clear message
- [ ] Attempt concurrent downloads: only one succeeds, others see consumed state

### 1.5 Expiration

- [ ] Upload a file with a short expiration (e.g., 1 day)
- [ ] File page shows the expiration date correctly
- [ ] After expiration passes (or by manipulating `expiresAt` in the DB for testing), the page shows the expired state
- [ ] The download button no longer works on an expired file
- [ ] Background job marks the file as `expired` and runs cleanup

### 1.6 Report and Auto-Hide

- [ ] File page shows a "Report" action
- [ ] Submitting a report with a reason works without errors
- [ ] Re-submitting from the same IP is rate-limited after the configured threshold
- [ ] After reaching the auto-hide threshold (default 3 reports), the file page shows the "unavailable" state
- [ ] The file is still visible in the admin dashboard after auto-hide

### 1.7 Admin Login

- [ ] Visiting `/admin` without a session redirects to the login page
- [ ] Clicking "Sign in with GitHub" initiates the OAuth flow
- [ ] Completing OAuth with the allowlisted account grants access to the dashboard
- [ ] Completing OAuth with a non-allowlisted account returns to the login page with an error
- [ ] After API restart, an in-progress OAuth flow still completes (state is stored in Redis, not process memory)
- [ ] After login, refreshing the page keeps the session active
- [ ] Logging out destroys the session and redirects to the login page
- [ ] If logout cannot be confirmed by the API, the UI shows a local warning and API logs record the revocation failure

### 1.8 Admin Dashboard

- [ ] Overview cards show total files, active files, expired files, storage usage
- [ ] Report count and unresolved report count are visible
- [ ] Queue health indicator reflects the actual worker state
- [ ] File list loads with correct status filters
- [ ] Clicking a file opens the detail view with metadata, history, and moderation actions
- [ ] Hide action marks the file hidden and removes it from public access immediately
- [ ] Restore action reverts the hidden file to active
- [ ] Delete action marks the file deleted and triggers cleanup
- [ ] Reports section shows all pending reports with dismiss and resolve actions

## 2. Infrastructure Readiness

- [ ] `bun run infra:check` returns "All checks passed" (local) or equivalent in staging
- [ ] `GET /health` on the API returns `{ status: 'ok' }` with all dependencies healthy
- [ ] `GET /health` on the web process returns `{ status: 'ok' }`
- [ ] `GET /health` on the worker process returns `{ status: 'ok' }` with `ready: true`
- [ ] The API and worker health endpoints fail closed on dependency outages, while the web health endpoint remains process-only by design
- [ ] All three processes (web, API, worker) start without errors
- [ ] Worker logs `worker_ready` within 30 seconds of startup
- [ ] Reconcile scheduler is registered (visible in BullMQ dashboard or logs)

## 3. Security Checks

- [ ] Share pages include `<meta name="robots" content="noindex, nofollow">`
- [ ] Verified with `curl -s <share_url> | grep noindex`
- [ ] API responses for `/share/*` include `x-robots-tag: noindex, nofollow`
- [ ] API responses include `x-content-type-options: nosniff`
- [ ] API responses include `referrer-policy: strict-origin-when-cross-origin`
- [ ] No stack traces or internal error messages are visible in HTTP responses
- [ ] Admin routes return 302/401 without a valid session
- [ ] `GITHUB_ALLOWED_USER_ID` is set to a numeric GitHub ID (not a username string)
- [ ] `SESSION_SECRET` is at least 32 characters of random data
- [ ] No secrets are committed to version control (use `git log -p` to audit)

## 4. Observability Checks

- [ ] Structured logs appear in JSON format in production (`NODE_ENV=production`)
- [ ] `upload.created` event is logged after a successful upload with `requestId`
- [ ] `download.started` and `download.completed` events appear in logs
- [ ] `report.created` event is logged after a report submission
- [ ] `file.hidden` is logged for both automatic and manual hides with a clear trigger field
- [ ] `file.deleted` is logged after admin delete
- [ ] All log lines include `service` field (`api`, `worker`, or `web`)
- [ ] Worker logs include `queue` and `jobName` on every `job_completed` event
- [ ] `health_check_completed` event appears when API `/health` is called
- [ ] Unhandled errors are caught by the global error handler and logged (not exposed to clients)

## 5. CI/CD Verification

- [ ] `.github/workflows/ci.yml` runs on every PR and push to `main`
- [ ] `bun.lock` is committed and the branch does not rely on an untracked local lockfile
- [ ] CI runs dependency health check, BullMQ version parity, lint, typecheck, tests, build, and migration validation
- [ ] `bun run verify:repo` passes locally and CI still installs with a frozen Bun lockfile
- [ ] All CI steps pass with 0 errors on the `main` branch
- [ ] CI uses containerized PostgreSQL, Redis, and MinIO for tests that need them
- [ ] CI validates migration drift (`db:generate` + clean git diff on migrations)
- [ ] The `bun run verify` local gate mirrors the CI gate

## 6. Performance Checks

- [ ] Home page loads in under 2 seconds on a normal connection
- [ ] Share page metadata (active file) loads in under 1.5 seconds at p95
- [ ] Download initiation (presigned URL generation) completes in under 3 seconds
- [ ] The worker processes a newly enqueued cleanup job within 60 seconds of enqueueing

## 7. Final Sign-off

- [ ] All flow checks above completed successfully
- [ ] `bun run verify` passes with 0 errors locally
- [ ] CI is green on `main`
- [ ] `docs/deploy.md` accurately reflects the current deployment topology
- [ ] `docs/architecture.md` and `docs/conventions.md` are up to date
- [ ] Docs, CI, and runtime scripts all describe the same supported environment contract
- [ ] About page (`/about`) accurately describes the current stack and trade-offs
- [ ] No TODO or FIXME comments remain in production-path code
