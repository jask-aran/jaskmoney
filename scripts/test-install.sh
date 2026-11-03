#!/usr/bin/env bash
# Runs scripts/install.sh for real into a throwaway folder (its own HOME,
# bin and source, so nothing of yours is touched) and checks what it did.
#
#   scripts/test-install.sh [release|source]
#
# release (Linux x64): a first install of the latest release, then the
# up-to-date line, a forced reinstall, and an upgrade from an older binary.
# source: a build from main's source (as macOS installs), Bun included.
# CI runs both (.github/workflows/installer.yml); the pre-push hook
# (.githooks/pre-push) runs release before a push that changes the installer.
set -euo pipefail

mode="${1:-release}"
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
export HOME="$tmp/home" JASKMONEY_BIN="$tmp/bin" JASKMONEY_SRC="$tmp/src" PATH="$tmp/bin:$PATH"
unset JASKMONEY_FORCE JASKMONEY_FROM_SOURCE
mkdir -p "$HOME"

bash -n "$here/install.sh"

# install [VAR=value…]: the installer, its output kept in $tmp/out.
install() { env "$@" bash "$here/install.sh" </dev/null >"$tmp/out" 2>&1 || { cat "$tmp/out"; fail "the installer failed"; }; }
fail() { printf 'test-install (%s): %s\n' "$mode" "$*" >&2; exit 1; }
says() { grep -qF "$1" "$tmp/out" || { cat "$tmp/out"; fail "expected it to say: $1"; }; }
runs() { [ "$("$JASKMONEY_BIN/jaskmoney" --version)" = "jaskmoney $1" ] || fail "jaskmoney --version isn't $1: $("$JASKMONEY_BIN/jaskmoney" --version 2>&1 || true)"; }

if [ "$mode" = release ]; then
  latest="$(curl -fsSI https://github.com/jask-aran/jaskmoney/releases/latest | sed -n 's|^[Ll]ocation: .*/tag/v\([0-9.]*\).*|\1|p')"
  [ -n "$latest" ] || fail "couldn't find the latest release"

  install; says "Installed $latest"; says "jaskmoney --demo"; runs "$latest"
  echo "✓ first install: $latest"

  before="$(stat -c %Y "$JASKMONEY_BIN/jaskmoney")"
  install; says "jaskmoney $latest is up to date"; runs "$latest"
  [ "$(stat -c %Y "$JASKMONEY_BIN/jaskmoney")" = "$before" ] || fail "up to date, but it changed the binary"
  echo "✓ up to date"

  install JASKMONEY_FORCE=1; says "Reinstalled $latest"; runs "$latest"
  echo "✓ --force reinstalls"

  printf '#!/bin/sh\necho jaskmoney 0.0.1\n' >"$JASKMONEY_BIN/jaskmoney"
  install; says "0.0.1 → $latest"; says "Upgraded to $latest"; runs "$latest"
  echo "✓ upgrade from 0.0.1"
elif [ "$mode" = source ]; then
  install JASKMONEY_FROM_SOURCE=1
  version="$(sed -n 's/.*"version": *"\([0-9.]*\)".*/\1/p' "$JASKMONEY_SRC/repo/package.json")"
  says "Installed"; runs "$version"
  echo "✓ built from source: $version"
else
  fail "unknown mode (release or source)"
fi
