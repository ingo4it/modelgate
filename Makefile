.DEFAULT_GOAL := help
SHELL := bash

.PHONY: help
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

.PHONY: setup
setup: ## install, start services, migrate, ingest the sample corpus
	pnpm install
	docker compose up -d
	pnpm prisma migrate deploy
	pnpm ingest ./corpus --corpus default

.PHONY: dev
dev: ## run the API with reload
	pnpm dev

.PHONY: up
up: ## start postgres + redis + grafana
	docker compose up -d

.PHONY: down
down: ## stop services
	docker compose down

.PHONY: eval
eval: ## run the eval suite (offline fixtures)
	pnpm eval

.PHONY: eval-gate
eval-gate: ## run the eval suite as the CI release gate
	pnpm eval --provider fixture --gate

.PHONY: test
test: ## unit tests
	pnpm test

.PHONY: check
check: ## typecheck + lint + tests + eval gate — what CI runs
	pnpm typecheck
	pnpm lint
	pnpm test
	pnpm eval --provider fixture --gate

.PHONY: migrate
migrate: ## apply migrations
	pnpm prisma migrate deploy
