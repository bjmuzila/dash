# affiliate.cbedge.net — build the Vite SPA with Node, serve it with nginx
# (which also reverse-proxies /api to the dashboard container). Two stages so
# the VPS never needs Node/npm on the host — the whole build happens in this
# image and `docker compose build affiliates` reproduces it on every deploy.
#
# Same shape as budget-vite/Dockerfile. No lockfile is committed for this app,
# deliberately: a lockfile resolved on a Windows laptop records win32 builds of
# rollup's optional native binaries and a cold linux install then dies with
# "Cannot find module @rollup/rollup-linux-x64-gnu". See the long note in the
# root Dockerfile.
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8085
