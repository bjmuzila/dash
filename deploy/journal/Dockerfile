# journal.cbedge.net — Voltick Journal: LuxAlgo's open-source Trade Journal (MIT),
# https://github.com/LuxAlgo/trade-journal, built from a pinned commit with ONLY
# the Voltick branding in branding/ applied on top (name, wordmark, favicon).
#
# NOT VENDORED. The source is cloned at build time from the commit below, so
# there is no copy of it in this repo to drift (voltick-v3/ shows what a copy
# costs). To update: change JOURNAL_REF to a newer commit SHA from upstream
# main, then `docker compose build journal && docker compose up -d journal`.
#
# The stages mirror upstream's own Dockerfile: pnpm install → `next build`
# (output: standalone) → a slim runner with only the standalone server.
# Upstream builds clean at this SHA (checked 2026-10-08: install + build +
# a cold start against an empty data dir, which creates journal.db itself).
#
# Data: SQLite at /data/journal.db plus a generated encryption key file for
# broker credentials, both on the host volume in docker-compose.yml. Back up
# /opt/trade-journal-data and you have backed up the journal.
#
# Gate: none inside this image. The `journal-gate` nginx in front of it
# (deploy/journal/nginx.conf) answers every request first.

FROM node:22-slim AS builder
ARG JOURNAL_REF=7fc41406f69aa2f0ff2644b5cbcc2f9393b4d15a
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable
RUN git clone https://github.com/LuxAlgo/trade-journal.git /repo \
 && cd /repo \
 && git checkout --quiet "$JOURNAL_REF"
WORKDIR /repo
# Voltick Journal branding: the one difference from upstream (branding/apply.mjs).
# Fails the build if upstream moved a line it edits, rather than half-branding.
COPY branding/ /branding/
RUN node /branding/apply.mjs /repo/apps/web
RUN pnpm install --frozen-lockfile \
 && pnpm --filter web build

FROM node:22-slim AS runner
ENV NODE_ENV=production
ENV JOURNAL_DATA_DIR=/data
WORKDIR /app
COPY --from=builder /repo/apps/web/.next/standalone ./
COPY --from=builder /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /repo/apps/web/public ./apps/web/public
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME /data
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "apps/web/server.js"]
