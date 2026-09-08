# demo.cbedge.net — static owner-console demo (synthetic data, no backend)
# Listens on 8087 to match the house pattern (budget-web 8083, affiliate-web 8085, …)
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY dist/index.html /usr/share/nginx/html/index.html
EXPOSE 8087
