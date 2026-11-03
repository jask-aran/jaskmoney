#!/usr/bin/env bash
# Installs the `jaskmoney` command, on any platform; run it again (or
# `jaskmoney upgrade`) to update.
#
#   curl -fsSL https://raw.githubusercontent.com/jask-aran/jaskmoney/main/scripts/install.sh | bash
#
# On Linux x64 it downloads the latest release's binary. Elsewhere (macOS,
# Linux arm64), or with JASKMONEY_FROM_SOURCE=1, it builds main from source,
# downloaded as a tarball (no git needed), with Bun: yours if it's the tested
# version (package.json) or newer, else it offers to install that version.
# The source is kept in JASKMONEY_SRC (default ~/.local/share/jaskmoney);
# JASKMONEY_BIN (default ~/.local/bin) gets the command. Questions are asked
# on the terminal; with none (CI), every answer is yes.
set -euo pipefail

TARBALL="https://github.com/jask-aran/jaskmoney/archive/refs/heads/main.tar.gz"
SRC="${JASKMONEY_SRC:-$HOME/.local/share/jaskmoney}"
BIN="${JASKMONEY_BIN:-$HOME/.local/bin}"

say() { printf '\033[1m%s\033[0m\n' "$*"; }
fail() { printf 'jaskmoney install: %s\n' "$*" >&2; exit 1; }
command -v curl >/dev/null || fail "needs curl"

# A yes/no question, on the terminal: the script itself is on stdin. Enter is yes.
ask() {
  local answer
  { : </dev/tty; } 2>/dev/null || return 0
  printf '\033[1m%s\033[0m [Y/n] ' "$1" >/dev/tty
  read -r answer </dev/tty || return 0
  case "$answer" in [nN]*) return 1 ;; *) return 0 ;; esac
}

# The startup file of your shell, where PATH is set.
rc_file() {
  case "$(basename "${SHELL:-}")" in
    zsh) echo "${ZDOTDIR:-$HOME}/.zshrc" ;;
    bash) [ "$(uname -s)" = Darwin ] && echo "$HOME/.bash_profile" || echo "$HOME/.bashrc" ;;
    fish) echo "$HOME/.config/fish/config.fish" ;;
    *) echo "$HOME/.profile" ;;
  esac
}

# Offers to put BIN on PATH, then says how to start.
finish() {
  say "Installed $BIN/jaskmoney"
  case ":$PATH:" in *":$BIN:"*) echo "Run: jaskmoney"; return ;; esac
  local rc line
  rc="$(rc_file)"
  case "$rc" in
    *config.fish) line="fish_add_path \"$BIN\"" ;;
    *) line="export PATH=\"$BIN:\$PATH\"" ;;
  esac
  if grep -qsF "$line" "$rc"; then
    echo "Open a new terminal, then run: jaskmoney"
  elif ask "$BIN isn't on your PATH. Add it in $rc?"; then
    mkdir -p "$(dirname "$rc")"
    printf '\n# jaskmoney\n%s\n' "$line" >>"$rc"
    echo "Open a new terminal, then run: jaskmoney (or now: $BIN/jaskmoney)"
  else
    echo "Run: $BIN/jaskmoney (or add $BIN to your PATH)"
  fi
}

# Linux x64: the release binary.
if [ -z "${JASKMONEY_FROM_SOURCE:-}" ] && [ "$(uname -s)-$(uname -m)" = "Linux-x86_64" ]; then
  say "Downloading the latest release"
  mkdir -p "$BIN"
  # Beside it, then renamed over it: a running jaskmoney keeps its file.
  # Gzipped (less than half the size), or the plain binary from a release
  # made before there was one.
  release="https://github.com/jask-aran/jaskmoney/releases/latest/download/jaskmoney-linux-x64"
  if ! curl -fSL --progress-bar "$release.gz" | gzip -dc >"$BIN/jaskmoney.new" 2>/dev/null; then
    curl -fSL --progress-bar -o "$BIN/jaskmoney.new" "$release"
  fi
  chmod +x "$BIN/jaskmoney.new" && mv -f "$BIN/jaskmoney.new" "$BIN/jaskmoney"
  finish
  exit 0
fi

# Anywhere else: build main from source. A fresh copy each time, kept until
# the new one is unpacked.
say "Downloading the source"
mkdir -p "$SRC"
rm -rf "$SRC/repo.new" && mkdir "$SRC/repo.new"
curl -fsSL "$TARBALL" | tar -xz -C "$SRC/repo.new" --strip-components 1
rm -rf "$SRC/repo" && mv "$SRC/repo.new" "$SRC/repo"
cd "$SRC/repo"

# Bun: the tested version (package.json "packageManager") or newer.
need="$(sed -n 's/.*"packageManager": *"bun@\([0-9.]*\)".*/\1/p' package.json)"
[ -n "$need" ] || fail "can't read the Bun version from package.json"
new_enough() { "$1" -e "process.exit(Bun.semver.order(Bun.version, '$need') < 0 ? 1 : 0)" 2>/dev/null; }
BUN="$(command -v bun || true)"
[ -n "$BUN" ] || { [ -x "${BUN_INSTALL:-$HOME/.bun}/bin/bun" ] && BUN="${BUN_INSTALL:-$HOME/.bun}/bin/bun"; } || true
if [ -z "$BUN" ] || ! new_enough "$BUN"; then
  if [ -z "$BUN" ]; then question="Jaskmoney builds with Bun, which isn't installed. Install Bun $need?"
  else question="Jaskmoney needs Bun $need or newer (this is $("$BUN" --version)). Install Bun $need?"; fi
  ask "$question" || fail "needs Bun $need or newer: https://bun.sh"
  command -v unzip >/dev/null || fail "installing Bun needs unzip"
  curl -fsSL https://bun.sh/install | bash -s "bun-v$need"
  BUN="${BUN_INSTALL:-$HOME/.bun}/bin/bun"
  new_enough "$BUN" || fail "Bun didn't install"
fi
export PATH="$(dirname "$BUN"):$PATH"

say "Building"
"$BUN" install --frozen-lockfile --silent
JASKMONEY_BIN="$BIN" JASKMONEY_INSTALLER=1 "$BUN" run scripts/build.ts --install
finish
