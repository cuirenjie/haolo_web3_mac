#!/usr/bin/env python3
"""Resolve the local Haolo image prompt preset before any AIHubCC submission.

This helper is intentionally local-only. It parses the bundled preset index,
writes a small hash-validated check record, and returns the selected preset text
for the agent to merge with the user's literal request.
"""

import argparse
import hashlib
import json
import os
import re
import sys
import time
import uuid
from pathlib import Path


if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")


SKILL_ROOT = Path(__file__).resolve().parent.parent
PRESET_DIR = SKILL_ROOT / "references" / "prompt-presets"
PRESET_INDEX = PRESET_DIR / "index.md"
GENERATION_MARKERS = (
    "生成",
    "画一",
    "绘制",
    "做一张",
    "制作",
    "创建",
    "出一张",
    "一张",
    "generate",
    "draw",
    "create",
    "make",
)
PHOTO_MARKERS = (
    "照片",
    "摄影",
    "写真",
    "实拍",
    "写实",
    "photograph",
    "photo",
    "photorealistic",
)
EDIT_MARKERS = (
    "修复",
    "修改",
    "编辑",
    "替换",
    "移除",
    "去除",
    "换成",
    "增强",
    "提升",
    "放大",
    "上色",
    "补全",
    "抠图",
    "调整",
    "变成",
    "edit",
    "enhance",
    "upscale",
    "colorize",
    "repair",
    "restore",
    "replace",
    "remove",
)


def parse_args():
    parser = argparse.ArgumentParser(description="Resolve a bundled local image prompt preset without network access.")
    request_group = parser.add_mutually_exclusive_group(required=True)
    request_group.add_argument("--request", help="The user's literal image request.")
    request_group.add_argument("--request-file", help="UTF-8 file containing the user's literal image request.")
    parser.add_argument("--preset", help="Explicit preset id, keyword, or .txt filename.")
    parser.add_argument("--output-dir", default="outputs/images", help="Output root used for the hidden check record.")
    parser.add_argument("--check-file", help="Explicit path for the preset check JSON record.")
    return parser.parse_args()


def read_request(args):
    if args.request_file:
        return Path(args.request_file).read_text(encoding="utf-8").strip()
    return str(args.request or "").strip()


def normalized(value):
    return re.sub(r"\s+", "", str(value or "").casefold())


def sha256_text(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 16), b""):
            digest.update(chunk)
    return digest.hexdigest()


def preset_id_from_filename(filename):
    stem = Path(filename).stem
    return stem[:-3] if stem.endswith("提示词") else stem


def load_preset_entries():
    if not PRESET_INDEX.exists():
        raise RuntimeError(f"Bundled preset index is missing: {PRESET_INDEX}")
    entries = []
    in_presets = False
    for order, line in enumerate(PRESET_INDEX.read_text(encoding="utf-8").splitlines()):
        stripped = line.strip()
        if stripped == "## Presets":
            in_presets = True
            continue
        if in_presets and stripped.startswith("## "):
            break
        if not in_presets or not stripped.startswith("-"):
            continue
        tokens = re.findall(r"`([^`]+)`", line)
        if len(tokens) < 2 or not tokens[-1].lower().endswith(".txt"):
            continue
        filename = tokens[-1]
        preset_path = (PRESET_DIR / filename).resolve()
        if preset_path.parent != PRESET_DIR.resolve() or not preset_path.exists():
            raise RuntimeError(f"Preset index points to a missing or unsafe file: {filename}")
        entries.append(
            {
                "id": preset_id_from_filename(filename),
                "filename": filename,
                "keywords": tokens[:-1],
                "path": preset_path,
                "order": order,
            }
        )
    if not entries:
        raise RuntimeError(f"Bundled preset index has no usable entries: {PRESET_INDEX}")
    return entries


def explicit_match(entries, requested):
    needle = normalized(requested)
    if not needle:
        return None
    for entry in entries:
        candidates = [entry["id"], entry["filename"], *entry["keywords"]]
        if any(normalized(candidate) == needle for candidate in candidates):
            return entry, requested, "explicit"
    raise RuntimeError(f"Unknown bundled image prompt preset: {requested}")


def direct_match(entries, request):
    haystack = normalized(request)
    matches = []
    for entry in entries:
        for keyword in entry["keywords"]:
            needle = normalized(keyword)
            if needle and needle in haystack:
                matches.append((len(needle), -entry["order"], entry, keyword))
    if not matches:
        return None
    _, _, entry, keyword = max(matches, key=lambda item: (item[0], item[1]))
    return entry, keyword, "keyword"


def generic_photo_match(entries, request):
    text = str(request or "").casefold()
    is_generation = any(marker in text for marker in GENERATION_MARKERS)
    is_photo = any(marker in text for marker in PHOTO_MARKERS)
    is_edit = any(marker in text for marker in EDIT_MARKERS)
    if not (is_generation and is_photo) or is_edit:
        return None
    for entry in entries:
        if entry["id"] == "真实照片":
            keyword = next((marker for marker in PHOTO_MARKERS if marker in text), "照片")
            return entry, keyword, "generic_photo"
    return None


def choose_preset(entries, request, explicit_preset=None):
    if explicit_preset:
        return explicit_match(entries, explicit_preset)
    return direct_match(entries, request) or generic_photo_match(entries, request)


def atomic_write_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_name(f"{path.name}.tmp-{os.getpid()}-{time.time_ns()}")
    temp_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(temp_path, path)


def check_path_for(args, request_id):
    if args.check_file:
        return Path(args.check_file).expanduser().resolve()
    return (Path(args.output_dir).expanduser().resolve() / ".media-jobs" / f"preset-check-{request_id}.json")


def report_failure(exc):
    print(
        json.dumps(
            {"ok": False, "error_class": "request", "error": str(exc)},
            ensure_ascii=False,
        )
    )
    return 2


def main():
    args = parse_args()
    try:
        request = read_request(args)
        if not request:
            raise RuntimeError("The image request is empty.")
        entries = load_preset_entries()
        selected = choose_preset(entries, request, args.preset)
        request_id = str(uuid.uuid4())
        request_hash = sha256_text(request)
        matched = selected is not None
        if matched:
            entry, matched_keyword, match_type = selected
            preset_text = entry["path"].read_text(encoding="utf-8").strip()
            preset_path = str(entry["path"])
            preset_hash = sha256_file(entry["path"])
            preset_id = entry["id"]
        else:
            matched_keyword = None
            match_type = "none"
            preset_text = ""
            preset_path = None
            preset_hash = None
            preset_id = "none"

        check_file = check_path_for(args, request_id)
        record = {
            "schema_version": 1,
            "request_id": request_id,
            "check_file": str(check_file),
            "preset_checked": True,
            "matched": matched,
            "preset_id": preset_id,
            "preset_path": preset_path,
            "preset_sha256": preset_hash,
            "matched_keyword": matched_keyword,
            "match_type": match_type,
            "request_sha256": request_hash,
            "checked_at_unix": int(time.time()),
        }
        atomic_write_json(check_file, record)
        print(
            json.dumps(
                {
                    "ok": True,
                    **record,
                    "preset_text": preset_text,
                },
                ensure_ascii=False,
            )
        )
        return 0
    except (OSError, ValueError, RuntimeError, json.JSONDecodeError) as exc:
        return report_failure(exc)


if __name__ == "__main__":
    raise SystemExit(main())
