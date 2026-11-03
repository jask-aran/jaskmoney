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

# The look (after opencode's installer): labels muted, names and versions
# plain, the bar in the app's brand pink.
MUTED='' PINK='' NC=''
[ -t 1 ] && MUTED='\033[2m' PINK='\033[38;2;245;194;231m' NC='\033[0m'
say() { printf "${MUTED}%s${NC} %s\n" "$1" "${2:-}"; }
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
  say "${1:-Installed}" "$BIN/jaskmoney"
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

# Downloads $1 to $2 with a bar on the terminal (stderr), from curl's bytes
# so far against the file's size ($3); quietly anywhere else.
download() {
  if ! [ -t 2 ] || [ -z "$3" ]; then curl -fsSL -o "$2" "$1"; return; fi
  printf '\033[?25l' >&2
  trap "printf '\\033[?25h' >&2" EXIT
  curl -fsSL -o "$2" "$1" & local pid=$! got=0
  while kill -0 "$pid" 2>/dev/null; do
    got=$(stat -c %s "$2" 2>/dev/null || echo 0)
    bar "$got" "$3"
    sleep 0.1
  done
  local status=0
  wait "$pid" || status=$?
  [ "$status" -eq 0 ] && bar "$3" "$3"
  printf '\n\033[?25h' >&2; trap - EXIT
  return "$status"
}
bar() {
  local width=40 percent=$(( $1 * 100 / $2 ))
  local on=$(( percent * width / 100 )) filled empty
  filled=$(printf "%*s" "$on" ""); empty=$(printf "%*s" "$(( width - on ))" "")
  printf "\r${PINK}%s${MUTED}%s${NC} %3d%%  ${MUTED}%s / %s MB${NC}" "${filled// /■}" "${empty// /･}" "$percent" \
    "$(( $1 / 1000000 ))" "$(( $2 / 1000000 ))" >&2
}

# Linux x64: the latest release's binary, gzipped (less than half the size;
# the plain one from a release made before there was one), checked to run,
# then renamed over the old one (a running jaskmoney keeps its file).
if [ -z "${JASKMONEY_FROM_SOURCE:-}" ] && [ "$(uname -s)-$(uname -m)" = "Linux-x86_64" ]; then
  releases="https://github.com/jask-aran/jaskmoney/releases"
  latest="$(curl -fsSI "$releases/latest" | sed -n 's|^[Ll]ocation: .*/tag/v\([0-9.]*\).*|\1|p')"
  [ -n "$latest" ] || fail "couldn't find the latest release at $releases"
  installed="$("$BIN/jaskmoney" --version 2>/dev/null | sed -n 's/^jaskmoney //p' || true)"
  if [ "$installed" = "$latest" ]; then say "Up to date:" "jaskmoney $latest"; exit 0; fi
  if [ -n "$installed" ]; then say "Upgrading jaskmoney" "$installed → $latest"; finished="Upgraded to $latest:"
  else say "Installing jaskmoney" "$latest"; finished="Installed $latest:"; fi
  mkdir -p "$BIN"
  url="$releases/download/v$latest/jaskmoney-linux-x64"
  size() { curl -fsSIL "$1" 2>/dev/null | tr -d '\r' | sed -n 's/^[Cc]ontent-[Ll]ength: //p' | tail -1; }
  if gz="$(size "$url.gz")" && [ -n "$gz" ]; then
    download "$url.gz" "$BIN/jaskmoney.new.gz" "$gz" || fail "the download failed: $url.gz"
    gzip -dc "$BIN/jaskmoney.new.gz" >"$BIN/jaskmoney.new"; rm -f "$BIN/jaskmoney.new.gz"
  else
    download "$url" "$BIN/jaskmoney.new" "$(size "$url")" || fail "the download failed: $url"
  fi
  chmod +x "$BIN/jaskmoney.new"
  if [ "$("$BIN/jaskmoney.new" --version 2>/dev/null)" != "jaskmoney $latest" ]; then
    rm -f "$BIN/jaskmoney.new"; fail "the download doesn't run; nothing was changed"
  fi
  mv -f "$BIN/jaskmoney.new" "$BIN/jaskmoney"
  finish "$finished"
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
