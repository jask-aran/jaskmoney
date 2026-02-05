SHELL := /bin/bash

GOCACHE := $(CURDIR)/.gocache
GOMODCACHE := $(CURDIR)/.gomodcache
GOBIN := $(CURDIR)/bin

export GOCACHE
export GOMODCACHE
export GOBIN

APP := jaskmoney

.PHONY: all
all: build

.PHONY: tools
tools:
	@mkdir -p $(GOBIN)
	@go install github.com/golang-migrate/migrate/v4/cmd/migrate@latest
	@go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest

.PHONY: tidy
tidy:
	@go mod tidy

.PHONY: build
build:
	@go build ./cmd/$(APP)

.PHONY: verify
verify: fmt test build

.PHONY: run
run:
	@go run ./cmd/$(APP)

.PHONY: test
test:
	@go test ./...

.PHONY: fmt
fmt:
	@go fmt ./...

.PHONY: lint
lint:
	@$(GOBIN)/golangci-lint run

DB_PATH ?= $(HOME)/.local/share/jaskmoney/jaskmoney.db
MIGRATIONS_PATH := internal/database/migrations

.PHONY: migrate-up
migrate-up:
	@$(GOBIN)/migrate -path $(MIGRATIONS_PATH) -database sqlite3://$(DB_PATH) up

.PHONY: migrate-down
migrate-down:
	@$(GOBIN)/migrate -path $(MIGRATIONS_PATH) -database sqlite3://$(DB_PATH) down 1
