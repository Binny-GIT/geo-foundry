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
