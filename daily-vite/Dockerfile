# daily.cbedge.net — build the Vite SPA with Node, serve it with nginx (which
# also reverse-proxies /api to the daily-api container). Two stages so the VPS
# never needs Node/npm on the host — the whole build happens in this image and
# `docker compose build daily-web` reproduces it on every deploy.
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci || npm install
COPY . .
RUN npm run build

FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8086
