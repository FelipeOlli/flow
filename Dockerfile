FROM node:20-alpine AS base

FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Dummy values so Next.js build doesn't fail on missing env vars
# Real values are injected at runtime by EasyPanel
ENV NEXTAUTH_URL=http://localhost:3000
ENV NEXTAUTH_SECRET=build-placeholder-secret
ENV GOOGLE_CLIENT_ID=build-placeholder
ENV GOOGLE_CLIENT_SECRET=build-placeholder
ENV CRON_SECRET=build-placeholder
ENV DEFAULT_TIMEZONE=America/Sao_Paulo
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Persistent data directory for token store (mount a volume here in EasyPanel)
RUN mkdir -p /app/data && chown nextjs:nodejs /app/data

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# All secrets (NEXTAUTH_SECRET, NEXTAUTH_URL, GOOGLE_CLIENT_ID, etc.)
# must be set as environment variables in EasyPanel service settings.
# They are NOT baked into the image so they stay stable across deploys.

CMD ["node", "server.js"]
