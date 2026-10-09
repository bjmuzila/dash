# vela.cbedge.net — the standalone Vela chart workspace.
#
# Builds cbedge-v3 in its `vela` mode (vela.html → src/vela/main.tsx, base '/',
# output dist-vela/) and serves it with nginx, which also gates every page and
# reverse-proxies /api /proxy /ws to the dashboard container (deploy/vela/nginx.conf).
#
# NOT A FORK. It is the same cbedge-v3 source the root Dockerfile builds into
# public/v3; this image only builds a second entry from it. Never copy cbedge-v3
# into a folder of its own for this — voltick-v3/ shows what that costs.
#
# Build context is the REPO ROOT (see docker-compose.yml, same as the daily and
# household services) so this file and nginx.conf can live in deploy/vela/, but
# only cbedge-v3/ and this folder are copied in.
FROM node:20-alpine AS build
WORKDIR /app/cbedge-v3
COPY cbedge-v3/ ./

# Same three guards as the cbedge-v3 step in the root Dockerfile, for the same
# reasons recorded there:
#   rm -f package-lock.json     a Windows-resolved lockfile drops the linux-x64
#                               rollup / tailwind oxide binaries on a cold install
#   PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD   the devDep's ~150MB Chromium is never used here
#   check:theme                 the one gate that catches a push made without building
# build:vela, not `build`: budgets are a commit-time check, never a deploy one.
# npm download cache persists on the VPS between builds (not baked into the image).
RUN --mount=type=cache,target=/root/.npm \
    rm -f package-lock.json \
 && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --no-audit --no-fund \
 && npm run check:theme \
 && npm run build:vela \
 && mv dist-vela/vela.html dist-vela/index.html

FROM nginx:alpine
COPY deploy/vela/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/cbedge-v3/dist-vela /usr/share/nginx/html
COPY deploy/vela/denied.html /usr/share/nginx/html/denied.html
EXPOSE 8091
