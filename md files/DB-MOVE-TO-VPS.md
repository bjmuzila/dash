# Moving Postgres from Render to the VPS

Written 2026-10-06. Scripts are in `db/`, which deploys with the repo like any other file. Everything stateful lives under `/opt/cbedge-db` on the VPS and is never in git: the data, the password, the certificates, dumps and backups.

## What we're moving

- **Render database:** Postgres 18.4, 25 GB in total, of which about 18 GB is indexes. The only extension is `pg_stat_statements`.
- **Biggest tables:**
  - `option_strike_gex_history`: 12 GB (10 GB of that is indexes), about 17M rows
  - `flow_prints`: 7 GB (6.3 GB indexes)
  - `strike_growth`: 2.4 GB
- **Disk:** the VPS has 76 GB free, so the database, a dump and 5 backups all fit.
- **Services that read `DATABASE_URL` from `.env.local`:** `dashboard`, `household`, `daily`. These are the ones the cutover stops and repoints.

## How it's laid out

- **Separate compose project:** Postgres 18 runs in its own project, `cbedge-db` (`db/docker-compose.db.yml`), so app deploys never restart it.
- **Network:** it joins the app's network, `dashboard_default`, so the app reaches it at `cbedge-postgres:5432`. `docker-compose.yml` doesn't change.
- **Ports:** only `127.0.0.1:5433` is published on the host, for running psql on the box.
- **SSL:** on, with a self-signed certificate. The app's pools ask for SSL on any host that isn't localhost, so with SSL on no code changes.
- **Tuning:** set for 7.5 GB of RAM shared with the app: `shared_buffers` 1.5 GB, `effective_cache_size` 4 GB, SSD cost settings, and `pg_stat_statements` preloaded.

## Steps

### 1. Setup (no downtime, any time)

```bash
cd /opt/dashboard && git pull   # or push.ps1 from the laptop
sudo bash db/setup.sh
```

This:
- saves the Render URL to `/opt/cbedge-db/render.url`, used for the move and for rollback
- generates the password and certificates
- starts an empty Postgres
- checks that the dashboard container can reach it

### 2. Rehearsal (no downtime; run outside market hours, because the dump reads all of Render)

```bash
sudo bash db/rehearse.sh
```

This does a full copy into the VPS Postgres (parallel `pg_dump -Fd -j4` then `pg_restore -j4`), then statistics, then exact row counts for every table on both sides.

- **What to look for:** only tables the recorders write all day should differ. Budget, household, user and journal tables must match exactly.
- **Timing:** the total printed is roughly how long the cutover will be down.

### 3. Cutover (pick a weekend or after the close)

```bash
sudo bash db/cutover.sh
```

What it does, in order:

1. Shows who else is connected to Render. Anything that isn't this VPS (another app, the laptop) must be stopped first.
2. Asks you to type `MOVE`.
3. Stops `dashboard`, `household` and `daily`.
4. Copies the database.
5. Compares exact row counts for every table. If any table differs, it aborts and starts the services again on Render, with nothing switched.
6. Backs up `.env.local` to `.env.local.bak-premove-<stamp>`.
7. Points `DATABASE_URL` at `cbedge-postgres` and recreates the three services.
8. Prints the host each service now uses and the counts for the budget and household tables.

Afterwards, open the charts, the budget app and recipes, and check them.

### 4. Backups (same day as the cutover)

```bash
sudo bash db/backup.sh                 # one now
sudo bash db/backup.sh --install       # nightly at 02:30 ET
sudo bash db/backup.sh --restore-test  # prove the newest backup restores
```

- **Local copies:** the newest 5 are kept in `/opt/cbedge-db/backups`.
- **Off-box copies:** you need at least one. A backup on the same disk doesn't survive losing the server. Install `rclone`, configure a Backblaze B2 bucket or a Hetzner Storage Box, and put the remote path in `/opt/cbedge-db/rclone.remote`. Copies there are kept 14 days.

### Rollback (any time while Render still exists)

```bash
sudo bash db/rollback.sh
```

This puts the Render URL back in `.env.local` and recreates the services. Render was never changed. Anything written to the VPS database after the cutover is not copied back.

Leave the Render database running for 1–2 weeks after the cutover before deleting it.

## Things to remember

- **If the main stack is taken down** (`docker compose down`, not `up -d`), its network is recreated. Reattach Postgres afterwards with `docker compose -p cbedge-db -f db/docker-compose.db.yml up -d --force-recreate`.
- **Postgres upgrades are ours now.** A minor version is `docker compose -p cbedge-db -f db/docker-compose.db.yml pull && … up -d`. A major version (19) means dump and restore.
- **Disk:** keep an eye on `df -h /` and `/opt/cbedge-db/backups`.
