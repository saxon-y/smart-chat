#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

test -f .env || { echo "ERROR: .env is missing"; exit 1; }
test -f .deploy/image.env || {
  echo "ERROR: .deploy/image.env is missing; deploy a SHA image with scripts/deploy-image.sh first"
  exit 1
}

exec docker compose \
  --env-file .env \
  --env-file .deploy/image.env \
  -f compose.yaml \
  -f compose.production.yaml \
  "$@"
