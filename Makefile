.PHONY: help build unit-test smoke injection check-no-shell-spawn range-guard container-test verify-import

IMAGE ?= scarf-postgres-exporter:ci
WORKDIR ?= /github/workspace
CONN ?=

help:
	@echo "Available targets:"
	@echo "  build                    Build Docker image ($(IMAGE))"
	@echo "  unit-test               Install deps and run TS unit tests"
	@echo "  smoke                   Smoke test entrypoint (-w $(WORKDIR))"
	@echo "  injection               PSQL conn-string injection safety test"
	@echo "  check-no-shell-spawn    Ensure no spawn('bash') is used"
	@echo "  range-guard             Start PG, seed today, ensure exporter skips"
	@echo "  container-test          Run smoke + injection + range-guard"
	@echo "  verify-import CONN=...  Print count(*) from scarf_events_raw"

build:
	docker build -t $(IMAGE) .

unit-test:
	npm ci
	npm test

smoke:
	bash scripts/smoke_entrypoint.sh "$(IMAGE)" "$(WORKDIR)"

injection:
	bash scripts/test_psql_injection.sh "$(IMAGE)"

check-no-shell-spawn:
	bash scripts/check_no_shell_spawn.sh

range-guard:
	bash scripts/range_guard.sh "$(IMAGE)"

container-test: smoke injection range-guard

verify-import:
	@if [ -z "$(CONN)" ]; then echo "CONN not set. Usage: make verify-import CONN=postgres://..."; exit 2; fi
	bash scripts/verify_import_count.sh "$(CONN)"

