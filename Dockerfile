# Multi-stage build for the Next.js web app, producing a small standalone
# runtime image suitable for the OKE deployment (see k8s/ and infra/).
#
# NEXT_PUBLIC_* variables are inlined into the client JS bundle at build
# time by Next.js, so they must be passed as build args here rather than
# as runtime environment variables. Changing one of them means rebuilding
# the image with a new value — there is no way to override them after the
# image is built. deploy/bootstrap.sh reads these from
# deploy/.env.production and the in-cluster kaniko build reads them from
# the web-build-args ConfigMap (see k8s/ci/).

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Baked into the client bundle at build time. Defaults keep local
# `docker build` runnable without extra flags; real values are supplied
# by deploy/bootstrap.sh (bootstrap path) or the deploy-poller's kaniko
# Job (in-cluster CD path).
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_AUTH_FLOW=magic_link
ENV NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL}
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY}
ENV NEXT_PUBLIC_AUTH_FLOW=${NEXT_PUBLIC_AUTH_FLOW}
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# `output: "standalone"` (next.config.ts) traces only the dependencies the
# server actually needs and copies them into .next/standalone, including a
# self-contained node_modules. sharp is a devDependency in package.json
# (used only for local `next/image` optimization during development); the
# standalone trace does not pick it up automatically for the runtime image,
# so we install it explicitly in this stage rather than relying on the
# builder's node_modules copy.
RUN npm install --omit=dev sharp@^0.34.5 --prefix /tmp/sharp-install \
  && mkdir -p ./node_modules \
  && cp -r /tmp/sharp-install/node_modules/* ./node_modules/ \
  && rm -rf /tmp/sharp-install

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
