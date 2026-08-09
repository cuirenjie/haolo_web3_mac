#!/usr/bin/env python3
"""Dependency-free parser for the small YAML subset used by SKILL.md metadata."""

import json
import re


class FrontmatterError(ValueError):
    """Raised when SKILL.md frontmatter is missing or malformed."""


def parse_frontmatter(content):
    """Return top-level frontmatter fields without requiring PyYAML.

    Codex skill metadata uses simple top-level keys. Nested metadata is retained as
    a dictionary marker because the bundled validators only inspect top-level keys,
    name, and description.
    """
    normalized = str(content or "").replace("\r\n", "\n").replace("\r", "\n")
    if normalized.startswith("\ufeff"):
        raise FrontmatterError("UTF-8 BOM is not allowed before YAML frontmatter")
    match = re.match(r"^---\n(.*?)\n---(?:\n|$)", normalized, re.DOTALL)
    if not match:
        raise FrontmatterError("Invalid frontmatter format")

    lines = match.group(1).split("\n")
    result = {}
    index = 0
    while index < len(lines):
        line = lines[index]
        index += 1
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if line[:1].isspace():
            continue
        field = re.match(r"^([A-Za-z0-9_-]+)\s*:\s*(.*)$", line)
        if not field:
            raise FrontmatterError(f"Invalid top-level frontmatter line: {line}")
        key, raw_value = field.groups()
        if key in result:
            raise FrontmatterError(f"Duplicate frontmatter key: {key}")
        raw_value = raw_value.strip()
        if raw_value in {"|", ">", "|-", ">-", "|+", ">+"}:
            block = []
            while index < len(lines) and (not lines[index].strip() or lines[index][:1].isspace()):
                block.append(lines[index].lstrip())
                index += 1
            separator = "\n" if raw_value.startswith("|") else " "
            result[key] = separator.join(block).strip()
            continue
        result[key] = _parse_scalar(raw_value)
    return result


def _parse_scalar(value):
    if value == "":
        return {}
    if value.startswith('"'):
        try:
            return json.loads(value)
        except json.JSONDecodeError as exc:
            raise FrontmatterError(f"Invalid double-quoted YAML scalar: {exc}") from exc
    if value.startswith("'"):
        if len(value) < 2 or not value.endswith("'"):
            raise FrontmatterError("Invalid single-quoted YAML scalar")
        return value[1:-1].replace("''", "'")
    lowered = value.lower()
    if lowered in {"true", "false"}:
        return lowered == "true"
    if lowered in {"null", "~"}:
        return None
    if re.fullmatch(r"[-+]?\d+(?:\.\d+)?", value):
        return float(value) if "." in value else int(value)
    if value.startswith("[") or value.startswith("{"):
        return [] if value.startswith("[") else {}
    return re.sub(r"\s+#.*$", "", value).rstrip()
