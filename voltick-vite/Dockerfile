# voltick.cbedge.net — build the Vite SPA with Node, serve it with nginx (which
# also reverse-proxies /api /proxy /ws to the dashboard container). Two stages so
# the VPS never needs Node/npm on the host: the whole build happens in this
# image, and `docker compose build voltick` reproduces it on every deploy.
#
# Access control is Cloudflare Access in FRONT of this container (one-time-PIN
# policy on an email allowlist), the same way demo.cbedge.net is gated. There is
# no sign-in code in this app. Revoke by removing the email from the policy;
# nothing here needs rebuilding.
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci || npm install
COPY . .
RUN npm run build

FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8088
