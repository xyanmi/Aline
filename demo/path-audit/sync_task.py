import json, pathlib
marker = pathlib.Path("sync_marker.txt")
(pathlib.Path("sync_result.json")).write_text(json.dumps({"marker_exists": marker.exists(), "marker_text": marker.read_text(encoding="utf-8") if marker.exists() else None}, ensure_ascii=False, indent=2), encoding="utf-8")
print("sync-audit-ok")
