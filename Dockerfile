# Companion always-on image: paired Next + Eve via `pnpm start`.
# Alchemy Docker Postgres stays outside this image (see docs/ops/hosted-fly.md).
# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.24.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile

FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.24.0 --activate
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY . .
# Channel rewrites bake Eve's loopback port at build time — keep start args matched.
ENV EVE_NEXT_PRODUCTION_PORT=4274
ENV NEXT_TELEMETRY_DISABLED=1
# Depot remote builders OOM (exit 137) on default heap + Next/TS peak RSS.
# Cap V8 heap so GC stays aggressive on small Depot RAM; split Eve/Next.
ENV NODE_OPTIONS=--max-old-space-size=2048
ENV OPEN_INSTINCT_LOW_MEM_BUILD=1
# Build-time placeholders only; runtime secrets come from Fly (never bake .env*).
ENV BETTER_AUTH_URL=http://127.0.0.1:3000
ENV COMPANION_PUBLIC_BASE_URL=http://127.0.0.1:3000
ENV DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/open_instinct_prod
ENV DATABASE_URL_UNPOOLED=postgresql://postgres:postgres@127.0.0.1:5432/open_instinct_prod
# Skip turbo daemon; run Eve then Next in separate layers (RSS reclaim between).
RUN pnpm exec eve build
RUN pnpm exec next build

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV EVE_NEXT_PRODUCTION_PORT=4274
RUN corepack enable && corepack prepare pnpm@11.24.0 --activate \
  && apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /app /app
# Next binds all families for Fly proxy/health (IPv6); Eve stays on loopback.
EXPOSE 3000
CMD ["pnpm", "start", "--port", "3000", "--hostname", "::", "--eve-port", "4274"]
