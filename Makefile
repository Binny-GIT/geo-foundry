SHELL := /bin/sh

EXPECTED_NODE_MAJOR ?= 24
EXPECTED_PNPM_VERSION := 11.22.0
ACTUAL_NODE_MAJOR := $(shell node -p "process.versions.node.split('.')[0]")
ACTUAL_PNPM_VERSION := $(shell pnpm --version)

ifneq ($(ACTUAL_NODE_MAJOR),$(EXPECTED_NODE_MAJOR))
$(error NODE_VERSION_MISMATCH expected=$(EXPECTED_NODE_MAJOR) actual=$(ACTUAL_NODE_MAJOR))
endif

ifneq ($(ACTUAL_PNPM_VERSION),$(EXPECTED_PNPM_VERSION))
$(error PNPM_VERSION_MISMATCH expected=$(EXPECTED_PNPM_VERSION) actual=$(ACTUAL_PNPM_VERSION))
endif

.PHONY: check-toolchain

check-toolchain:
	@printf '%s\n' "NODE_MAJOR=$(ACTUAL_NODE_MAJOR)"
	@printf '%s\n' "PNPM_VERSION=$(ACTUAL_PNPM_VERSION)"
	@pnpm exec node --test tooling/toolchain.test.mjs

# ---- 语义化容器命令（共享开发服务器构建与容器标准） ----
# 凭据经 /opt/geo-foundry/mk-dev.env（mode 600）注入，不进入仓库或镜像。
MK_DEV_ENV ?= /opt/geo-foundry/mk-dev.env
COMPOSE_MK_DEV := docker compose --env-file $(MK_DEV_ENV) -f deploy/compose.yaml -f deploy/compose.mk-dev.yaml
COMPOSE_VERIFY := docker compose --env-file deploy/smoke/verify.env -f deploy/compose.yaml -f deploy/compose.verify.yaml

.PHONY: image-build container-smoke deploy-mk-dev rollback-mk-dev runtime-status verify-backup-restore worker-smoke worker-business-smoke

image-build:
	@bash deploy/image-build-mkdev.sh

container-smoke:
	@set -eu; \
	bash deploy/image-build-mkdev.sh mk-dev-verify; \
	credentials_dir=$$(mktemp -d /tmp/geo-foundry-verify-credentials-XXXXXXXX); \
	trap 'GEO_FOUNDRY_CREDENTIALS_DIR="$$credentials_dir" $(COMPOSE_VERIFY) down >/dev/null 2>&1 || true; bash deploy/smoke/prepare-verify-credentials.sh cleanup "$$credentials_dir"' EXIT; \
	bash deploy/smoke/prepare-verify-credentials.sh create "$$credentials_dir"; \
	GEO_FOUNDRY_CREDENTIALS_DIR="$$credentials_dir" $(COMPOSE_VERIFY) config -q; \
	GEO_FOUNDRY_CREDENTIALS_DIR="$$credentials_dir" $(COMPOSE_VERIFY) up -d --no-build --wait --wait-timeout 120; \
	curl -4 -s -m 20 http://127.0.0.1:3090/api/health | grep -q '"status":"alive"'; \
	echo "container smoke passed"

deploy-mk-dev:
	@$(COMPOSE_MK_DEV) config -q
	@$(COMPOSE_MK_DEV) up -d --no-build --wait --wait-timeout 120
	@deploy/smoke/smoke.sh

rollback-mk-dev:
	@$(COMPOSE_MK_DEV) config -q
	@$(COMPOSE_MK_DEV) up -d --no-build --wait --wait-timeout 120
	@deploy/smoke/smoke.sh

runtime-status:
	@deploy/smoke/runtime-status.sh

worker-smoke:
	@deploy/smoke/worker-smoke.sh

worker-business-smoke:
	@deploy/smoke/worker-business-smoke.sh

verify-backup-restore:
	@deploy/smoke/verify-backup-restore.sh
