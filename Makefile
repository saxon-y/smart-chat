SHELL := /bin/sh

COMPOSE := docker compose
WORKER_COMPOSE := $(COMPOSE) --profile worker
RUNTIME_COMPOSE := $(COMPOSE) --profile self-hosted-runtime
BACKUP_DIR ?= backups
BACKUP_FILE ?= $(BACKUP_DIR)/smart-chat-$$(date +%Y%m%d-%H%M%S).sql

.DEFAULT_GOAL := help

.PHONY: help check config build db-up migrate deploy deploy-web redeploy deploy-image rollback-image runtime-up status prod-status logs prod-logs logs-web logs-worker restart stop backup update verify

help:
	@printf '%s\n' \
	  'Smart Chat Docker deployment' \
	  '' \
	  '  make deploy         Build locally, migrate, and start web + legacy worker' \
	  '  make deploy-web     Build locally, migrate, and start web only' \
	  '  make redeploy       Emergency local rebuild; blocked once GHCR image.env exists' \
	  '  make deploy-image   Pull a GHCR SHA image, migrate, and replace containers' \
	  '                      Example: make deploy-image TAG=sha-a1b2c3d4e5f6' \
	  '  make rollback-image Recreate web/worker from .deploy/previous.env' \
	  '  make runtime-up     Start optional self-hosted runtime worker' \
	  '  make update         Alias of make redeploy' \
	  '  make status         Show container status using local Compose' \
	  '  make prod-status    Show container status using GHCR overlay' \
	  '  make logs           Follow web, worker, and PostgreSQL logs' \
	  '  make prod-logs      Follow production GHCR overlay logs' \
	  '  make backup         Write a PostgreSQL dump under backups/' \
	  '  make restart        Restart web and worker containers' \
	  '  make stop           Stop containers without deleting volumes' \
	  '  make verify         Validate Compose and inspect local HTTP endpoint'

check:
	@command -v docker >/dev/null 2>&1 || { echo 'ERROR: docker is not installed'; exit 1; }
	@docker compose version >/dev/null 2>&1 || { echo 'ERROR: docker compose is unavailable'; exit 1; }
	@test -f .env || { echo 'ERROR: .env is missing; run cp .env.example .env and configure production secrets'; exit 1; }
	@grep -Eq '^POSTGRES_PASSWORD=.+$$' .env || { echo 'ERROR: POSTGRES_PASSWORD is missing from .env'; exit 1; }
	@grep -Eq '^PUBLIC_HOST=.+$$' .env || { echo 'ERROR: PUBLIC_HOST is missing from .env'; exit 1; }
	@grep -Eq '^SESSION_SECRET=.{32,}$$' .env || { echo 'ERROR: SESSION_SECRET must be at least 32 characters'; exit 1; }
	@grep -Eq '^AI_CONFIG_ENCRYPTION_KEY=.{32,}$$' .env || { echo 'ERROR: AI_CONFIG_ENCRYPTION_KEY must be at least 32 characters'; exit 1; }
	@grep -Eq '^AGENT_WORKER_SECRET=.{32,}$$' .env || { echo 'ERROR: AGENT_WORKER_SECRET must be at least 32 characters'; exit 1; }

config: check
	@$(COMPOSE) config --quiet
	@echo 'Compose configuration is valid.'

build: config
	$(COMPOSE) build web

db-up: config
	$(COMPOSE) up -d postgres

migrate: db-up build
	$(COMPOSE) run --rm web npx prisma migrate deploy

deploy: migrate
	$(WORKER_COMPOSE) up -d postgres web worker caddy
	@$(MAKE) --no-print-directory status

deploy-web: migrate
	$(COMPOSE) up -d postgres web caddy
	@$(MAKE) --no-print-directory status

redeploy:
	./scripts/redeploy.sh

deploy-image:
	@test -n "$(TAG)" || { echo 'ERROR: TAG is required, e.g. make deploy-image TAG=sha-a1b2c3d4e5f6'; exit 1; }
	./scripts/deploy-image.sh "$(TAG)"

rollback-image:
	@test -f .deploy/previous.env || { echo 'ERROR: .deploy/previous.env is missing; no previous GHCR tag is recorded'; exit 1; }
	@previous_tag="$$(awk -F= '$$1 == "SMART_CHAT_IMAGE_TAG" { print $$2 }' .deploy/previous.env)"; \
	  test -n "$$previous_tag" || { echo 'ERROR: SMART_CHAT_IMAGE_TAG is missing from .deploy/previous.env'; exit 1; }; \
	  echo "Rolling back to $$previous_tag"; \
	  SKIP_MIGRATE=1 ./scripts/deploy-image.sh "$$previous_tag"

runtime-up: config
	@test -n "$${SELF_HOSTED_RUNTIME_EXECUTOR:-}" || grep -Eq '^SELF_HOSTED_RUNTIME_EXECUTOR=.+$$' .env || { echo 'ERROR: SELF_HOSTED_RUNTIME_EXECUTOR is not configured'; exit 1; }
	$(RUNTIME_COMPOSE) up -d runtime-worker

status:
	$(WORKER_COMPOSE) ps

prod-status:
	./scripts/prod-compose.sh --profile worker ps

logs:
	$(WORKER_COMPOSE) logs -f --tail=100 caddy web worker postgres

prod-logs:
	./scripts/prod-compose.sh --profile worker logs -f --tail=100 caddy web worker postgres

logs-web:
	$(COMPOSE) logs -f --tail=100 web

logs-worker:
	$(WORKER_COMPOSE) logs -f --tail=100 worker

restart: check
	$(WORKER_COMPOSE) restart web worker

stop: check
	$(WORKER_COMPOSE) down

backup: db-up
	@mkdir -p "$(BACKUP_DIR)"
	@file="$(BACKUP_FILE)"; $(COMPOSE) exec -T postgres pg_dump -U smart_chat -d smart_chat > "$$file"; echo "Backup written to $$file"

update: check
	./scripts/redeploy.sh

verify: config
	@$(WORKER_COMPOSE) ps
	@curl --fail --silent --show-error --head "http://127.0.0.1:$${APP_PORT:-3000}" >/dev/null
	@echo "Web endpoint is reachable at http://127.0.0.1:$${APP_PORT:-3000}"
