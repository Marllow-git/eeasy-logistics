# syntax=docker/dockerfile:1
# API image (platform §2; PLAT-3 decision 2.8). One image, three process roles chosen by --role:
#   docker run IMAGE                    api (the default), HTTP on PORT, 3000 unless set
#   docker run IMAGE --role worker      queue consumers, outbox relay, schedulers
#   docker run IMAGE --role migrate     one-shot migration job (data §11 step 5)
# Build from the repository root: docker build -f apps/api/Dockerfile .
# Configuration comes from the environment at run time (packages/config); nothing is baked in.

ARG NODE_IMAGE=node:22.23.4-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    SKIP_INSTALL_SIMPLE_GIT_HOOKS=1 \
    DO_NOT_TRACK=1
RUN corepack enable
WORKDIR /repo
COPY . .

# ---------------------------------------------------------------- build: compile the API
FROM base AS build
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "@eeasy-logistics/api..."
RUN pnpm --filter @eeasy-logistics/api run build

# ---------------------------------------------------------------- prod-deps: runtime packages only
# The workspace layout is kept instead of flattening it with `pnpm deploy`: workspace packages
# ship TypeScript source that Node strips at run time, and Node refuses to strip types under
# node_modules, where `pnpm deploy` copies them (plan §8). --filter-prod leaves out the
# workspace packages the API only uses as dev dependencies (ESLint and TypeScript configs).
FROM base AS prod-deps
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --ignore-scripts --filter-prod "@eeasy-logistics/api..."

# ---------------------------------------------------------------- runtime
FROM ${NODE_IMAGE} AS runtime
# npm, npx, corepack and yarn are not needed to run the API; removing them removes their CVEs.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn-* \
      /usr/local/bin/yarn /usr/local/bin/yarnpkg
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /repo/package.json ./package.json
COPY --from=prod-deps /repo/node_modules ./node_modules
COPY --from=prod-deps /repo/packages ./packages
COPY --from=prod-deps /repo/apps/api/package.json ./apps/api/package.json
COPY --from=prod-deps /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /repo/apps/api/dist ./apps/api/dist
WORKDIR /app/apps/api
# The base image's unprivileged user "node", by uid so runAsNonRoot can verify it. The files
# stay root-owned, so the process cannot change them.
USER 1000:1000
EXPOSE 3000
ENTRYPOINT ["node", "dist/main.js"]
CMD ["--role", "api"]
