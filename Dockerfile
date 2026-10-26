# syntax=docker/dockerfile:1
# One image for every service: the API, worker, admin, storefront and the
# database migration job run the same build with different commands (see infra/production/docker-compose.yml).

FROM node:24.21.0-bookworm-slim AS build
ENV CI=true NEXT_TELEMETRY_DISABLED=1 COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

# Dependencies first, so source changes reuse the cached install.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/admin/package.json apps/admin/
COPY apps/storefront/package.json apps/storefront/
COPY packages packages
RUN find packages -mindepth 2 -not -name package.json -not -type d -delete \
 && pnpm install --frozen-lockfile

COPY . .
# The admin and storefront proxy to the API; Next.js fixes rewrites at build time.
ARG API_INTERNAL_URL=http://api:4000
ENV API_INTERNAL_URL=${API_INTERNAL_URL}
RUN pnpm build

FROM node:24.21.0-bookworm-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /app /app
USER node
# Overridden per service.
CMD ["node", "apps/api/dist/server.js"]
