# syntax=docker/dockerfile:1
# API image (platform §2; PLAT-3 decision 2.8). One image, three process roles chosen by --role:
#   docker run IMAGE                    api (the default), HTTP on PORT, 3000 unless set
#   docker run IMAGE --role worker      queue consumers, outbox relay, schedulers
#   docker run IMAGE --role migrate     one-shot migration job (data §11 step 5)
# Build from the repository root: docker build -f apps/api/Dockerfile .
# Configuration comes from the environment at run time (packages/config); nothing is baked in but
# the release name: --build-arg ELX_RELEASE=sha-<commit> (main.yml) becomes ELX_RELEASE, the
# service.version of the telemetry and the Sentry release (PLAT-14 plan 2.1); default dev.

ARG NODE_IMAGE=node:24.22.2-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85

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
# The contracts first: controllers import the generated schemas through the server-safe
# `@eeasy-logistics/contracts/<surface>/schemas` entries (A-17, PLAT-6 review round 2).
RUN pnpm --filter @eeasy-logistics/contracts run build
RUN pnpm --filter @eeasy-logistics/api run build
# The seed tool (local and ci only; it needs the superuser URL, which staging and production refuse)
# never ships in the image (PLAT-5 review L-4).
RUN rm -rf apps/api/dist/seed

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
# The generated contract code next to the package source (gitignored, so prod-deps has none).
COPY --from=build /repo/packages/contracts/generated ./packages/contracts/generated
# The reviewed SQL migrations and their journal: --role migrate applies them, /ready reads the
# expected version from the journal (PLAT-5).
COPY --from=build /repo/apps/api/drizzle ./apps/api/drizzle
WORKDIR /app/apps/api
# The base image's unprivileged user "node", by uid so runAsNonRoot can verify it. The files
# stay root-owned, so the process cannot change them.
USER 1000:1000
# Last, so a new commit reuses every layer above (PLAT-14).
ARG ELX_RELEASE=dev
ENV ELX_RELEASE=${ELX_RELEASE}
EXPOSE 3000
ENTRYPOINT ["node", "dist/main.js"]
CMD ["--role", "api"]
