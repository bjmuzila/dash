cd /opt/dashboard && git pull
set -a; . .env.local; set +a
docker compose build --no-cache dashboard
docker compose up -d --force-recreate