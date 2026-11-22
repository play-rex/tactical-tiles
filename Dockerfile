# Production image: game server + built website in one container.
# Saved tables are NOT in the image; they live in the `tiles-data` volume mounted at /data.
# Build it with deploy/deploy.sh, which feeds only committed code (git archive) to Docker.

FROM node:22-bookworm-slim AS build
RUN npm install -g pnpm@9.15.0
WORKDIR /app

# Dependencies first, so code-only changes reuse this layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/engine/package.json packages/engine/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @tactical/web build

# Keep only what the server needs at runtime (server + engine, production deps).
RUN rm -rf node_modules apps/*/node_modules packages/*/node_modules \
 && pnpm install --frozen-lockfile --prod --filter "@tactical/server..."

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=2767 \
    TABLES_DIR=/data/tables
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/packages/engine ./packages/engine
COPY --from=build --chown=node:node /app/apps/server ./apps/server
COPY --from=build --chown=node:node /app/apps/web/dist ./apps/web/dist

# /data is owned by the unprivileged user so a fresh volume is writable.
RUN mkdir -p /data/tables && chown -R node:node /data
VOLUME /data
USER node
WORKDIR /app/apps/server
EXPOSE 2767
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:2767/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "--import", "tsx", "src/index.ts"]
