# MarketMind API — production image (NestJS, runs `node dist/src/main`)
# Build context: repository root (required for npm workspaces).

FROM node:20-alpine AS builder
WORKDIR /app

# Install workspace deps (root package.json + all workspace manifests must be
# present before `npm ci`; the root install is hoisted into node_modules).
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci

# Build shared contracts + API. The API `prebuild` builds contracts and runs
# `prisma generate`; `build` runs `nest build` (output: apps/api/dist).
COPY . .
RUN npm run build -w @marketmind/api

FROM node:20-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app

# Node modules are copied wholesale (dev deps included) so the image can also
# run `npx prisma migrate deploy` during the deploy bootstrap.
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/contracts ./packages/contracts
COPY --from=builder /app/apps/api ./apps/api

WORKDIR /app/apps/api
EXPOSE 3001
CMD ["node", "dist/src/main"]