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

# ---- pkg ----
# push.ps1 writes a new "version" into package.json on EVERY push (vMonth.Day.N).
# Copying package.json straight into the deps stage meant that one-line change
# invalidated the npm install layer every single deploy - a full ~150s reinstall
# of identical dependencies. This stage strips the "version" fields (from
# package.json and package-lock.json) so the deps layer below only rebuilds when
# a dependency actually changes. The real package.json (with the version, which
# next.config.js inlines as NEXT_PUBLIC_APP_VERSION) still arrives via COPY . .
# in the build stage, so the version shown in the app is unaffected.
FROM base AS pkg
COPY package.json package-lock.json* ./
RUN node -e "const fs=require('fs');\
const strip=(f,lock)=>{if(!fs.existsSync(f))return;const j=JSON.parse(fs.readFileSync(f,'utf8'));\
delete j.version;if(lock&&j.packages&&j.packages[''])delete j.packages[''].version;\
fs.writeFileSync(f,JSON.stringify(j,null,2)+'\\n');};\
strip('package.json',false);strip('package-lock.json',true);"

# ---- deps ----
FROM base AS deps
COPY --from=pkg /app/package.json /app/package-lock.json* ./
# Use `npm install` directly. A Windows-generated package-lock.json does not always
# satisfy `npm ci` on Linux (platform-specific resolution, e.g. picomatch 2.3.2 vs
# 4.0.4) - that mismatch is harmless but `npm ci` errors loudly on it. `npm install`
# resolves correctly for this platform every time, so the build is clean and quiet.
#
# --mount=type=cache keeps npm's download cache on the VPS between builds (it is
# NOT baked into the image), so when deps DO change only the changed packages are
# fetched. Same mount on every npm install below.
RUN --mount=type=cache,target=/root/.npm \
    npm install --no-audit --no-fund

