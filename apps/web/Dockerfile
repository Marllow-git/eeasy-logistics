# syntax=docker/dockerfile:1
# Web image (platform §2; PLAT-3 decision 2.8): the Next.js standalone server.
#   docker run -p 3000:3000 IMAGE       serves on PORT (3000) on every interface
# Build from the repository root: docker build -f apps/web/Dockerfile .
# Standalone output already holds only the traced runtime files, so no `pnpm deploy` step is
# needed (plan §8; vercel:nextjs self-hosting guidance).

ARG NODE_IMAGE=node:24.22.2-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85

# ---------------------------------------------------------------- build
FROM ${NODE_IMAGE} AS build
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    SKIP_INSTALL_SIMPLE_GIT_HOOKS=1 \
    NEXT_TELEMETRY_DISABLED=1 \
    DO_NOT_TRACK=1
RUN corepack enable
WORKDIR /repo
COPY . .
# The web app and the workspace packages it depends on, nothing else. The build runs in dependency
# order, so packages/contracts generates its clients (PLAT-15) before next build typechecks.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "@eeasy-logistics/web..."
# The release Sentry tags errors with (PLAT-14 plan 2.7): main.yml passes sha-<commit>; next build
# inlines NEXT_PUBLIC_* values, so it is a build argument, declared after the install layer.
ARG NEXT_PUBLIC_RELEASE=dev
RUN --mount=type=cache,id=next-cache,target=/repo/apps/web/.next/cache \
    pnpm --filter "@eeasy-logistics/web..." run build

# ---------------------------------------------------------------- runtime
FROM ${NODE_IMAGE} AS runtime
# npm, npx, corepack and yarn are not needed to serve the app; removing them removes their CVEs.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn-* \
      /usr/local/bin/yarn /usr/local/bin/yarnpkg
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app
# server.js sits at apps/web/ inside the standalone tree because tracing starts at the
# repository root (outputFileTracingRoot); static assets are not traced and are copied beside it.
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
# The base image's unprivileged user "node", by uid so runAsNonRoot can verify it. The files
# stay root-owned, so the process cannot change them.
# Only Next.js's runtime cache directory is writable.
RUN mkdir -p apps/web/.next/cache && chown 1000:1000 apps/web/.next/cache
USER 1000:1000
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
