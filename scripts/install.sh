#!/usr/bin/env bash
set -euo pipefail

TARBALL="https://github.com/jask-aran/jaskmoney/archive/refs/heads/main.tar.gz"
SRC="${JASKMONEY_SRC:-$HOME/.local/share/jaskmoney}"
BIN="${JASKMONEY_BIN:-$HOME/.local/bin}"

MUTED='' PINK='' GREEN='' NC=''
[ -t 1 ] && MUTED='\033[2m' PINK='\033[38;2;245;194;231m' GREEN='\033[38;2;166;227;161m' NC='\033[0m'
FRAMES=(◒ ◐ ◓ ◑)
say() { printf "${MUTED}%s${NC} %s\n" "$1" "${2:-}"; }
ok() { local where="${2:-}"; printf "${GREEN}✓${NC} %s ${MUTED}%s${NC}\n" "$1" "${where/#$HOME/\~}"; }
fail() { printf 'jaskmoney install: %s\n' "$*" >&2; exit 1; }
cursor() { [ -t 1 ] && printf "\033[?25$1" || true; }
trap 'cursor h' EXIT

spin() {
  local text=$1 out status=0 i=0; shift
  out="$(mktemp)"
  "$@" >"$out" 2>&1 & local pid=$!
  if [ -t 1 ]; then
    cursor l
    while kill -0 "$pid" 2>/dev/null; do
      printf "\r${PINK}%s${NC} ${MUTED}%s${NC}" "${FRAMES[i++ % 4]}" "$text"; sleep 0.08
    done
    printf '\r\033[2K'; cursor h
  fi
  wait "$pid" || status=$?
  SPUN="$(cat "$out")"; rm -f "$out"
  return "$status"
}
command -v curl >/dev/null || fail "needs curl"

WORDMARK=("  F luF Fu Flu FuluF FuF Fl F Fuu FlF" "FlF FuF lF F F F u F FlF F uF FFl  F ")
mix() { R=$(( $1 + ($4 - $1) * $7 / 1000 )) G=$(( $2 + ($5 - $2) * $7 / 1000 )) B=$(( $3 + ($6 - $3) * $7 / 1000 )); }
wordmark_row() {
  local text=${WORDMARK[$1]} n=${#WORDMARK[0]} x ch glyph d core glow lit
  ROW="  "
  for (( x = 0; x < n; x++ )); do
    ch=${text:x:1}
    case "$ch" in F) glyph=█ ;; u) glyph=▀ ;; l) glyph=▄ ;; *) ROW+=" "; continue ;; esac
    d=$(( x * 1000 - $2 )); d=${d#-}
    core=$(( 1000 - d / 2 )); (( core < 0 )) && core=0
    glow=$(( 1000 - d / 9 )); (( glow < 0 )) && glow=0
    lit=$(( core * 12 / 10 + glow / 4 )); (( lit > 1000 )) && lit=1000
    mix 245 194 231 180 190 254 $(( x * 800 / n + 100 ))
    mix $R $G $B 180 190 254 $(( glow * 6 / 10 ))
    mix $R $G $B 255 255 255 $lit
    ROW+="\033[1;38;2;${R};${G};${B}m$glyph"
  done
  ROW+="\033[0m"
}
wordmark() {
  if ! [ -t 1 ]; then return; fi
  local n=${#WORDMARK[0]} f sweep
  cursor l; echo
  for (( f = 0; f <= 18; f++ )); do
    (( f > 0 )) && printf '\033[2A'
    sweep=$(( f * (n + 24) * 1000 / 18 - 12000 ))
    wordmark_row 0 "$sweep"; printf '%b\n' "$ROW"
    wordmark_row 1 $(( sweep - 2000 )); printf '%b\n' "$ROW"
    sleep 0.04
  done
  echo; cursor h
}

ask() {
  local answer
  { : </dev/tty; } 2>/dev/null || return 0
  printf '\033[1m%s\033[0m [Y/n] ' "$1" >/dev/tty
  read -r answer </dev/tty || return 0
  case "$answer" in [nN]*) return 1 ;; *) return 0 ;; esac
}

rc_file() {
  case "$(basename "${SHELL:-}")" in
    zsh) echo "${ZDOTDIR:-$HOME}/.zshrc" ;;
    bash) [ "$(uname -s)" = Darwin ] && echo "$HOME/.bash_profile" || echo "$HOME/.bashrc" ;;
    fish) echo "$HOME/.config/fish/config.fish" ;;
    *) echo "$HOME/.profile" ;;
  esac
}

