ARG BUN_VERSION=1.3.14

FROM oven/bun:${BUN_VERSION}-slim AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock bunfig.toml tsconfig.base.json tsconfig.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/infrastructure/package.json packages/infrastructure/package.json
RUN bun install --frozen-lockfile

FROM deps AS builder
ENV NODE_ENV=production
COPY .env.example .env
COPY apps ./apps
COPY packages ./packages
RUN bun run build
RUN bun build apps/web/scripts/start.ts --outfile apps/web/dist/docker-start.js --target bun

FROM base AS runtime-deps
COPY package.json bun.lock bunfig.toml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/infrastructure/package.json packages/infrastructure/package.json
RUN bun install --production --frozen-lockfile

FROM deps AS tooling
ENV NODE_ENV=production
COPY .env.example .env
COPY apps ./apps
COPY packages ./packages
ENTRYPOINT ["bun"]
CMD ["packages/infrastructure/src/scripts/run-drizzle.ts", "migrate"]

FROM base AS api
ENV NODE_ENV=production
WORKDIR /app/apps/api
COPY --from=builder /app/apps/api/dist ./dist
USER bun
EXPOSE 3001
CMD ["bun", "dist/index.js"]

FROM base AS worker
ENV NODE_ENV=production
WORKDIR /app/apps/worker
COPY --from=builder /app/apps/worker/dist ./dist
USER bun
EXPOSE 3002
CMD ["bun", "dist/index.js"]

FROM base AS web
ENV NODE_ENV=production
WORKDIR /app
COPY --from=runtime-deps /app/node_modules ./node_modules
COPY --from=runtime-deps /app/package.json ./package.json
COPY --from=runtime-deps /app/apps ./apps
COPY --from=runtime-deps /app/packages ./packages
COPY --from=builder /app/apps/web/dist ./apps/web/dist
USER bun
EXPOSE 3000
CMD ["bun", "apps/web/dist/docker-start.js"]