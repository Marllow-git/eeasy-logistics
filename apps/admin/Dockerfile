# syntax=docker/dockerfile:1
# Admin image (platform §2, ADR-0038; WEB-19 decision 2.7): the platform console's Next.js
# standalone server, the same shape as apps/web/Dockerfile (PLAT-3 decision 2.8).
#   docker run -p 3000:3000 IMAGE       serves on PORT (3000) on every interface
# Build from the repository root: docker build -f apps/admin/Dockerfile .
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
# The admin app and the workspace packages it depends on, nothing else. The build runs in
# dependency order, so packages/contracts generates its clients (PLAT-15) before next build
# typechecks. The Next.js cache mount has its own id so the web and admin builds never share it.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "@eeasy-logistics/admin..."
RUN --mount=type=cache,id=next-cache-admin,target=/repo/apps/admin/.next/cache \
    pnpm --filter "@eeasy-logistics/admin..." run build

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
# server.js sits at apps/admin/ inside the standalone tree because tracing starts at the
# repository root (outputFileTracingRoot); static assets are not traced and are copied beside it.
COPY --from=build /repo/apps/admin/.next/standalone ./
COPY --from=build /repo/apps/admin/.next/static ./apps/admin/.next/static
# The base image's unprivileged user "node", by uid so runAsNonRoot can verify it. The files
# stay root-owned, so the process cannot change them.
# Only Next.js's runtime cache directory is writable.
RUN mkdir -p apps/admin/.next/cache && chown 1000:1000 apps/admin/.next/cache
USER 1000:1000
EXPOSE 3000
CMD ["node", "apps/admin/server.js"]
