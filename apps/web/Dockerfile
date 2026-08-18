# MarketMind Web — production image (Next.js 16, runs `next start`)
# Build context: repository root (required for npm workspaces).

FROM node:20-alpine AS builder
WORKDIR /app

# Install workspace deps (root install is hoisted into node_modules).
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci

# Build shared contracts first, then the Next.js app.
# NEXT_PUBLIC_API_URL is inlined into the client bundle at build time, so it is
# required here and must match the runtime value (see the runner stage).
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
COPY . .
RUN npm run build -w @marketmind/contracts && npm run build -w @marketmind/web

FROM node:20-alpine AS runner
ENV NODE_ENV=production
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

WORKDIR /app

COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/contracts ./packages/contracts
COPY --from=builder /app/apps/web ./apps/web

WORKDIR /app/apps/web
EXPOSE 3000
CMD ["npx", "next", "start", "-H", "0.0.0.0"]