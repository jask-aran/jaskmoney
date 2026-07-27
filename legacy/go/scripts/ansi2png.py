#!/usr/bin/env python3
"""Render ANSI-styled terminal output to a PNG image.

Usage:
    python3 scripts/ansi2png.py docs/reference-dashboard-base.ansi out.png

Prefers Meslo Nerd Font Mono when available (Windows Terminal font via WSL
path), otherwise Liberation/DejaVu Mono.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# 16-color ANSI palette (index → RGB) — Catppuccin-ish where it matters
ANSI_COLORS = {
    0: (17, 17, 27),       # Black → crust
    1: (243, 139, 168),    # Red
    2: (166, 227, 161),    # Green
    3: (249, 226, 175),    # Yellow
    4: (137, 180, 250),    # Blue
    5: (203, 166, 247),    # Magenta
    6: (148, 226, 213),    # Cyan
    7: (205, 214, 244),    # White
    8: (108, 112, 134),    # Bright Black
    9: (243, 139, 168),    # Bright Red
    10: (166, 227, 161),   # Bright Green
    11: (249, 226, 175),   # Bright Yellow
    12: (137, 180, 250),   # Bright Blue
    13: (245, 194, 231),   # Bright Magenta
    14: (137, 220, 235),   # Bright Cyan
    15: (205, 214, 244),   # Bright White
}

ANSI_INDEX_MAP = {
    30: 0, 31: 1, 32: 2, 33: 3, 34: 4, 35: 5, 36: 6, 37: 7,
    40: 0, 41: 1, 42: 2, 43: 3, 44: 4, 45: 5, 46: 6, 47: 7,
    90: 8, 91: 9, 92: 10, 93: 11, 94: 12, 95: 13, 96: 14, 97: 15,
    100: 8, 101: 9, 102: 10, 103: 11, 104: 12, 105: 13, 106: 14, 107: 15,
}

# xterm 256-color cube helpers
def _xterm256(n: int) -> tuple[int, int, int]:
    if n < 16:
        return ANSI_COLORS[n]
    if n < 232:
        n -= 16
        r = n // 36
        g = (n % 36) // 6
        b = n % 6
        levels = [0, 95, 135, 175, 215, 255]
        return (levels[r], levels[g], levels[b])
    v = 8 + (n - 232) * 10
    return (v, v, v)


FONT_CANDIDATES = [
    # Windows Terminal Meslo (WSL path)
    "/mnt/c/Users/jaska/AppData/Local/Microsoft/Windows/Fonts/MesloLGLDZNerdFontMono-Regular.ttf",
    "/mnt/c/Users/jaska/AppData/Local/Microsoft/Windows/Fonts/MesloLGSNerdFontMono-Regular.ttf",
    "/mnt/c/Windows/Fonts/meslolglznfmono.ttf",
    # Common Linux installs
    str(Path.home() / ".local/share/fonts/MesloLGS NF Regular.ttf"),
    "/usr/share/fonts/truetype/meslo/MesloLGSNerdFontMono-Regular.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
]


def resolve_font(font_size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in FONT_CANDIDATES:
        try:
            if Path(path).is_file():
                return ImageFont.truetype(path, font_size)
        except (OSError, IOError):
            continue
    return ImageFont.load_default()


def apply_sgr(params: list[int], fg, bg, bold, default_fg, default_bg):
    """Apply a full SGR parameter list (may include 38/48 multi-arg forms)."""
    i = 0
    while i < len(params):
        p = params[i]
        if p == 0:
            fg, bg, bold = default_fg, default_bg, False
            i += 1
        elif p == 1:
            bold = True
            i += 1
        elif p == 22:
            bold = False
            i += 1
        elif p == 39:
            fg = default_fg
            i += 1
        elif p == 49:
            bg = default_bg
            i += 1
        elif p in (38, 48):
            is_fg = p == 38
            if i + 1 >= len(params):
                i += 1
                continue
            mode = params[i + 1]
            if mode == 5 and i + 2 < len(params):
                color = _xterm256(params[i + 2])
                if is_fg:
                    fg = color
                else:
                    bg = color
                i += 3
            elif mode == 2 and i + 4 < len(params):
                color = (params[i + 2], params[i + 3], params[i + 4])
                if is_fg:
                    fg = color
                else:
                    bg = color
                i += 5
            else:
                i += 1
        elif 30 <= p <= 37 or 90 <= p <= 97:
            fg = ANSI_COLORS[ANSI_INDEX_MAP[p]]
            i += 1
        elif 40 <= p <= 47 or 100 <= p <= 107:
            bg = ANSI_COLORS[ANSI_INDEX_MAP[p]]
            i += 1
        elif p == 7:  # reverse
            fg, bg = bg, fg
            i += 1
        else:
            i += 1
    return fg, bg, bold


def render_ansi_to_png(
    ansi_path: Path,
    png_path: Path,
    font_size: int = 14,
    cell_width: int = 9,
    cell_height: int = 18,
    force_cols: int | None = None,
    force_rows: int | None = None,
):
    raw = ansi_path.read_text(encoding="utf-8", errors="replace")
    # Keep ALL lines — status bar + footer are often space-padded with bg only.
    # rstrip only a single trailing empty split artifact from final newline.
    raw_lines = raw.split("\n")
    if raw_lines and raw_lines[-1] == "":
        raw_lines = raw_lines[:-1]

    strip_pattern = re.compile(r"\x1b\[[0-9;]*[a-zA-Z]")
    max_visible = 0
    for line in raw_lines:
        visible = strip_pattern.sub("", line).rstrip("\r")
        # Use east-asian-width-ish length: treat each codepoint as 1 cell
        # (braille/box-drawing are single-width in our TUI).
        max_visible = max(max_visible, len(visible))

    cols = force_cols if force_cols else max(max_visible, 1)
    rows = force_rows if force_rows else max(len(raw_lines), 1)

    default_fg = (205, 214, 244)
    default_bg = (30, 30, 46)

    img_width = cols * cell_width
    img_height = rows * cell_height
    img = Image.new("RGB", (img_width, img_height), default_bg)
    draw = ImageDraw.Draw(img)
    font = resolve_font(font_size)

    ansi_pattern = re.compile(r"\x1b\[([0-9;]*)m")

    for y, line in enumerate(raw_lines[:rows]):
        line = line.rstrip("\r")
        fg = default_fg
        bg = default_bg
        bold = False
        x = 0
        pos = 0

        # Pre-fill the whole row with default bg so short lines still paint.
        draw.rectangle(
            [0, y * cell_height, img_width - 1, (y + 1) * cell_height - 1],
            fill=default_bg,
        )

        while pos < len(line) and x < cols:
            m = ansi_pattern.match(line, pos)
            if m:
                params_str = m.group(1)
                pos = m.end()
                if params_str == "" or params_str == "0":
                    fg, bg, bold = default_fg, default_bg, False
                else:
                    params = [int(p) for p in params_str.split(";") if p != ""]
                    fg, bg, bold = apply_sgr(params, fg, bg, bold, default_fg, default_bg)
                continue

            char = line[pos]
            pos += 1
            if char == "\n":
                continue

            px = x * cell_width
            py = y * cell_height
            draw.rectangle([px, py, px + cell_width - 1, py + cell_height - 1], fill=bg)

            if char != " ":
                actual_fg = fg
                if bold:
                    actual_fg = tuple(min(255, c + 30) for c in fg)
                try:
                    draw.text((px + 1, py + 1), char, fill=actual_fg, font=font)
                except Exception:
                    pass
            x += 1

        # If the line ended while a non-default bg is active (common for
        # lipgloss Width()-padded status/footer), extend that bg to the edge.
        if bg != default_bg and x < cols:
            px = x * cell_width
            py = y * cell_height
            draw.rectangle(
                [px, py, img_width - 1, py + cell_height - 1],
                fill=bg,
            )

    img.save(png_path)
    font_name = getattr(font, "path", "default")
    if isinstance(font_name, (bytes, bytearray)):
        font_name = font_name.decode()
    print(f"  {png_path.name}: {img_width}x{img_height}  font={Path(str(font_name)).name}")


def main():
    if len(sys.argv) < 3:
        print(f"Usage: {sys.argv[0]} <input.ansi> <output.png> [cols] [rows]")
        sys.exit(1)
    ansi_path = Path(sys.argv[1])
    png_path = Path(sys.argv[2])
    cols = int(sys.argv[3]) if len(sys.argv) > 3 else None
    rows = int(sys.argv[4]) if len(sys.argv) > 4 else None
    if not ansi_path.exists():
        print(f"ERROR: {ansi_path} not found")
        sys.exit(1)
    render_ansi_to_png(ansi_path, png_path, force_cols=cols, force_rows=rows)


if __name__ == "__main__":
    main()
