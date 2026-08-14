# Whisper API — multi-stage build for Coolify (or any Docker host).
#
# Lives at the REPO ROOT on purpose: the server depends on the workspace-local
# @whisper/shared package, so the build context must be the whole repo — and a
# root-level Dockerfile means Coolify's defaults (Base Directory "/",
# Dockerfile Location "/Dockerfile") are already correct.
#
#   docker build .
#
# bookworm-slim rather than alpine: argon2 ships musl prebuilds today, but the
# glibc image keeps the door open for any future native dependency without
# dragging a compiler into the image.

FROM node:24-bookworm-slim AS build
WORKDIR /repo

# Install with the full workspace layout so npm links @whisper/shared.
COPY package.json package-lock.json* ./
COPY shared/package.json shared/
COPY server/package.json server/
RUN npm ci --workspace @whisper/shared --workspace @whisper/server --include-workspace-root --no-audit --no-fund

COPY tsconfig.base.json ./
COPY shared/ shared/
COPY server/ server/

RUN npm run build --workspace @whisper/shared \
 && npm run build --workspace @whisper/server

# Drop devDependencies for the runtime image. argon2's prebuilt .node binaries
# live in node_modules and must survive the prune — npm keeps them.
RUN npm prune --omit=dev


FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /repo

# Non-root: the API needs nothing from the filesystem but its own code.
USER node

COPY --from=build --chown=node:node /repo/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/shared/dist ./shared/dist
COPY --from=build --chown=node:node /repo/shared/package.json ./shared/package.json
COPY --from=build --chown=node:node /repo/server/dist ./server/dist
COPY --from=build --chown=node:node /repo/server/package.json ./server/package.json
COPY --from=build --chown=node:node /repo/server/migrations ./server/migrations
COPY --from=build --chown=node:node /repo/package.json ./package.json

EXPOSE 8080

# GET /health returns { status: "ok", database: "ok" | "unreachable" } — the
# check passes on a DB blip so a transient outage doesn't flap the container.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "server/dist/index.js"]
