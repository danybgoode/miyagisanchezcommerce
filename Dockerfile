# Next.js 16 frontend — standalone production image for Cloud Run (us-east4).
# Build context is apps/miyagisanchez (this directory), NOT the monorepo root:
#   docker build -t <region>-docker.pkg.dev/<project>/miyagi-web/frontend:latest apps/miyagisanchez
#
# `output: 'standalone'` (next.config.ts) traces the deps each route actually
# needs into .next/standalone/node_modules. That trace does NOT reliably
# include `sharp` — Next's internal image optimizer requires it dynamically at
# runtime rather than via a static import, so static analysis misses most of
# its native binary + JS lib (confirmed by inspecting the traced output: only
# stub package.json files survived, not sharp/lib or the @img/sharp-<platform>
# binaries) — hence the explicit reinstall in the runner stage below, matching
# Next's own self-hosting Dockerfile guidance and this stage's own glibc/amd64
# platform.
#
# public/ and .next/static are NOT part of the standalone trace (Next only
# traces server-side code) — both are copied explicitly per Next's own
# self-hosting docs.

# ---- deps -------------------------------------------------------------------
FROM node:20-slim AS deps
WORKDIR /app
# package-lock.json makes this a deterministic, reproducible install (deps are
# caret-pinned in package.json, but npm ci pins to exactly what's in the
# lockfile — a rebuild of the same commit always gets the same tree).
COPY package.json package-lock.json ./
RUN npm ci

# ---- builder ------------------------------------------------------------------
FROM node:20-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- runner -------------------------------------------------------------------
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8080

RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Reinstall sharp fresh in THIS stage — the standalone trace above copied only
# stub files for it (see comment at top). package.json (copied by the
# standalone output as-is) already lists it, so this just fetches the
# prebuilt binary matching this stage's own platform. Runs as root (before the
# USER switch below), so re-chown the tree it touched.
RUN npm install sharp && chown -R nextjs:nodejs node_modules

USER nextjs
EXPOSE 8080
CMD ["node", "server.js"]
