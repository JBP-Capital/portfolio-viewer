# syntax=docker/dockerfile:1
FROM node:24-alpine AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/market-data/package.json packages/market-data/
COPY apps/worker/package.json apps/worker/
RUN npm ci --omit=dev -w @pv/worker -w @pv/db -w @pv/core -w @pv/market-data

FROM node:24-alpine
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=deps /repo/node_modules node_modules
COPY package.json tsconfig.base.json ./
COPY packages/core packages/core
COPY packages/db packages/db
COPY packages/market-data packages/market-data
COPY apps/worker apps/worker
USER node
CMD ["node", "apps/worker/src/main.ts"]
