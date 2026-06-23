# server-v2 (Next.js + WS feed engine) — single process, runs as-is on a VPS.
# Multi-stage: build Next, then run the same node entrypoint package.json uses.
FROM node:20-bookworm-slim AS base
ENV DEBIAN_FRONTEND=noninteractive

# System deps:
#  - tzdata: ET-gated schedulers (MVC/EOD/weekly publishers) gate on America/
#    New_York wall-clock time, so the container MUST have tz data + TZ set.
# NOTE: puppeteer/tesseract/html2canvas are declared in package.json but are NOT
# imported anywhere in the running app (verified by grep). The server does not
# need chromium, so we skip ~400MB of browser libs. If you later add a script
# that launches puppeteer, re-add chromium + its libs here.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates tzdata \
    && rm -rf /var/lib/apt/lists/*

ENV TZ=America/New_York
# Skip puppeteer's bundled chromium download (the dep is unused at runtime).
ENV PUPPETEER_SKIP_DOWNLOAD=1

WORKDIR /app

# ---- deps ----
FROM base AS deps
COPY package.json package-lock.json* ./
# Use ci when a lockfile exists, else fall back to install.
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# ---- build ----
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* vars (APP_VERSION, OWNER_USER_ID) are inlined at build time.
# Pass them via --build-arg / compose build.args so the client bundle is correct.
ARG NEXT_PUBLIC_OWNER_USER_ID
ENV NEXT_PUBLIC_OWNER_USER_ID=${NEXT_PUBLIC_OWNER_USER_ID}
RUN npm run build

# ---- runtime ----
FROM base AS runtime
ENV NODE_ENV=production
# server-v2 reads .env.local at boot (override:true). We mount it at runtime
# rather than baking secrets into the image — see docker-compose env_file.
COPY --from=build /app ./
EXPOSE 3001
# Same entrypoint package.json "start" uses. PORT is read from env (default 3001).
CMD ["node", "server-v2/server-with-proxy.js"]
