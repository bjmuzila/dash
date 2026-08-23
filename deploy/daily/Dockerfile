# daily.cbedge.net backend — /api/daily/* only.
#
# Build context is the REPO ROOT (see docker-compose.yml), but this copies only
# the daily files. That is the point: no Next app, no trading routes, no
# ThetaData/TastyTrade code, and no `next build` in the deploy loop. The image is
# a few dozen MB and rebuilds in seconds, so shipping a fix to a signup form
# never means restarting the trading dashboard.
#
# The whole daily stack requires `pg` and node builtins — nothing else. Stripe
# and Google are both spoken to over plain `fetch`, deliberately: pulling in two
# SDKs would multiply the image size and the supply-chain surface of the one
# container on this box that a paying stranger's browser can reach. If a future
# daily lib needs a real dependency, add it to deploy/daily/package.json, NOT to
# the repo-root package.json.
FROM node:20-alpine
WORKDIR /app

ENV NODE_ENV=production
ENV TZ=America/New_York

# Its own manifest, so `npm install` here never drags in next/react/puppeteer.
COPY deploy/daily/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund

# Explicit file list rather than `COPY server-v2/ ./server-v2/`: the moment this
# image can see the trading modules, someone will require one and the isolation
# is gone without anybody noticing.
COPY server-v2/daily-server.js          ./server-v2/
COPY server-v2/daily-routes.cjs         ./server-v2/
COPY server-v2/_lib-db.cjs              ./server-v2/
COPY server-v2/_lib-daily.cjs           ./server-v2/
COPY server-v2/_lib-daily-budget.cjs    ./server-v2/
COPY server-v2/_lib-daily-billing.cjs   ./server-v2/
COPY server-v2/_lib-daily-google.cjs    ./server-v2/
COPY server-v2/_lib-daily-markets.cjs   ./server-v2/
COPY server-v2/_lib-daily-mail.cjs      ./server-v2/

EXPOSE 3011
CMD ["node", "server-v2/daily-server.js"]
