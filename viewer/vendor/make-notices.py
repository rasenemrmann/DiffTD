"""Write THIRD-PARTY-NOTICES.md for the packages inside the vendored bundle.

Run by build.sh after esbuild, with the esbuild metafile as first argument.
"""

import glob
import json
import re
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[2]
meta = json.load(open(sys.argv[1]))
names = sorted({m.group(1) for f in meta["inputs"] if (m := re.match(r"node_modules/((?:@[^/]+/)?[^/]+)/", f))})

out = [
    "# Third-party notices",
    "",
    "`isomorphic-git/isomorphic-git.bundle.js` is built from the packages below. Each is distributed under the",
    "license named next to it; the license texts follow. DiffTD's own license is in the repository's `LICENSE`.",
    "",
    "| Package | Version | License |",
    "|---------|---------|---------|",
]
sections = []
for name in names:
    d = root / "node_modules" / name
    pj = json.load(open(d / "package.json"))
    lic = pj.get("license") or ", ".join(x.get("type", "") for x in pj.get("licenses", [])) or "see package"
    out.append(f"| {name} | {pj['version']} | {lic} |")
    files = sorted(glob.glob(str(d / "LICEN[SC]E*")) + glob.glob(str(d / "license*")) + glob.glob(str(d / "COPYING*")))
    notice = sorted(glob.glob(str(d / "NOTICE*")))
    text = ""
    for f in files[:1] + notice[:1]:
        text += Path(f).read_text(encoding="utf-8", errors="replace").strip() + "\n\n"
    if not text:
        author = pj.get("author")
        author = author.get("name") if isinstance(author, dict) else author
        text = f"No license file ships with this package. Its package.json declares the license `{lic}`" + (f" and the author `{author}`." if author else ".") + "\n"
    sections.append(f"## {name} {pj['version']} ({lic})\n\n```text\n{text.strip()}\n```\n")
Path(__file__).with_name("THIRD-PARTY-NOTICES.md").write_text("\n".join(out) + "\n\n" + "\n".join(sections), encoding="utf-8")
print(f"wrote notices for {len(names)} packages")
