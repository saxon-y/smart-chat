#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCK_DIR="${TMPDIR:-/tmp}/smart-chat-redeploy.lock"
BACKUP_DIR="${BACKUP_DIR:-$PROJECT_DIR/backups}"
DEPLOY_DIR="$PROJECT_DIR/.deploy"
IMAGE_ENV_FILE="$DEPLOY_DIR/image.env"
PREVIOUS_ENV_FILE="$DEPLOY_DIR/previous.env"
SKIP_BACKUP="${SKIP_BACKUP:-0}"
SKIP_MIGRATE="${SKIP_MIGRATE:-0}"
SKIP_GIT_SYNC="${SKIP_GIT_SYNC:-0}"
SKIP_PUBLIC_HTTPS="${SKIP_PUBLIC_HTTPS:-0}"
HEALTH_ATTEMPTS="${HEALTH_ATTEMPTS:-30}"
SMART_CHAT_IMAGE="${SMART_CHAT_IMAGE:-ghcr.io/saxon-y/smart-chat}"
TARGET_TAG="${1:-}"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

fail() {
  log "ERROR: $*"
  exit 1
}

cleanup() {
  rm -f "$DEPLOY_DIR/image.env.tmp" 2>/dev/null || true
  rmdir "$LOCK_DIR" 2>/dev/null || true
}

trap cleanup EXIT
trap 'fail "deploy-image failed at line $LINENO"' ERR

if [[ -z "$TARGET_TAG" ]]; then
  fail "usage: $0 <image-tag>   example: $0 sha-a1b2c3d4e5f6"
fi

if [[ ! "$TARGET_TAG" =~ ^sha-[0-9a-f]{7,40}$ ]] && [[ ! "$TARGET_TAG" =~ ^v[0-9][A-Za-z0-9._-]*$ ]]; then
  fail "refusing tag '$TARGET_TAG'; production must use sha-<git-sha> or a version tag like v1.2.0"
fi

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  fail "another deploy is running; lock: $LOCK_DIR"
fi

cd "$PROJECT_DIR"
mkdir -p "$DEPLOY_DIR"

command -v git >/dev/null 2>&1 || fail "git is not installed"
command -v docker >/dev/null 2>&1 || fail "docker is not installed"
command -v curl >/dev/null 2>&1 || fail "curl is not installed"
docker compose version >/dev/null 2>&1 || fail "docker compose is unavailable"
test -f .env || fail ".env is missing"
test -f compose.yaml || fail "compose.yaml is missing"
test -f compose.production.yaml || fail "compose.production.yaml is missing"

grep -Eq '^POSTGRES_PASSWORD=.+$' .env || fail "POSTGRES_PASSWORD is missing from .env"
grep -Eq '^PUBLIC_HOST=.+$' .env || fail "PUBLIC_HOST is missing from .env"
for variable in SESSION_SECRET AI_CONFIG_ENCRYPTION_KEY AGENT_WORKER_SECRET; do
  grep -Eq "^${variable}=.{32,}$" .env || fail "${variable} must be at least 32 characters"
done

