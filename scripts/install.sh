#!/usr/bin/env bash
# Installs the `jaskmoney` command, on any platform; run it again (or
# `jaskmoney upgrade`) to update.
#
#   curl -fsSL https://raw.githubusercontent.com/jask-aran/jaskmoney/main/scripts/install.sh | bash
#
# On Linux x64 it downloads the latest release's binary. Elsewhere (macOS,
# Linux arm64), or with JASKMONEY_FROM_SOURCE=1, it builds main from source:
# that needs git and Bun (the tested version in package.json, or newer), and
# keeps the clone in JASKMONEY_SRC (default ~/.local/share/jaskmoney).
# JASKMONEY_BIN (default ~/.local/bin) gets the command.
set -euo pipefail

REPO="${JASKMONEY_REPO:-https://github.com/jask-aran/jaskmoney.git}"
SRC="${JASKMONEY_SRC:-$HOME/.local/share/jaskmoney}"
BIN="${JASKMONEY_BIN:-$HOME/.local/bin}"

say() { printf '\033[1m%s\033[0m\n' "$*"; }
fail() { printf 'jaskmoney install: %s\n' "$*" >&2; exit 1; }

on_path() {
  case ":$PATH:" in
    *":$BIN:"*) echo "Run: jaskmoney" ;;
    *) echo "$BIN isn't on your PATH: add it (e.g. echo 'export PATH=\"$BIN:\$PATH\"' >> ~/.zshrc), then run: jaskmoney" ;;
  esac
}

# Linux x64: the release binary.
if [ -z "${JASKMONEY_FROM_SOURCE:-}" ] && [ "$(uname -s)-$(uname -m)" = "Linux-x86_64" ]; then
  command -v curl >/dev/null || fail "needs curl"
  say "Downloading the latest release"
  mkdir -p "$BIN"
  # Beside it, then renamed over it: a running jaskmoney keeps its file.
  curl -fSL --progress-bar -o "$BIN/jaskmoney.new" "https://github.com/jask-aran/jaskmoney/releases/latest/download/jaskmoney-linux-x64"
  chmod +x "$BIN/jaskmoney.new" && mv -f "$BIN/jaskmoney.new" "$BIN/jaskmoney"
  say "Installed $BIN/jaskmoney"
  on_path
  exit 0
fi

# Anywhere else: build main from source.
command -v git >/dev/null || fail "needs git"

# The source, as main has it: cloned once, then brought up to date.
mkdir -p "$SRC"
if [ -d "$SRC/repo/.git" ]; then
  say "Updating the source"
  git -C "$SRC/repo" fetch --quiet origin main
  git -C "$SRC/repo" checkout --quiet --force -B main FETCH_HEAD
else
  say "Getting the source"
  git clone --quiet --branch main "$REPO" "$SRC/repo"
fi

# Your Bun, if it's the tested version (package.json "packageManager") or newer.
need="$(sed -n 's/.*"packageManager": *"bun@\([0-9.]*\)".*/\1/p' "$SRC/repo/package.json")"
[ -n "$need" ] || fail "can't read the Bun version from package.json"
command -v bun >/dev/null || fail "needs Bun $need or newer: curl -fsSL https://bun.sh/install | bash"
have="$(bun --version)"
[ "$(printf '%s\n%s\n' "$need" "$have" | sort -V | head -n 1)" = "$need" ] \
  || fail "needs Bun $need or newer (this is $have): bun upgrade"

say "Building $(git -C "$SRC/repo" log -1 --format=%h)"
cd "$SRC/repo"
bun install --frozen-lockfile --silent
JASKMONEY_BIN="$BIN" bun run scripts/build.ts --install
