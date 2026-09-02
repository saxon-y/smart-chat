#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCK_DIR="${TMPDIR:-/tmp}/smart-chat-redeploy.lock"
BACKUP_DIR="${BACKUP_DIR:-$PROJECT_DIR/backups}"
AUTO_PULL="${AUTO_PULL:-1}"
SKIP_BACKUP="${SKIP_BACKUP:-0}"
HEALTH_ATTEMPTS="${HEALTH_ATTEMPTS:-30}"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

fail() {
  log "ERROR: $*"
  exit 1
}

cleanup() {
  rmdir "$LOCK_DIR" 2>/dev/null || true
}

trap cleanup EXIT
trap 'fail "redeploy failed at line $LINENO"' ERR

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  fail "another redeploy is running; lock: $LOCK_DIR"
fi

cd "$PROJECT_DIR"

command -v git >/dev/null 2>&1 || fail "git is not installed"
command -v docker >/dev/null 2>&1 || fail "docker is not installed"
docker compose version >/dev/null 2>&1 || fail "docker compose is unavailable"
test -f .env || fail ".env is missing"

grep -Eq '^POSTGRES_PASSWORD=.+$' .env || fail "POSTGRES_PASSWORD is missing from .env"
for variable in SESSION_SECRET AI_CONFIG_ENCRYPTION_KEY AGENT_WORKER_SECRET; do
  grep -Eq "^${variable}=.{32,}$" .env || fail "${variable} must be at least 32 characters"
done

docker compose config --quiet

if [[ "${DEPLOY_ALLOW_DIRTY:-0}" != "1" ]] && [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  fail "tracked files contain local changes; commit/stash them or set DEPLOY_ALLOW_DIRTY=1"
fi

if [[ "$AUTO_PULL" == "1" ]]; then
  log "pulling latest code"
  git pull --ff-only
fi

log "starting PostgreSQL"
docker compose up -d postgres

if [[ "$SKIP_BACKUP" != "1" ]]; then
  mkdir -p "$BACKUP_DIR"
  backup_file="$BACKUP_DIR/smart-chat-$(date '+%Y%m%d-%H%M%S').sql"
  log "backing up PostgreSQL to $backup_file"
  docker compose exec -T postgres pg_dump -U smart_chat -d smart_chat > "$backup_file"
  test -s "$backup_file" || fail "database backup is empty"
fi

log "building application image"
docker compose build web

log "applying database migrations"
docker compose run --rm web npx prisma migrate deploy

log "recreating web and worker containers"
docker compose --profile worker up -d --force-recreate postgres web worker

log "waiting for local web endpoint"
published_port="$(docker compose port web 3000 | sed -n 's/.*://p' | tail -n 1)"
test -n "$published_port" || fail "web port 3000 is not published to the host"
healthy=0
for ((attempt = 1; attempt <= HEALTH_ATTEMPTS; attempt += 1)); do
  if curl --fail --silent --show-error --head "http://127.0.0.1:${published_port}" >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 2
done

if [[ "$healthy" != "1" ]]; then
  docker compose --profile worker ps
  docker compose logs --tail=100 web
  fail "web did not become healthy after $((HEALTH_ATTEMPTS * 2)) seconds"
fi

running_services="$(docker compose --profile worker ps --status running --services)"
grep -qx 'web' <<<"$running_services" || fail "web container is not running"
grep -qx 'worker' <<<"$running_services" || fail "worker container is not running"
grep -qx 'postgres' <<<"$running_services" || fail "postgres container is not running"

log "redeploy completed"
docker compose --profile worker ps
