#!/bin/sh
set -eu

APP_DIR="${APP_DIR:-/root/liming-course-system}"

echo "== App directory =="
if [ -d "$APP_DIR" ]; then
  echo "$APP_DIR"
  find "$APP_DIR" -maxdepth 2 -mindepth 1 -printf "%M %s %p\n" | sort
else
  echo "MISSING: $APP_DIR"
fi

echo
echo "== Root liming files =="
find /root -maxdepth 1 \( -name "liming*" -o -name "renew-liming-cert.sh" \) -printf "%M %s %p\n" | sort

echo
echo "== Backups =="
find /root/liming-backups "$APP_DIR/data/backups" -maxdepth 1 -type f 2>/dev/null -printf "%TY-%Tm-%Td %TH:%TM %s %p\n" | sort || true

echo
echo "== Docker containers =="
docker ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

echo
echo "== Docker images =="
docker images --format "table {{.Repository}}\t{{.Tag}}\t{{.ID}}\t{{.Size}}"

echo
echo "== Docker volumes =="
docker volume ls

echo
echo "== Certificates =="
find /etc/letsencrypt/live -maxdepth 2 -type l -o -type f 2>/dev/null | sort || true

echo
echo "== Safe cleanup candidates =="
echo "Usually safe after verification:"
echo "  /root/liming-course-system-deploy.tar.gz"
echo "  /root/liming-db*.tar.gz"
echo "  /tmp/liming-local.sqlite"
echo "  /tmp/check.sqlite"
echo "  old backup directories named /root/liming-course-system.pre-* if the current app and data are verified"
echo
echo "Do NOT delete:"
echo "  Docker volumes containing liming_data"
echo "  /etc/letsencrypt"
echo "  /root/liming-backups"
echo "  $APP_DIR"
