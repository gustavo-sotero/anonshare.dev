---
description: "Use when changing apps, packages, shared infrastructure, Docker Compose, root tooling, or foundational docs. Follow the monorepo boundaries and engineering conventions documented in docs/architecture.md and docs/conventions.md."
applyTo: "apps/**, packages/**, docker-compose.yml, README.md, docs/**, package.json, tsconfig*.json, biome.json, bunfig.toml"
---

# Foundation Boundaries

- Treat [docs/architecture.md](../../docs/architecture.md) and [docs/conventions.md](../../docs/conventions.md) as the source of truth for Module 1 foundation decisions.
- Preserve the existing process split: `apps/web` for UI and SSR-capable routes, `apps/api` for domain HTTP boundaries, and `apps/worker` for async lifecycle work.
- Do not introduce cross-app imports. Shared code belongs in `packages/*` and should be consumed through workspace aliases.
- Keep infrastructure contracts aligned with the current baseline: root `.env` for local Docker Compose defaults, per-process `.env` files for runtime configuration, and `bun run infra:check` / `GET /health` as the readiness path.
- Maintain the logging baseline from the foundation docs: structured logs with `event`, plus `requestId`, `actor`, `entity`, and `outcome` whenever they are known.
- Extend the existing shells and scaffolds instead of bypassing them when adding later-module behavior.