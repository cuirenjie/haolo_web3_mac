#!/usr/bin/env python3
"""Build source-pinned support bundles. Pure stdlib; shared verbatim by the three repositories."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
from urllib.request import Request, urlopen


def article_text(raw):
    main = re.search(r"<main\b[^>]*>([\s\S]*?)</main>", raw, re.I)
    if not main:
        raise ValueError("official help article has no main content")
    body = re.sub(r"<(script|style|nav|video|button)\b[^>]*>[\s\S]*?</\1>", " ", main[1], flags=re.I)
    body = re.sub(r"<[^>]+>", " ", body)
    entities = {"amp":"&", "lt":"<", "gt":">", "quot":'"', "apos":"'", "nbsp":" "}
    def entity(match):
        key = match[1]
        if key.startswith("#x"): return chr(int(key[2:], 16))
        if key.startswith("#"): return chr(int(key[1:]))
        return entities.get(key, match[0])
    body = re.sub(r"&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos|nbsp);", entity, body)
    return re.sub(r"\s+", " ", body).strip()


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def git(root, *args):
    return subprocess.check_output(["git", "-C", str(root), *args], stderr=subprocess.PIPE)


def read(root, path, revision=None):
    parts = PurePosixPath(path).parts
    if not parts or PurePosixPath(path).is_absolute() or ".." in parts or "\\" in path or ":" in path:
        raise ValueError("invalid source path")
    if revision:
        return git(root, "show", revision + ":" + path)
    target = (root / path).resolve()
    if not target.is_relative_to(root.resolve()) or target.is_symlink():
        raise ValueError("source escapes repository")
    return target.read_bytes()


def contract(root, revision=None):
    data = json.loads(read(root, "support/catalog.json", revision))
    assert data["schema_version"] == 1
    assert set(data) == {"schema_version", "repository", "surface", "features"}
    expected = {"windows": "cuirenjie/haolo_windows_web3", "website": "cuirenjie/haolo_front_web3", "mobile": "cuirenjie/haolo_android_web3"}
    assert data["repository"] == expected[data["surface"]]
    if data["surface"] == "website":
        paths = (git(root, "ls-tree", "-r", "--name-only", revision, "--", "youle-ai_index/help").decode().splitlines()
                 if revision else [p.relative_to(root).as_posix() for p in (root / "youle-ai_index/help").glob("*.html")])
        listed = {p for f in data["features"] for p in f["sources"] if f["body"] == "@html-main"}
        for path in sorted(paths):
            if path.endswith(".html") and path not in listed:
                slug = PurePosixPath(path).stem
                data["features"].append(dict(id="help-" + slug, title=slug, body="@html-main", category=slug,
                    locale="zh-CN", status="approved", requires_login=False, platforms=["website"], actions={}, sources=[path]))
    assert 0 < len(data["features"]) <= 500
    ids = set()
    adapters = {"windows": {"open_settings","set_theme","open_usage","open_indicators","set_indicator","open_candle_settings","set_candle_colors"},
                "mobile": {"open_settings","set_theme","open_usage","open_indicators","set_indicator"}, "website": {"web_navigate"}}
    for f in data["features"]:
        assert set(f) == {"id", "title", "body", "category", "locale", "status", "requires_login", "platforms", "actions", "sources"}
        assert f["id"] not in ids and re.fullmatch(r"[a-z][a-z0-9-]{1,79}", f["id"])
        ids.add(f["id"])
        assert f["status"] in {"approved", "pending", "disabled"} and f["sources"]
        assert f["body"].strip() and len(f["body"]) <= 16000 and len(f["title"]) <= 200
        assert f["locale"] in {"zh-CN", "zh-Hant", "en", "ko"}
        platforms = {"android", "ios"} if data["surface"] == "mobile" else {data["surface"]}
        assert f["platforms"] and set(f["platforms"]) <= platforms
        assert all(re.fullmatch(r"[a-z_]+", k) and type(v) is int and v > 0 for k, v in f["actions"].items())
        assert set(f["actions"]) <= adapters[data["surface"]], "new operations require implemented platform adapters"
        if f["body"] == "@html-main":
            assert data["surface"] == "website" and f["sources"][0].startswith("youle-ai_index/help/") and f["sources"][0].endswith(".html")
            f["body"] = article_text(read(root, f["sources"][0], revision).decode("utf-8"))
            assert 0 < len(f["body"]) <= 16000, "help article exceeds one feature; split it explicitly"
    return data


def build(root, revision=None):
    data = contract(root, revision)
    sha = git(root, "rev-parse", revision or "HEAD").decode().strip()
    assert re.fullmatch("[0-9a-f]{40}", sha)
    surface = data["surface"]
    if surface == "windows":
        version = json.loads(read(root, "youle_desktop/package.json", revision))["version"]
    elif surface == "mobile":
        version = re.search(r"(?m)^version:\s*([^\s]+)", read(root, "apps/mobile/pubspec.yaml", revision).decode())[1]
    else:
        version = sha
    sources = sorted({p for f in data["features"] for p in f["sources"]})
    # Canonical Git blobs avoid CRLF differences between Windows builds and Linux CI.
    hashes = {p: hashlib.sha256(read(root, p, revision).replace(b"\r\n", b"\n")).hexdigest() for p in sources}
    return {"schema_version": 1, "repository": data["repository"], "source_sha": sha, "version": version,
            "contract_id": digest(data), "contract": data, "source_hashes": hashes}


def runtime(bundle):
    actions = {}
    for feature in bundle["contract"]["features"]:
        if feature["status"] == "approved":
            for key, version in feature["actions"].items():
                if key in actions and actions[key] != version:
                    raise ValueError("conflicting action versions")
                actions[key] = version
    return {"support_protocol": 2, "contract_id": bundle["contract_id"], "action_versions": actions}


def changes(root, bundle, revision=None):
    """Every push exposes changed feature sources and uncovered files for code review."""
    current = revision or "HEAD"
    try:
        paths = git(root, "diff-tree", "--no-commit-id", "--name-only", "-r", current).decode().splitlines()
    except subprocess.CalledProcessError:
        paths = []
    owners = {p: [f["id"] for f in bundle["contract"]["features"] if p in f["sources"]] for p in paths}
    return {"source_sha": bundle["source_sha"], "contract_id": bundle["contract_id"],
            "changed_sources": [{"path": p, "features": owners[p]} for p in paths],
            "unmapped_sources": [p for p in paths if not owners[p] and p.startswith(("youle_desktop/src/", "apps/mobile/lib/", "packages/chart-web/src/", "youle-ai_index/", "youle_mas-dev/backend/app/"))],
            "pending_features": [f["id"] for f in bundle["contract"]["features"] if f["status"] == "pending"],
            "activation": "Only the matching successful product publication activates approved features."}


def emit(root, bundle, check=False):
    data = runtime(bundle)
    surface = bundle["contract"]["surface"]
    if surface == "windows":
        path = root / "youle_desktop/src/renderer/support-runtime.ts"
        content = "// Generated by tools/support_knowledge.py; edit support/catalog.json.\nexport const supportRuntime = " + json.dumps(data, ensure_ascii=False, indent=2) + " as const;\n"
    elif surface == "mobile":
        path = root / "apps/mobile/lib/features/auth/support_runtime.dart"
        content = "// Generated by tools/support_knowledge.py; edit support/catalog.json.\nconst supportRuntime = <String, Object>" + json.dumps(data, ensure_ascii=False, indent=2) + ";\n"
    else:
        path = root / "youle-ai_index/js/support-runtime.js"
        # The static release builder stamps the exact committed version into this asset.
        data.update(version="development", channel="production")
        content = "// Generated by tools/support_knowledge.py; stamped during publication.\nwindow.HaoloSupportRuntime = " + json.dumps(data, ensure_ascii=False, indent=2) + ";\n"
    if check:
        if not path.is_file() or path.read_text(encoding="utf-8") != content:
            raise ValueError("Support runtime is stale; run tools/support_knowledge.py --emit-runtime")
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8", newline="\n")


def upload(bundle):
    # GitHub OIDC is short lived and restricted to staging. No production API key in CI.
    endpoint = os.environ["ACTIONS_ID_TOKEN_REQUEST_URL"] + "&audience=haolo-support-sync"
    request = Request(endpoint, headers={"Authorization": "Bearer " + os.environ["ACTIONS_ID_TOKEN_REQUEST_TOKEN"]})
    with urlopen(request, timeout=20) as response:
        token = json.load(response)["value"]
    request = Request("https://haolo.com/api/support/sync/candidates", data=canonical(bundle),
                      headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
    with urlopen(request, timeout=30) as response:
        result = json.load(response)
    assert result["status"] == "candidate" and result["activated"] is False
    return result["id"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--commit")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--emit-runtime", action="store_true")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--upload", action="store_true")
    args = parser.parse_args()
    bundle = build(args.repo.resolve(), args.commit)
    if args.emit_runtime or args.check:
        emit(args.repo.resolve(), bundle, check=args.check)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_bytes(canonical(bundle) + b"\n")
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_bytes(canonical(changes(args.repo.resolve(), bundle, args.commit)) + b"\n")
    if args.upload:
        if not args.commit:
            raise ValueError("CI upload requires an immutable --commit")
        upload(bundle)
    print(json.dumps({"id": digest(bundle), "source_sha": bundle["source_sha"], "contract_id": bundle["contract_id"],
                      "features": len(bundle["contract"]["features"]), "status": "candidate"}))


if __name__ == "__main__":
    main()
