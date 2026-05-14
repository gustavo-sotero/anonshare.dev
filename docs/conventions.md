# Engineering Conventions

This document consolidates the working conventions established in Module 1 so later modules can add behavior without re-litigating the project baseline.

## Naming

- Workspace packages use the `@anonshare/*` scope.
- App and package folders use `kebab-case`.
- TanStack file routes follow TanStack naming conventions such as `share.$token.tsx`.
- Environment variables are uppercase with `_` separators.
- Structured log `event` values use stable machine-readable identifiers: operational/platform events use `snake_case`, and product lifecycle milestones may use dotted namespaces such as `upload.created` or `file.hidden`.
- Queue names use `kebab-case` so they remain easy to read in BullMQ tooling.

## Import Boundaries

- `apps/*` must never import from other apps.
- Shared code belongs in `packages/*` and is consumed through workspace aliases.
- Do not import package source files by deep relative path such as `../../packages/...`.
- Use `~/*` only for local app-internal imports.
- Keep `bun.lock` committed. Reproducible installs are part of the repository contract, not an optional local convenience.

## Environment Policy

- A single root `.env` file configures all executable processes.
- The same root `.env` is used for local Docker Compose infrastructure defaults.
- CI and deployed processes must keep the same variable names even when each process receives its values independently from the host platform.
- API and worker boot fail fast on missing required runtime variables.
- Web runtime entrypoints validate env, while the production build stays resilient enough to compile without private runtime secrets.
- Root operational scripts derive local connection URLs from the root `.env` instead of maintaining a separate migration-only config.

## Logging Baseline

- Emit logs through `@anonshare/infrastructure/logger`.
- Include `event` on every operational log.
- Include `actor`, `entity`, `outcome`, and `requestId` whenever they are known.
- HTTP request logs must record method, path, status, and duration.
- Product lifecycle events that matter for observability must remain stable across processes: `upload.created`, `download.started`, `download.completed`, `report.created`, `file.hidden`, and `file.deleted`.
- Prefer machine-parseable context over free-form text fields.

## Operational Commands

- `bun run verify:repo` checks that `bun.lock` is committed, that CI still uses a frozen Bun install, and that the release promotion workflow contract remains intact.
- `bun run infra:up` starts PostgreSQL, Redis, and MinIO.
- `bun run infra:check` validates application-facing connectivity, not just container health.
- `bun run verify:bullmq` enforces BullMQ version parity across every workspace package that depends on it.
- `bun run verify` is the root quality gate before merging or handing off work.
- `bun run db:generate` and `bun run db:migrate` are the only supported entrypoints for Drizzle tooling.

## Database Evolution

To add a new migration after changing a schema file:

1. Modify the relevant table file(s) in `packages/infrastructure/src/db/schema/`.
2. Run `bun run db:generate` — Drizzle compares the schema against the migration history and appends a new numbered `.sql` file in `packages/infrastructure/src/db/migrations/`.
3. Review the generated `.sql` file before committing; ensure it reflects only the intended change.
4. Commit both the schema change and the generated migration file in the same commit.
5. Run `bun run db:migrate` (with a running database) to apply the migration.

Additional rules:
- Never edit a previously committed `.sql` migration file; create a new one instead.
- Never delete migrations from the `meta/` directory — Drizzle uses the journal to detect drift.
- The seed script (`bun run db:seed`) is idempotent and can be re-run safely after schema changes to refresh operational defaults.

## Module Boundaries

- Module 1 establishes topology, bootstrap, shared infrastructure, and governance only.
- Placeholder routes and handlers are acceptable when the corresponding product behavior is explicitly deferred to a later module.
- New module work should extend the existing shells and boundaries instead of bypassing them.

## Large Module Decomposition

When a route file or feature module grows beyond ~500 lines, extract supporting code into a co-located directory:

- Shared types and constants → `types.ts`
- Pure helper functions → `helpers.ts`
- Auth/session concerns → `session.ts`
- Database queries → `queries.ts`
- Feature-specific infrastructure → dedicated file (e.g. `queue-health.ts`, `transport.ts`)
- Router factory and route handlers → `index.ts`

The directory name must match the original file's import path so that existing `import { ... } from './module'` statements continue to resolve without changes.

### Test organisation for split modules

When splitting a large test file into per-route or per-pass test files, place all new test files in the same directory as the production code:

- Create `test-helpers.ts` (no `.test.` in the name) for shared types, builders, and factories. Bun will not discover it as a test suite.
- Create one `<route>.test.ts` (or `pass-<x>.test.ts` for worker passes) per logical group of tests.
- Import shared helpers with `import { ... } from './test-helpers'`.
- Import the production module under test with `import { ... } from './index'`, not from a parent path.

For TanStack Router routes, prefer route-level `validateSearch` and loaders for typed search parsing and initial data bootstrap. Avoid mount-only Effects whose only purpose is to interpret URL search params or perform the first request that the router can own directly.

## Share Page Route Pattern

The public share route (`routes/share.$token.tsx`) uses a thin route shell plus a token-keyed child component to guarantee full React state reset when the token changes:

```tsx
function SharePage() {
  const { token } = Route.useParams();
  return <SharePageContent key={token} />;
}

function SharePageContent() {
  // all token-scoped state initialises fresh on every mount
}
```

This follows the React guidance on [Preserving and Resetting State](https://react.dev/learn/preserving-and-resetting-state): changing the `key` remounts the component and resets all state without an effect-based cleanup pass.

The route keeps a dedicated `apps/web/src/share/transport.ts` module that validates all API responses against the shared schemas in `@anonshare/contracts` before handing them to the component. The pattern mirrors the admin transport module and makes the API boundary explicit. All async operations inside the content component (download, preview, availability refresh, report submission) accept and propagate an `AbortSignal` to avoid stale updates when the user navigates away or the component unmounts.

## Admin URL State

The admin dashboard drives all tab navigation, file inspection, and tab-level filter/pagination state through URL search parameters owned by the TanStack Router `validateSearch` function in `routes/admin.tsx`.

- **Read state** by consuming `AdminSearchParams` from the route's `search` object (via `useSearch` or the route component's props).
- **Write state** by calling `onUpdateSearch(updates: AdminSearchUpdate)` rather than local `useState`.
- **`AdminSearchParams`** lists every recognised key with its exact type. Unknown keys are silently discarded by `parseAdminSearchParams`.
- **`AdminSearchUpdate`** is a wider variant that allows explicit `undefined` values, signalling that the corresponding key should be removed from the URL. This is necessary because `exactOptionalPropertyTypes` prevents `Partial<AdminSearchParams>` from accepting `key: undefined` directly.
- The route-level `handleUpdateSearch` strips `undefined`-valued keys from the outgoing search object before merging, so callers can use `onUpdateSearch?.({ filesDays: undefined })` to clear a filter.
- `loaderDeps` excludes filter/pagination keys deliberately: tab and fileId drive data re-fetching; filters are applied client-side to the already-loaded dashboard snapshot.
- Filter button groups use `<fieldset>` + `<legend className="sr-only">` for accessibility compliance. Do not use `<div role="group">` — Biome's `a11y/useSemanticElements` rule rejects it.