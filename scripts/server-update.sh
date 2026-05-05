#!/bin/sh
set -eu

APP_DIR="${APP_DIR:-/root/liming-course-system}"
BACKUP_DIR="${BACKUP_DIR:-/root/liming-backups}"
DOMAIN="${DOMAIN:-https://www.limingedu.fun}"
EXPECTED_OWNER="${EXPECTED_OWNER:-Qing}"

cd "$APP_DIR"

if [ ! -d .git ]; then
  echo "ERROR: $APP_DIR is not a Git checkout."
  echo "Convert the server directory to a Git checkout before using this updater."
  exit 1
fi

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
REMOTE_BACKUP="$BACKUP_DIR/liming-before-update-$STAMP.sqlite"

echo "== Backup SQLite =="
docker compose exec -T app node -e "const fs=require('fs'); fs.copyFileSync('/app/data/liming-local.sqlite','/app/data/backup-before-update.sqlite')"
docker cp liming-course-app:/app/data/backup-before-update.sqlite "$REMOTE_BACKUP"
ls -lh "$REMOTE_BACKUP"

echo "== Pull latest code =="
git fetch origin main
git merge --ff-only origin/main

echo "== Rebuild containers =="
docker compose up -d --build

echo "== Container status =="
docker compose ps

echo "== HTTPS check =="
curl -fsSI "$DOMAIN" | sed -n '1,8p'

echo "== Database check =="
docker compose exec -T app node -e "const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync('/app/data/liming-local.sqlite'); console.log(db.prepare('select distinct month_key from lessons order by month_key').all()); console.log(db.prepare('select count(*) as lessons from lessons').get()); console.log(db.prepare('select count(*) as students from students').get()); console.log(db.prepare('select count(*) as recharges from recharge_records').get()); console.log(db.prepare(\"select username, display_name, role, status from users where role='owner'\").all());"

echo "== Owner check =="
docker compose exec -T app node -e "const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync('/app/data/liming-local.sqlite'); const row=db.prepare(\"select username from users where role='owner' and status='active' limit 1\").get(); if(!row || row.username !== '$EXPECTED_OWNER'){ console.error('owner mismatch', row); process.exit(1); } console.log('owner ok:', row.username);"

echo "Update complete. Backup: $REMOTE_BACKUP"
