# demo.cbedge.net — static owner-console demo (synthetic data, no backend)
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY dist/index.html /usr/share/nginx/html/index.html
EXPOSE 80
