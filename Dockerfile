# server-v2 (Next.js + WS feed engine) — single process, runs as-is on a VPS.
# Multi-stage: build Next, then run the same node entrypoint package.json uses.
FROM node:22-bookworm-slim AS base
ENV DEBIAN_FRONTEND=noninteractive

# System deps:
#  - tzdata: ET-gated schedulers (MVC/EOD/weekly publishers) gate on America/
#    New_York wall-clock time, so the container MUST have tz data + TZ set.
#  - chromium + fonts + libs: server-v2/budget-email.js launches headless
#    Chromium to screenshot /owner/budget for the daily briefing. Puppeteer uses
#    the system chromium (PUPPETEER_EXECUTABLE_PATH) rather than downloading its
#    own, so we skip the bundled download but must ship the browser + its libs.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates tzdata \
      chromium fonts-liberation fonts-noto-color-emoji \
      libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
      libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 \
      libpango-1.0-0 libcairo2 \
    && rm -rf /var/lib/apt/lists/*

ENV TZ=America/New_York
# Use the system chromium above; don't download puppeteer's bundled build.
ENV PUPPETEER_SKIP_DOWNLOAD=1
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

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
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY
ENV NEXT_PUBLIC_TURNSTILE_SITE_KEY=${NEXT_PUBLIC_TURNSTILE_SITE_KEY}
RUN npm run build

# ---- customer /app SPA (app-vite) ----
# app-vite compiles the SAME Next client pages via the '@' alias (→ repo root)
# and is served at /app. `next build` above does NOT build it and its dist is
# gitignored, so build it here — otherwise the customer /app bundle never picks
# up changes to app/**/page.tsx or components/**. vite build uses esbuild (no
# tsc gate). node_modules is dropped after so it doesn't bloat the runtime image.
RUN cd app-vite && npm install --no-audit --no-fund && npm run build && rm -rf node_modules

# ---- runtime ----
FROM base AS runtime
ENV NODE_ENV=production
# server-v2 reads .env.local at boot (override:true). We mount it at runtime
# rather than baking secrets into the image — see docker-compose env_file.
COPY --from=build /app ./
EXPOSE 3001
# Same entrypoint package.json "start" uses. PORT is read from env (default 3001).
CMD ["node", "server-v2/server-with-proxy.js"]
