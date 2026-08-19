#!/usr/bin/env bash
# Geo Foundry CMS — mk-dev image build
# Host containers cannot reach the npm registry, so this script follows the
# kling-eu pattern: build on the host, then package the standalone output
# into a versioned image via docker cp + docker commit. The resulting layout
# matches deploy/Dockerfile exactly.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE_NAME="${IMAGE_NAME:-geo-foundry-cms}"
IMAGE_TAG="${1:-}"
PKG_CONTAINER="geo-foundry-cms-pkg-$$"

if [[ -z "${IMAGE_TAG}" ]]; then
  IMAGE_TAG="mk-dev-$(git -C "${PROJECT_DIR}" rev-parse --short HEAD)"
fi
FULL_IMAGE="${IMAGE_NAME}:${IMAGE_TAG}"

cleanup() {
  docker rm -f "${PKG_CONTAINER}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "=== Step 1/3: host build (workspace deps + CMS standalone) ==="
cd "${PROJECT_DIR}"
export NEXT_TELEMETRY_DISABLED=1
pnpm --filter @geo/cms... build
pnpm --filter @geo/cms build

STANDALONE="${PROJECT_DIR}/apps/cms/.next/standalone"
if [[ ! -f "${STANDALONE}/apps/cms/server.js" ]]; then
  echo "standalone output missing: ${STANDALONE}/apps/cms/server.js" >&2
  exit 1
fi
cp -r "${PROJECT_DIR}/apps/cms/.next/static" "${STANDALONE}/apps/cms/.next/static"

echo "=== Step 2/3: packaging container (${FULL_IMAGE}) ==="
docker rm -f "${PKG_CONTAINER}" >/dev/null 2>&1 || true
docker run -d --name "${PKG_CONTAINER}" node:24-alpine sh -c 'sleep 600' >/dev/null
docker exec "${PKG_CONTAINER}" addgroup --system --gid 1001 nodejs
docker exec "${PKG_CONTAINER}" adduser --system --uid 1001 -G nodejs nextjs
docker exec "${PKG_CONTAINER}" sh -c 'mkdir -p /app && chown nextjs:nodejs /app'
docker cp "${STANDALONE}/." "${PKG_CONTAINER}:/app/"

echo "=== Step 3/3: commit image ==="
docker commit \
  --change 'ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3090 HOSTNAME=0.0.0.0' \
  --change 'USER nextjs' \
  --change 'EXPOSE 3090' \
  --change 'HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3090/api/health || exit 1' \
  --change 'CMD ["node", "apps/cms/server.js"]' \
  --change 'WORKDIR /app' \
  "${PKG_CONTAINER}" "${FULL_IMAGE}" >/dev/null

echo "image built: ${FULL_IMAGE}"
docker image inspect "${FULL_IMAGE}" --format 'digest={{.RepoDigests}} id={{.Id}}' || true
