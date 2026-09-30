# syntax=docker/dockerfile:1
FROM node:24-alpine AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/market-data/package.json packages/market-data/
COPY apps/web/package.json apps/web/
RUN npm ci

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/web apps/web
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w @pv/web

FROM node:24-alpine AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 MIGRATIONS_DIR=/app/migrations
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
COPY --from=build --chown=node:node /repo/packages/db/migrations ./migrations
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "apps/web/server.js"]
