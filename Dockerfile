# server-v2 (Next.js + WS feed engine) — single process, runs as-is on a VPS.
# Multi-stage: build Next, then run the same node entrypoint package.json uses.
FROM node:22-bookworm-slim AS base
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
# Use `npm install` directly. A Windows-generated package-lock.json does not always
# satisfy `npm ci` on Linux (platform-specific resolution, e.g. picomatch 2.3.2 vs
# 4.0.4) - that mismatch is harmless but `npm ci` errors loudly on it. `npm install`
# resolves correctly for this platform every time, so the build is clean and quiet.
RUN npm install --no-audit --no-fund

# ---- build ----
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* vars (APP_VERSION, OWNER_USER_ID) are inlined at build time.
# Pass them via --build-arg / compose build.args so the client bundle is correct.
ARG NEXT_PUBLIC_OWNER_USER_ID
ENV NEXT_PUBLIC_OWNER_USER_ID=${NEXT_PUBLIC_OWNER_USER_ID}
ARG NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL}
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY}
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
