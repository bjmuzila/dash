# budget.cbedge.net + recipe.cbedge.net backend — /api/hh/* only.
#
# Build context is the REPO ROOT (see docker-compose.yml), but this copies only
# the household files. That is the point: no Next app, no trading routes, no
# ThetaData/TastyTrade code, and no `next build` in the deploy loop. The image is
# a few dozen MB and rebuilds in seconds, so shipping a recipe fix never means
# restarting the trading dashboard.
#
# The whole household stack requires `pg` and node builtins — nothing else. If a
# future household lib pulls in a real dependency, add it to
# deploy/household/package.json, NOT to the repo-root package.json.
FROM node:20-alpine
WORKDIR /app

ENV NODE_ENV=production
ENV TZ=America/New_York

# Its own manifest, so `npm install` here never drags in next/react/puppeteer.
COPY deploy/household/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund

# Explicit file list rather than `COPY server-v2/ ./server-v2/`: the moment this
# image can see the trading modules, someone will require one and the isolation
# is gone without anybody noticing.
COPY server-v2/household-server.js        ./server-v2/
COPY server-v2/household-routes.cjs       ./server-v2/
COPY server-v2/_lib-db.cjs                ./server-v2/
COPY server-v2/_lib-household.cjs         ./server-v2/
COPY server-v2/_lib-household-budget.cjs  ./server-v2/
COPY server-v2/_lib-household-lists.cjs   ./server-v2/
COPY server-v2/_lib-household-projects.cjs ./server-v2/
COPY server-v2/_lib-household-routines.cjs ./server-v2/
COPY server-v2/_lib-household-recipes.cjs ./server-v2/
COPY server-v2/_lib-google-calendar.cjs   ./server-v2/
COPY server-v2/_lib-ics-feeds.cjs         ./server-v2/
# Shipped so the parser tests and the photo backfill can be run against the
# live database with `docker compose exec household ...`.
COPY server-v2/_lib-household-recipes.selftest.js ./server-v2/
COPY server-v2/scripts/backfill-recipe-images.js  ./server-v2/scripts/
COPY server-v2/scripts/backfill-recipe-derived.js   ./server-v2/scripts/
COPY server-v2/scripts/backfill-recipe-photos.js    ./server-v2/scripts/

EXPOSE 3010
CMD ["node", "server-v2/household-server.js"]
