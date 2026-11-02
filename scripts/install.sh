#!/usr/bin/env bash
# Builds Jaskmoney from source and installs the `jaskmoney` command: the way
# to install on macOS (and any Linux). Run it again to update.
#
#   curl -fsSL https://raw.githubusercontent.com/jask-aran/jaskmoney/main/scripts/install.sh | bash
#
# It needs git and Bun (the tested version in package.json, or newer).
# JASKMONEY_SRC (default ~/.local/share/jaskmoney) holds the source;
# JASKMONEY_BIN (default ~/.local/bin) gets the command; JASKMONEY_REF builds a
# branch or tag instead of the latest release.
set -euo pipefail

REPO="${JASKMONEY_REPO:-https://github.com/jask-aran/jaskmoney.git}"
SRC="${JASKMONEY_SRC:-$HOME/.local/share/jaskmoney}"
BIN="${JASKMONEY_BIN:-$HOME/.local/bin}"

say() { printf '\033[1m%s\033[0m\n' "$*"; }
fail() { printf 'jaskmoney install: %s\n' "$*" >&2; exit 1; }

command -v git >/dev/null || fail "needs git"

# The source: cloned once, then fetched.
mkdir -p "$SRC"
if [ -d "$SRC/repo/.git" ]; then
  say "Updating the source"
  git -C "$SRC/repo" fetch --quiet --tags --force origin
else
  say "Getting the source"
  git clone --quiet "$REPO" "$SRC/repo"
fi
ref="${JASKMONEY_REF:-$(git -C "$SRC/repo" tag --list 'v*' --sort=-v:refname | head -n 1)}"
[ -n "$ref" ] || ref=origin/main
git -C "$SRC/repo" -c advice.detachedHead=false checkout --quiet --force "$ref" 2>/dev/null \
  || git -C "$SRC/repo" -c advice.detachedHead=false checkout --quiet --force "origin/$ref"

# Your Bun, if it's the tested version (package.json "packageManager") or newer.
need="$(sed -n 's/.*"packageManager": *"bun@\([0-9.]*\)".*/\1/p' "$SRC/repo/package.json")"
[ -n "$need" ] || fail "can't read the Bun version from package.json"
command -v bun >/dev/null || fail "needs Bun $need or newer: curl -fsSL https://bun.sh/install | bash"
have="$(bun --version)"
[ "$(printf '%s\n%s\n' "$need" "$have" | sort -V | head -n 1)" = "$need" ] \
  || fail "needs Bun $need or newer (this is $have): bun upgrade"

say "Building $ref"
cd "$SRC/repo"
bun install --frozen-lockfile --silent
JASKMONEY_BIN="$BIN" bun run scripts/build.ts --install