if [[ "${DEPLOY_ALLOW_DIRTY:-0}" != "1" ]] && [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  fail "tracked files contain local changes; commit/stash them or set DEPLOY_ALLOW_DIRTY=1"
fi

read_env_value() {
  local key="$1"
  local file="$2"
  awk -F= -v key="$key" '$1 == key { sub(/^[^=]+=/, ""); gsub(/^["'\'']|["'\'']$/, ""); print; exit }' "$file"
}

PUBLIC_HOST="$(read_env_value PUBLIC_HOST .env)"
test -n "$PUBLIC_HOST" || fail "PUBLIC_HOST is empty"

CURRENT_TAG=""
if [[ -f "$IMAGE_ENV_FILE" ]]; then
  CURRENT_TAG="$(read_env_value SMART_CHAT_IMAGE_TAG "$IMAGE_ENV_FILE")"
fi

IMAGE_ENV_ACTIVE="$DEPLOY_DIR/image.env.tmp"

compose_target() {
  docker compose \
    --env-file .env \
    --env-file "$IMAGE_ENV_ACTIVE" \
    -f compose.yaml \
    -f compose.production.yaml \
    "$@"
}

write_image_env() {
  local destination="$1"
  local tag="$2"
  local digest="${3:-}"
  cat > "$destination" <<EOF
SMART_CHAT_IMAGE=${SMART_CHAT_IMAGE}
SMART_CHAT_IMAGE_TAG=${tag}
SMART_CHAT_IMAGE_DIGEST=${digest}
EOF
}

if [[ "$SKIP_GIT_SYNC" != "1" ]]; then
  log "syncing git tree to the image tag"
  git fetch origin --tags --prune
  resolved_ref="${TARGET_TAG#sha-}"
  if [[ "$TARGET_TAG" =~ ^v ]]; then
    resolved_ref="$TARGET_TAG"
  fi
  resolved_sha="$(git rev-parse --verify "${resolved_ref}^{commit}")"
  git merge-base --is-ancestor "$resolved_sha" origin/main \
    || fail "commit $resolved_sha is not on origin/main; refusing to deploy"
  git checkout --force -B main "$resolved_sha"
  log "git HEAD is $(git rev-parse --short HEAD) ($resolved_sha)"
fi

log "starting PostgreSQL"
docker compose --env-file .env -f compose.yaml up -d postgres

if [[ "$SKIP_BACKUP" != "1" ]]; then
  mkdir -p "$BACKUP_DIR"
  backup_file="$BACKUP_DIR/smart-chat-$(date '+%Y%m%d-%H%M%S').sql"
  log "backing up PostgreSQL to $backup_file"
  docker compose --env-file .env -f compose.yaml exec -T postgres pg_dump -U smart_chat -d smart_chat > "$backup_file"
  test -s "$backup_file" || fail "database backup is empty"
else
  backup_file=""
fi

write_image_env "$DEPLOY_DIR/image.env.tmp" "$TARGET_TAG"
docker compose --env-file .env --env-file "$DEPLOY_DIR/image.env.tmp" -f compose.yaml -f compose.production.yaml config --quiet

log "pulling ${SMART_CHAT_IMAGE}:${TARGET_TAG}"
compose_target --profile worker pull web worker

digest="$(docker image inspect --format '{{json .RepoDigests}}' "${SMART_CHAT_IMAGE}:${TARGET_TAG}" | sed -n 's/.*sha256:\([0-9a-f]\{64\}\).*/sha256:\1/p' | head -n 1)"
write_image_env "$DEPLOY_DIR/image.env.tmp" "$TARGET_TAG" "$digest"

if [[ "$SKIP_MIGRATE" != "1" ]]; then
  log "applying database migrations with ${TARGET_TAG}"
  compose_target run --rm --no-deps web npx prisma migrate deploy
else
  log "skipping migrations (SKIP_MIGRATE=1)"
fi

if [[ -f "$IMAGE_ENV_FILE" ]]; then
  cp "$IMAGE_ENV_FILE" "$PREVIOUS_ENV_FILE"
fi
mv "$DEPLOY_DIR/image.env.tmp" "$IMAGE_ENV_FILE"
IMAGE_ENV_ACTIVE="$IMAGE_ENV_FILE"

log "recreating web, worker, and caddy from ${TARGET_TAG}"
compose_target --profile worker up -d postgres
compose_target --profile worker up -d --force-recreate --no-deps web worker caddy

if docker compose --env-file .env -f compose.yaml --profile self-hosted-runtime ps --status running --services 2>/dev/null | grep -qx runtime-worker; then
  log "recreating runtime-worker from ${TARGET_TAG}"
  compose_target --profile self-hosted-runtime up -d --force-recreate --no-deps runtime-worker
fi

log "waiting for local web endpoint"
published_port="$(compose_target port web 3000 | sed -n 's/.*://p' | tail -n 1)"
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
  compose_target --profile worker ps
  compose_target logs --tail=100 web
  fail "web did not become healthy after $((HEALTH_ATTEMPTS * 2)) seconds"
fi

log "checking local HTTPS via Caddy"
curl --fail --silent --show-error --head \
  --resolve "${PUBLIC_HOST}:443:127.0.0.1" \
  "https://${PUBLIC_HOST}" >/dev/null \
  || fail "local HTTPS check for ${PUBLIC_HOST} failed"

if [[ "$SKIP_PUBLIC_HTTPS" != "1" ]]; then
  log "checking public HTTPS"
  curl --fail --silent --show-error --head "https://${PUBLIC_HOST}" >/dev/null \
    || fail "public HTTPS check for ${PUBLIC_HOST} failed; set SKIP_PUBLIC_HTTPS=1 only if hairpin NAT blocks it"
fi

running_services="$(compose_target --profile worker ps --status running --services)"
grep -qx 'web' <<<"$running_services" || fail "web container is not running"
grep -qx 'worker' <<<"$running_services" || fail "worker container is not running"
grep -qx 'postgres' <<<"$running_services" || fail "postgres container is not running"
grep -qx 'caddy' <<<"$running_services" || fail "caddy container is not running"

log "checking worker internal API authorization"
compose_target --profile worker exec -T worker node --input-type=module -e '
const secret = process.env.AGENT_WORKER_SECRET;
if (!secret) {
  console.error("AGENT_WORKER_SECRET is missing");
  process.exit(1);
}
const response = await fetch("http://web:3000/api/internal/agent-worker", {
  method: "POST",
  headers: { Authorization: "Bearer " + secret },
});
if (response.status === 401) {
  console.error("worker received 401 from web");
  process.exit(1);
}
if (!response.ok) {
  console.error("worker API returned HTTP " + response.status);
  process.exit(1);
}
' || fail "worker internal API check failed"

release_dir="$DEPLOY_DIR/releases"
mkdir -p "$release_dir"
release_file="$release_dir/$(date '+%Y%m%d-%H%M%S')-${TARGET_TAG}.log"
{
  printf 'deployed_at=%s\n' "$(date -Iseconds)"
  printf 'git_sha=%s\n' "$(git rev-parse HEAD)"
  printf 'previous_tag=%s\n' "${CURRENT_TAG:-none}"
  printf 'target_tag=%s\n' "$TARGET_TAG"
  printf 'image=%s:%s\n' "$SMART_CHAT_IMAGE" "$TARGET_TAG"
  printf 'digest=%s\n' "${digest:-unknown}"
  printf 'backup_file=%s\n' "${backup_file:-skipped}"
  printf 'github_run_url=%s\n' "${DEPLOY_RUN_URL:-}"
  printf 'public_host=%s\n' "$PUBLIC_HOST"
} > "$release_file"

log "deploy-image completed"
log "previous=${CURRENT_TAG:-none} target=${TARGET_TAG} digest=${digest:-unknown}"
log "record=${release_file}"
compose_target --profile worker ps
