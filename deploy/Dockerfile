# Geo Foundry CMS and Worker — production container
# Multi-stage pnpm workspace build. On hosts where Docker builds cannot reach
# the npm registry (mk-dev), deploy/image-build-mkdev.sh produces the same
# layout from a host-side build instead; this Dockerfile stays the canonical
# production definition for connected environments.
#
# syntax=docker/dockerfile:1.7

# ---- deps stage ----
# Workspace manifests only, so dependency layers cache independently of source.
FROM node:24-alpine AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/package.json apps/
COPY apps/cms/package.json apps/cms/
COPY apps/worker/package.json apps/worker/
COPY packages/package.json packages/
COPY packages/*/package.json packages/
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm config set registry https://registry.npmmirror.com && \
    pnpm install --frozen-lockfile --filter @geo/cms... --filter @geo/worker...

# ---- builder stage ----
FROM node:24-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ENV GEO_FOUNDRY_CMS_CONFIG_MODE=build
RUN corepack enable
COPY --from=deps /app ./
COPY . .
RUN pnpm --filter @geo/cms... build && \
    pnpm --filter @geo/worker... build && \
    pnpm --filter @geo/cms build && \
    pnpm deploy --legacy --filter @geo/worker --prod /worker

# ---- runner stage ----
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3090
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 -G nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/apps/cms/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/cms/.next/static ./apps/cms/.next/static
COPY --from=builder --chown=nextjs:nodejs /worker /worker

USER nextjs

EXPOSE 3090

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3090/api/health || exit 1

CMD ["node", "apps/cms/server.js"]