# ---- v3 ----
# Dashboard v3 (cbedge-v3) — the blank-slate rebuild, served at /v3 and gated to
# owner-only in middleware.ts.
#
# Built in its OWN stage (v3) from only cbedge-v3/, so BuildKit runs it in
# parallel with the Next build and reuses it from cache whenever cbedge-v3/ did
# not change. It used to sit after COPY . . in the build stage, which forced a
# full npm install + vite build of v3 on every push, even pushes that never
# touched it. cbedge-v3 is self-contained (its '@' alias points at ./src and
# deploy/vela/Dockerfile already builds it with only cbedge-v3/ copied in).
# The result lands in /out/v3; the build stage copies it into public/v3 only
# when the build succeeded.
#
# NOTE: build:fast, NOT build. `npm run build` in cbedge-v3 also runs the brotli
# budget check, which is meant to fail a COMMIT, not a deploy — an over-budget v3
# bundle must never be able to block a v2 hotfix from reaching the VPS. Run
# `npm run check` on the laptop before pushing; that is where budgets are enforced.
#
# check:theme IS run here, though, and deliberately — it is the one gate that
# catches a push made without building first. It reads files and matches regexes:
# no browser, no typecheck, no brotli, about a second. A theme violation joins the
# other failure modes below and costs the deploy /v3, not the site.
#
# PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: cbedge-v3 carries `playwright` as a devDep for
# scripts/ws-scope-check.mjs (a laptop-only test). `npm install` runs its
# postinstall, which downloads ~150MB of Chromium — inside a deploy that is at
# best wasted minutes and at worst a failed build on a slow or restricted network.
# The image never runs that test, so skip the download. Same reasoning as
# PUPPETEER_SKIP_DOWNLOAD at the top of this file.
#
# THIS STEP IS DELIBERATELY NON-FATAL. v3 is a pre-alpha side app, gated to
# owner-only, that no customer can reach. It must never be able to stop a v2
# hotfix from reaching the VPS — the same lesson docker-compose.yml records about
# theta-terminal on 2026-08-18, where an unrelated container's failure took the
# whole site down. If v3 fails to build, the deploy continues and /v3 simply
# 404s until it is fixed.
#
# `set -ux` (no -e) so a failure lands in the else branch instead of aborting.
# The echoed commands are what makes the real npm/vite error legible in the
# build log; without them BuildKit collapses the step to "exit code: 1".
# `rm -f package-lock.json`: the lockfile is regenerated on Brandon's WINDOWS
# laptop whenever he runs npm install there, and push.ps1 commits it. A
# Windows-resolved lockfile records the win32 builds of the native binaries that
# rollup and @tailwindcss/oxide ship as OPTIONAL platform packages — and npm then
# skips their linux-x64 counterparts on a cold install. The install "succeeds",
# then `vite build` dies immediately with "Cannot find module
# @rollup/rollup-linux-x64-gnu".
#
# It only bites cold, inside the image: a warm node_modules on the VPS host has
# the right binaries already, which is why the same commands pass when run by
# hand there. app-vite dodges this by shipping no lockfile at all; deleting it
# here gives cbedge-v3 the same behaviour without touching the laptop's copy.
# The root Dockerfile comment above records the same Windows-lockfile problem.
FROM base AS v3
WORKDIR /app
COPY cbedge-v3/ ./cbedge-v3/
RUN --mount=type=cache,target=/root/.npm \
    set -ux; mkdir -p /out; \
    if ls -la cbedge-v3/package.json \
       && cd cbedge-v3 \
       && rm -f package-lock.json \
       && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --no-audit --no-fund \
       && npm run check:theme \
       && npm run build:fast; then \
      cp -r /app/cbedge-v3/dist /out/v3 && ls /out/v3; \
      echo "cbedge-v3: built OK -> public/v3"; \
    else \
      cd /app; \
      echo "##############################################################"; \
      echo "## cbedge-v3 BUILD FAILED - deploying WITHOUT /v3.          ##"; \
      echo "## v2 is unaffected. /v3 will 404 until this is fixed.      ##"; \
      echo "## The real error is in the output directly above this box. ##"; \
      echo "##############################################################"; \
    fi

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
# .next/cache is a BuildKit cache mount: Next reuses compiled modules from the
# previous deploy instead of starting cold. It lives on the VPS, not in the image
# (Next recreates .next/cache at runtime if it needs one).
RUN --mount=type=cache,target=/app/.next/cache \
    npm run build
# Build the Vite SPA (app-vite) fresh every deploy and replace public/app with
# it. WITHOUT this step, public/app serves whatever stale Vite bundle happens to
# be committed — new routes added to app-vite/src/App.tsx (e.g. /test,
# /strike-history) silently never appear and fall through the SPA catch-all to
# /traders-dashboard. This step is the permanent fix; do not remove it.
# (app-vite compiles the Next pages via its '@' -> repo-root alias, so unlike
# cbedge-v3 it cannot be split into its own stage; it needs the full source.)
RUN --mount=type=cache,target=/root/.npm \
    cd app-vite && npm install --no-audit --no-fund && npm run build
# Drop app-vite/node_modules once dist is copied: nothing reads it at runtime and
# it would otherwise be copied into the runtime image on every deploy.
RUN rm -rf public/app && cp -r app-vite/dist public/app && rm -rf app-vite/node_modules
# Dashboard v3: take the v3 stage's output if it built (see the v3 stage above).
COPY --from=v3 /out/ /tmp/v3out/
RUN if [ -d /tmp/v3out/v3 ]; then rm -rf public/v3 && cp -r /tmp/v3out/v3 public/v3; fi; rm -rf /tmp/v3out

# ---- runtime ----
FROM base AS runtime
ENV NODE_ENV=production
# server-v2 reads .env.local at boot (override:true). We mount it at runtime
# rather than baking secrets into the image — see docker-compose env_file.
COPY --from=build /app ./
EXPOSE 3001
# Same entrypoint package.json "start" uses. PORT is read from env (default 3001).
CMD ["node", "server-v2/server-with-proxy.js"]
