#!/usr/bin/env bash
set -euo pipefail

mode="${1:-fast}"
export XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-/tmp/jaskmoney-xdg-config}"
mkdir -p "$XDG_CONFIG_HOME"
export GOCACHE="${GOCACHE:-/tmp/jaskmoney-go-cache}"
mkdir -p "$GOCACHE"

case "$mode" in
  fast)
    echo "[test] running fast suite"
    go test ./...
    ;;
  heavy)
    echo "[test] running heavy flow suite"
    go test -tags flowheavy ./...
    ;;
  all)
    echo "[test] running fast suite"
    go test ./...
    echo "[test] running heavy flow suite"
    go test -tags flowheavy ./...
    ;;
  *)
    echo "usage: $0 [fast|heavy|all]" >&2
    exit 2
    ;;
esac
