import json, pathlib
root = pathlib.Path(".")
files = sorted(str(p.relative_to(root)) for p in root.rglob("*") if p.is_file())
(pathlib.Path("path_result.json")).write_text(json.dumps({"files": files}, ensure_ascii=False, indent=2), encoding="utf-8")
print("path-audit-ok")
