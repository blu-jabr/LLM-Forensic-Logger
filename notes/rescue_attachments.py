#!/usr/bin/env python3
# rescue_attachments.py <download-manifest.json> [tree-dir]
# Moves user-initiated CDN downloads onto the round .d/ dirs that recorded
# the same CDN UUID. Semi-manual by design: prints UNRESOLVED rather than
# guessing, and refuses 403-HTML masquerades.
import json, re, shutil, sys
from pathlib import Path

if len(sys.argv) < 2:
    sys.exit("usage: rescue_attachments.py <download-manifest.json> [tree-dir]")
manifest = json.loads(Path(sys.argv[1]).read_text())["downloads"]
tree = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(sys.argv[1]).resolve().parent
uuid_re = re.compile(r"/files/([0-9a-f-]{36})\.\w+", re.I)
by_uuid = {}
for r in manifest:
    m = uuid_re.search(r.get("finalUrl") or r.get("url") or "")
    if m: by_uuid[m.group(1)] = r

for jf in sorted(tree.rglob("flush.*.json")):
    meta = json.loads(jf.read_text()).get("gemini_metadata", {})
    base = jf.with_suffix("")
    ddir = base.parent / (base.name + ".d")
    if not ddir.is_dir(): continue
    urls = [i.get("src", "") for i in meta.get("assets", {}).get("images", [])]
    uuids = {m.group(1) for u in urls if (m := uuid_re.search(u))}
    for att in meta.get("attachments", []):
        target = ddir / att["filename"]
        if target.exists() or att.get("harvested"):
            continue
        rec = next((by_uuid[u] for u in uuids if u in by_uuid), None)
        if not rec:
            print("UNRESOLVED (no matching download):", att["filename"], "→", base.name)
            continue
        if rec.get("mime", "").startswith("text/html") and rec.get("bytes", 0) < 4096:
            print("SKIP (403 page — expired signature):", att["filename"])
            continue
        src = Path(rec["onDisk"])
        if not src.exists():
            print("UNRESOLVED (download missing on disk):", att["filename"])
            continue
        shutil.move(str(src), str(target))
        print("moved", att["filename"], "→", target)
