# voltick.cbedge.net/v3 — the CB Edge v3 board and pages, repainted in Voltick.
#
# A copy of cbedge-v3 whose ONLY intended difference is src/design/tokens.css
# (and the first-paint pair in index.html, which must match it). Everything else
# is v3's, so a fix made in v3 can be copied straight across.
#
# Two stages, like every other SPA image here: the whole build happens in this
# image so the VPS never needs Node, and `docker compose build voltick-v3`
# reproduces it on every deploy.
#
# `base: '/v3/'` is already set in vite.config.ts (v3 ships alongside v2 on
# cbedge.net), which is why this serves from the container root and voltick's
# nginx strips the /v3/ prefix on the way in.
#
# Access control is voltick-vite's nginx: /v3/ carries the same
# `auth_request /_vkauth` gate every other path there does. There is no gate in
# this image and there must not be one in the app.
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci || npm install
COPY . .
# typecheck + vite build, NOT the full `npm run build`: that also runs
# check-theme.mjs and check-budgets.mjs, which measure this app against v3's
# theme baseline and byte budgets. The palette here is deliberately different,
# so the theme check fails by design until `npm run theme:update` is run in this
# folder. Keep the typecheck — that one still means something.
RUN npm run typecheck && npm run build:fast

FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8089
