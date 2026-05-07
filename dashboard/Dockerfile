FROM node:20-alpine AS base

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* are inlined at `next build`; runtime env alone is not enough for the client bundle.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY

RUN npx prisma generate
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Prisma CLI (`prisma migrate deploy`) is invoked at startup before Next.js
# launches. The CLI fans out into transitive deps (`@prisma/config` → `effect`,
# etc.) that Next standalone tracing never bundles, and surgically copying
# individual packages (`prisma`, `@prisma`, ...) hits whack-a-mole on every
# Prisma minor bump. Copying the full builder `node_modules` is intentional
# image-size cost in exchange for migration reliability — V1.1 can split the
# migration tool into a separate stage if image size becomes a constraint.
# (Order matters: this lands after the standalone copy so the full graph
# overlays standalone's traced subset; same versions, so equivalent at runtime.)
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma

COPY --chown=nextjs:nodejs scripts/entrypoint.sh ./scripts/entrypoint.sh
RUN chmod +x ./scripts/entrypoint.sh

USER nextjs
EXPOSE 3001
ENV PORT=3001
CMD ["./scripts/entrypoint.sh"]
