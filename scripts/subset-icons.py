#!/usr/bin/env python3
"""Build a per-app subset of the Material Symbols icon font.

The full `material-symbols-outlined.woff2` is ~3.8 MB — every one of its ~3600
icons. Each app uses only a few dozen, so shipping the whole thing is the single
biggest drag on cold-boot (the webview downloads and parses multiple megabytes
before icons can paint). This script scans an app's source for the icon names it
actually references and emits a tiny subset font (tens of KB) containing just
those glyphs.

It produces one font per app (main + tray), since their icon sets differ. Wired
to run before Vite via each app's `predev` / `prebuild` npm hook, so the subset
is always current; it self-skips when nothing changed.

Subsetting note: Material Symbols renders an icon from its *name* via an OpenType
ligature (`<span>settings</span>` → the gear glyph), and each glyph is named for
its icon. A plain `pyftsubset --text=...` does NOT shrink the font: once the
subset contains every letter (which any real icon set does), ligature closure
re-adds every icon. So we instead prune the GSUB ligature table down to the
wanted names first, then subset — keeping name→icon rendering intact.

Runs itself inside a local venv (`scripts/.venv`) so no global packages are
touched; it bootstraps fonttools + brotli on first run.
"""

import os
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
VENV = ROOT / "scripts" / ".venv"
VENV_PY = VENV / "bin" / "python"


def _bootstrap_venv() -> None:
    """Re-exec inside scripts/.venv, creating it and installing deps on first run."""
    if pathlib.Path(sys.prefix).resolve() == VENV.resolve():
        try:
            import fontTools  # noqa: F401
            import brotli  # noqa: F401

            return
        except ImportError:
            pass  # deps missing — install below, then re-exec
        subprocess.run(
            [sys.executable, "-m", "pip", "install", "--quiet", "--upgrade", "pip"],
            check=True,
        )
        subprocess.run(
            [sys.executable, "-m", "pip", "install", "--quiet", "fonttools>=4.38", "brotli>=1.1"],
            check=True,
        )
        os.execv(sys.executable, [sys.executable, __file__, *sys.argv[1:]])

    if not VENV_PY.exists():
        print(f"[subset-icons] creating venv at {VENV.relative_to(ROOT)}")
        subprocess.run([sys.executable, "-m", "venv", str(VENV)], check=True)
    os.execv(str(VENV_PY), [str(VENV_PY), __file__, *sys.argv[1:]])


_bootstrap_venv()

# --- inside the venv from here on ---
from fontTools.subset import Options, Subsetter  # noqa: E402
from fontTools.ttLib import TTFont  # noqa: E402

SRC_FONT = ROOT / "node_modules" / "material-symbols" / "material-symbols-outlined.woff2"

# Each app's subset covers its own source plus the shared UI library (whose
# components — the editor toolbar, file-kind icons — it also renders).
# Only the main app has a webview frontend that needs a woff2 icon subset. The
# tray is now a standalone Slint app; its icon glyphs are baked into a TTF subset
# committed at tray/assets/MaterialSymbolsSubset.ttf (see scripts/gen-slint-icons.py).
APPS = {
    "main": {
        "scan": ["main/src", "common-ui/src"],
        "out": "main/src/assets/fonts/material-symbols-subset.woff2",
    },
}

# Any pure snake_case quoted string is a candidate icon name; we intersect with
# the font's real icon names below, so non-icon strings fall away harmlessly.
# Over-including is safe (a spare glyph); missing one would render as raw text.
NAME_LITERAL = re.compile(r"""['"`]([a-z][a-z0-9_]+)['"`]""")


def scan_candidate_names(dirs: list[str]) -> set[str]:
    names: set[str] = set()
    for d in dirs:
        base = ROOT / d
        for f in list(base.rglob("*.ts")) + list(base.rglob("*.tsx")):
            names.update(NAME_LITERAL.findall(f.read_text(encoding="utf-8")))
    return names


def source_files(dirs: list[str]) -> list[pathlib.Path]:
    out: list[pathlib.Path] = []
    for d in dirs:
        base = ROOT / d
        out += list(base.rglob("*.ts")) + list(base.rglob("*.tsx"))
    return out


def _unwrap(subtable):
    return subtable.ExtSubTable if subtable.__class__.__name__ == "ExtensionSubst" else subtable


def build_font(wanted: set[str]) -> tuple[bytes, int]:
    """Prune the ligature table to `wanted`, subset, return (woff2 bytes, glyph count)."""
    font = TTFont(str(SRC_FONT))
    glyph_to_char = {gn: chr(cp) for cp, gn in font.getBestCmap().items()}

    for lookup in font["GSUB"].table.LookupList.Lookup:
        for subtable in lookup.SubTable:
            st = _unwrap(subtable)
            if st.__class__.__name__ != "LigatureSubst":
                continue
            for first, ligs in list(st.ligatures.items()):
                st.ligatures[first] = [
                    lig
                    for lig in ligs
                    if "".join(glyph_to_char.get(g, "\x00") for g in [first, *lig.Component])
                    in wanted
                ]

    options = Options()
    options.flavor = "woff2"
    options.layout_features = ["*"]  # keep `liga` so name→icon still renders
    options.name_IDs = ["*"]
    options.notdef_outline = True
    subsetter = Subsetter(options=options)
    # The ligature inputs are the letters/digits/underscore of the wanted names.
    subsetter.populate(text="".join(sorted({c for n in wanted for c in n})))
    subsetter.subset(font)

    import io

    buf = io.BytesIO()
    font.save(buf)
    return buf.getvalue(), len(font.getGlyphOrder())


def is_stale(out_path: pathlib.Path, inputs: list[pathlib.Path]) -> bool:
    if not out_path.exists():
        return True
    out_mtime = out_path.stat().st_mtime
    newest_in = max(p.stat().st_mtime for p in inputs if p.exists())
    return newest_in > out_mtime


def real_icon_names(font: TTFont) -> set[str]:
    glyph_to_char = {gn: chr(cp) for cp, gn in font.getBestCmap().items()}
    names: set[str] = set()
    for lookup in font["GSUB"].table.LookupList.Lookup:
        for subtable in lookup.SubTable:
            st = _unwrap(subtable)
            if st.__class__.__name__ != "LigatureSubst":
                continue
            for first, ligs in st.ligatures.items():
                for lig in ligs:
                    names.add("".join(glyph_to_char.get(g, "\x00") for g in [first, *lig.Component]))
    return names


def main() -> int:
    if not SRC_FONT.exists():
        print(f"[subset-icons] source font missing: {SRC_FONT} (run npm install)", file=sys.stderr)
        return 1

    which = [a for a in sys.argv[1:] if a in APPS] or list(APPS)
    real_names = real_icon_names(TTFont(str(SRC_FONT)))

    for app in which:
        cfg = APPS[app]
        out_path = ROOT / cfg["out"]
        inputs = source_files(cfg["scan"]) + [SRC_FONT, pathlib.Path(__file__)]
        if not is_stale(out_path, inputs):
            print(f"[subset-icons] {app}: up to date ({out_path.stat().st_size // 1024} KB)")
            continue

        wanted = scan_candidate_names(cfg["scan"]) & real_names
        data, glyphs = build_font(wanted)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(data)
        print(f"[subset-icons] {app}: {len(wanted)} icons → {len(data) // 1024} KB ({glyphs} glyphs)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
