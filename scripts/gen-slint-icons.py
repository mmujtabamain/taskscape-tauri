#!/usr/bin/env python3
"""Build the tray's Material Symbols TTF subset for Slint.

Slint embeds fonts at compile time from TTF/OTF (not woff2, unlike the main app's
webview — see subset-icons.py), and renders an icon by its codepoint rather than a
name ligature. So this emits a tiny plain-TTF containing just the glyphs the Slint
capture bar uses, at their PUA codepoints, to tray/assets/MaterialSymbolsSubset.ttf.

It prints each glyph's codepoint too — those are what the Slint `Glyphs` global in
tray/ui/app.slint references (e.g. delete_sweep = \\u{e16c}).

Runs itself inside scripts/.venv (bootstrapping fonttools + brotli on first run),
exactly like subset-icons.py.
"""

import io
import os
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
VENV = ROOT / "scripts" / ".venv"
VENV_PY = VENV / "bin" / "python"

# The icons the Slint capture bar renders (tray/ui/app.slint · Glyphs global).
WANTED = ["delete_sweep", "open_in_new", "screenshot_monitor", "error"]


def _bootstrap_venv() -> None:
    if pathlib.Path(sys.prefix).resolve() == VENV.resolve():
        try:
            import fontTools  # noqa: F401
            import brotli  # noqa: F401

            return
        except ImportError:
            pass
        subprocess.run([sys.executable, "-m", "pip", "install", "--quiet", "--upgrade", "pip"], check=True)
        subprocess.run(
            [sys.executable, "-m", "pip", "install", "--quiet", "fonttools>=4.38", "brotli>=1.1"],
            check=True,
        )
        os.execv(sys.executable, [sys.executable, __file__, *sys.argv[1:]])

    if not VENV_PY.exists():
        subprocess.run([sys.executable, "-m", "venv", str(VENV)], check=True)
    os.execv(str(VENV_PY), [str(VENV_PY), __file__, *sys.argv[1:]])


_bootstrap_venv()

from fontTools.subset import Options, Subsetter  # noqa: E402
from fontTools.ttLib import TTFont  # noqa: E402

SRC = ROOT / "node_modules" / "material-symbols" / "material-symbols-outlined.woff2"
OUT = ROOT / "tray" / "assets" / "MaterialSymbolsSubset.ttf"


def main() -> int:
    if not SRC.exists():
        print(f"[gen-slint-icons] source font missing: {SRC} (run npm install)", file=sys.stderr)
        return 1

    font = TTFont(str(SRC))
    name_to_cp = {gn: cp for cp, gn in font.getBestCmap().items() if gn in WANTED}
    missing = [n for n in WANTED if n not in name_to_cp]
    if missing:
        print(f"[gen-slint-icons] glyphs not in font: {missing}", file=sys.stderr)
        return 1

    opts = Options()
    opts.flavor = None  # plain TTF (Slint can't embed woff2)
    opts.layout_features = []  # direct-codepoint rendering; no ligatures needed
    opts.name_IDs = ["*"]
    opts.notdef_outline = True
    ss = Subsetter(options=opts)
    ss.populate(unicodes=list(name_to_cp.values()))
    ss.subset(font)

    # Rename the family to "MaterialSymbols" so it matches the `Glyphs.font` name
    # referenced in tray/ui/app.slint (the source is "Material Symbols Outlined",
    # which Slint would otherwise fail to resolve → notdef boxes).
    name = font["name"]
    name.removeNames(nameID=16)
    name.removeNames(nameID=17)
    for platform_id, enc_id, lang_id in [(3, 1, 0x409), (1, 0, 0)]:
        name.setName("MaterialSymbols", 1, platform_id, enc_id, lang_id)
        name.setName("Regular", 2, platform_id, enc_id, lang_id)
        name.setName("MaterialSymbols", 4, platform_id, enc_id, lang_id)
        name.setName("MaterialSymbols", 6, platform_id, enc_id, lang_id)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    font.flavor = None
    buf = io.BytesIO()
    font.save(buf)
    OUT.write_bytes(buf.getvalue())

    print(f"[gen-slint-icons] wrote {OUT.relative_to(ROOT)} ({len(buf.getvalue())} bytes)")
    for n in WANTED:
        print(f"  {n} = \\u{{{name_to_cp[n]:04x}}}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