finish() {
  ok "${1:-Installed}" "$BIN/jaskmoney"
  how_to_run
  say "Try it on made-up data, with no live connection to Up:" "jaskmoney --demo"
}
how_to_run() {
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

download() {
  if ! [ -t 1 ] || [ -z "$3" ]; then curl -fsSL -o "$2" "$1"; return; fi
  cursor l
  curl -fsSL -o "$2" "$1" & local pid=$! i=0 status=0
  while kill -0 "$pid" 2>/dev/null; do
    bar "${PINK}${FRAMES[i++ % 4]}${NC}" "$(stat -c %s "$2" 2>/dev/null || echo 0)" "$3"
    sleep 0.08
  done
  wait "$pid" || status=$?
  if [ "$status" -eq 0 ]; then bar "${GREEN}✓${NC}" "$3" "$3"; fi
  printf '\n'; cursor h
  return "$status"
}
bar() {
  local width=40 percent=$(( $2 * 100 / $3 ))
  local on=$(( percent * width / 100 )) filled empty
  filled=$(printf "%*s" "$on" ""); empty=$(printf "%*s" "$(( width - on ))" "")
  printf "\r%b ${PINK}%s${MUTED}%s${NC} %3d%%  ${MUTED}%s / %s MB${NC}" "$1" "${filled// /■}" "${empty// /･}" "$percent" \
    "$(( $2 / 1000000 ))" "$(( $3 / 1000000 ))"
}

if [ -z "${JASKMONEY_FROM_SOURCE:-}" ] && [ "$(uname -s)-$(uname -m)" = "Linux-x86_64" ]; then
  wordmark
  releases="https://github.com/jask-aran/jaskmoney/releases"
  installed="$("$BIN/jaskmoney" --version 2>/dev/null | sed -n 's/^jaskmoney //p' || true)"
  spin "Checking for a new release" curl -fsSI "$releases/latest" || fail "couldn't reach $releases"
  latest="$(sed -n 's|^[Ll]ocation: .*/tag/v\([0-9.]*\).*|\1|p' <<<"$SPUN")"
  [ -n "$latest" ] || fail "couldn't find the latest release at $releases"
  if [ "$installed" = "$latest" ] && [ -z "${JASKMONEY_FORCE:-}" ]; then
    ok "jaskmoney $latest is up to date" "$BIN/jaskmoney"
    say "  jaskmoney upgrade --force reinstalls it"
    exit 0
  fi
  if [ "$installed" = "$latest" ]; then say "Reinstalling jaskmoney" "$latest"; finished="Reinstalled $latest"
  elif [ -n "$installed" ]; then say "Upgrading jaskmoney" "$installed → $latest"; finished="Upgraded to $latest"
  else say "Installing jaskmoney" "$latest"; finished="Installed $latest"; fi
  mkdir -p "$BIN"
  url="$releases/download/v$latest/jaskmoney-linux-x64"
  size() { curl -fsSIL "$1" 2>/dev/null | tr -d '\r' | sed -n 's/^[Cc]ontent-[Ll]ength: //p' | tail -1; }
  if gz="$(size "$url.gz")" && [ -n "$gz" ]; then
    download "$url.gz" "$BIN/jaskmoney.new.gz" "$gz" || fail "the download failed: $url.gz"
    spin "Unpacking" sh -c 'gzip -dc "$1.gz" >"$1" && rm -f "$1.gz"' sh "$BIN/jaskmoney.new" || fail "couldn't unpack the download"
  else
    download "$url" "$BIN/jaskmoney.new" "$(size "$url")" || fail "the download failed: $url"
  fi
  chmod +x "$BIN/jaskmoney.new"
  spin "Checking it runs" "$BIN/jaskmoney.new" --version || true
  if [ "$SPUN" != "jaskmoney $latest" ]; then
    rm -f "$BIN/jaskmoney.new"; fail "the download doesn't run; nothing was changed"
  fi
  mv -f "$BIN/jaskmoney.new" "$BIN/jaskmoney"
  finish "$finished"
  exit 0
fi

say "Downloading the source"
mkdir -p "$SRC"
rm -rf "$SRC/repo.new" && mkdir "$SRC/repo.new"
curl -fsSL "$TARBALL" | tar -xz -C "$SRC/repo.new" --strip-components 1
rm -rf "$SRC/repo" && mv "$SRC/repo.new" "$SRC/repo"
cd "$SRC/repo"

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
