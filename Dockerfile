# syntax=docker/dockerfile:1

# One image runs every process of the application; what a container does is decided by its command:
#   node server.js                      the web server (the default)
#   node dist-scripts/worker-loop.cjs   the ticker: starts due scheduled campaigns and sends the queue
#   node dist-scripts/migrate.cjs       applies database migrations, then exits
#   node dist-scripts/create-admin.cjs  creates the first admin
# See compose.yaml for the three running together.

ARG NODE_VERSION=22.23
ARG ALPINE_VERSION=3.24

# ------------------------------------------------------------ dependencies
FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS dependencies
WORKDIR /app
# Only the manifests, so this layer is rebuilt only when a dependency changes.
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

# ------------------------------------------------------------------- build
FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    DOCKER_BUILD=true
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
# No database or secrets are needed to build: the database connection and the
# encryption key are both resolved on first use, not at import time.
RUN npm run build && npm run build:scripts

# ----------------------------------------------------------------- runtime
FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# tini is process 1: it passes SIGTERM on to the application and reaps finished child processes.
RUN apk add --no-cache tini

# Standalone output carries only the modules the server actually needs.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
# The migration, admin and worker scripts are pre-bundled to self-contained
# JavaScript, so the image needs no TypeScript toolchain.
COPY --from=build --chown=node:node /app/dist-scripts ./dist-scripts
COPY --from=build --chown=node:node /app/drizzle ./drizzle
COPY --chown=node:node docker-entrypoint.sh ./

# Never root. The image holds no secrets: every one arrives as an environment variable at run time.
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Run through sh, so it works whatever file mode a checkout gave the script.
ENTRYPOINT ["/sbin/tini", "--", "/bin/sh", "./docker-entrypoint.sh"]
CMD ["node", "server.js"]
