#!/usr/bin/env python3
import argparse
import base64
import hashlib
import http.client
import io
import json
import mimetypes
import os
import re
import shutil
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

try:
    import tomllib
except ModuleNotFoundError:
    tomllib = None

try:
    import resolve_prompt_preset as local_preset_resolver
except ModuleNotFoundError:
    local_preset_resolver = None


DEFAULT_HAOLO_BASE_URL = "https://haolo.pro/v1"
DEFAULT_MODEL = "aihubcc/gpt-image-2"
GPT_IMAGE_BASE_MODEL = DEFAULT_MODEL
GPT_IMAGE_1K_MODEL = "gpt-image-2-1k"
GPT_IMAGE_1K_ASYNC_UPSTREAM_MODEL = "gpt-image-2-1k-async"
GPT_IMAGE_ASYNC_MODELS = {GPT_IMAGE_1K_MODEL, "gpt-image-2-2k", "gpt-image-2-3.5k"}
BUMING_IMAGE2_MODEL = "image2"
GPT_IMAGE_FALLBACK_CHAIN = (
    GPT_IMAGE_BASE_MODEL,
    GPT_IMAGE_1K_MODEL,
    "gpt-image-2-2k",
    "gpt-image-2-3.5k",
)
GPT_IMAGE_TIER_MODELS = {*GPT_IMAGE_ASYNC_MODELS}
MULTI_REFERENCE_MODELS = {BUMING_IMAGE2_MODEL, *GPT_IMAGE_TIER_MODELS}
DIRECTOR_IMAGE_MODELS = {GPT_IMAGE_BASE_MODEL, BUMING_IMAGE2_MODEL, *GPT_IMAGE_TIER_MODELS}
GPT_IMAGE_REFERENCE_MAX_COUNT = 6
GPT_IMAGE_REFERENCE_MAX_BYTES = 5 * 1024 * 1024
GPT_IMAGE_BASE_MAX_EDGE = 2048
GPT_IMAGE_ALLOWED_MIME_TYPES = {"image/jpeg", "image/png", "image/webp"}
PUBLIC_MODEL_ALIASES = {
    DEFAULT_MODEL: DEFAULT_MODEL,
    "gpt-image-2": DEFAULT_MODEL,
    "buming/gpt-image-2": DEFAULT_MODEL,
    "lingke/gpt-image-2": DEFAULT_MODEL,
    "image-2-1k": GPT_IMAGE_1K_MODEL,
    "aihubcc/gpt-image-2-1k": GPT_IMAGE_1K_MODEL,
    GPT_IMAGE_1K_ASYNC_UPSTREAM_MODEL: GPT_IMAGE_1K_MODEL,
    f"aihubcc/{GPT_IMAGE_1K_ASYNC_UPSTREAM_MODEL}": GPT_IMAGE_1K_MODEL,
}
LOCALAPPDATA = Path(os.environ["LOCALAPPDATA"]) if os.environ.get("LOCALAPPDATA") else Path.home() / "AppData" / "Local"
APPDATA = Path(os.environ["APPDATA"]) if os.environ.get("APPDATA") else Path.home() / "AppData" / "Roaming"
DEFAULT_HAOLO_CONFIG_DIR = LOCALAPPDATA / "Programs" / "haolo_desktop" / "resources" / "default-haolo-ai"
DEFAULT_HAOLO_AI_HOME = APPDATA / "haolo_desktop" / "haolo-ai-home"
BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)
EXT_BY_MIME = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
}
EXPLICIT_TIMEOUT_HTTP_STATUS = {408, 504, 524}
CURL_STATUS_MARKER = "\n__HAOLO_HTTP_STATUS__:"
TERMINAL_FAILURE = {
    "failed",
    "error",
    "cancelled",
    "canceled",
    "expired",
    "timeout",
    "timed_out",
    "timed-out",
    "deadline_exceeded",
}
GPT_IMAGE_BASE_SIZE_CHOICES = {
    "auto",
    "1024x1024",
    "1536x1024",
    "1024x1536",
}
GPT_IMAGE_1K_SIZE_CHOICES = {
    "1024x1024",
    "1536x1024",
    "1024x1536",
}
IMAGE_SIZE_CHOICES = sorted(GPT_IMAGE_BASE_SIZE_CHOICES)
ASPECT_RATIO_CHOICES = [
    "auto",
    "1:1",
    "16:9",
    "9:16",
    "4:3",
    "3:4",
    "3:2",
    "2:3",
    "5:4",
    "4:5",
]
STRICT_EDIT_PROMPT_PREFIX = (
    "STRICT LOCAL EDIT CONTRACT: Treat the supplied reference image as the authoritative "
    "source canvas. Preserve every visual property that the user's request does not explicitly "
    "ask to change, including identity, subject count, positions, poses, expressions, clothing, "
    "objects, background, composition, crop, camera viewpoint, lighting, color, texture, grain, "
    "and era. Modify only the explicitly requested regions. Do not recreate, reinterpret, "
    "restage, beautify, or replace the scene."
)
REFERENCE_EDIT_PROMPT_PREFIX = (
    "REFERENCE-GUIDED EDIT CONTRACT: Use the supplied reference image as the primary source. "
    "Apply only the user's requested change and preserve identity, subject count, positions, poses, "
    "expressions, objects, background, composition, crop, camera viewpoint, lighting, texture, and "
    "era as closely as the reference-generation model permits. Do not intentionally restage or "
    "replace unaffected content."
)


class MediaTaskPendingError(RuntimeError):
    pass


class MediaTaskTerminalError(RuntimeError):
    def __init__(self, message, response_payload=None, machine_error=None):
        super().__init__(message)
        self.response_payload = response_payload
        self.machine_error = machine_error or extract_machine_error(response_payload)


class RelayHTTPError(RuntimeError):
    def __init__(self, status, body, url=None, headers=None):
        self.status = int(status)
        self.body = str(body or "")
        self.url = url
        try:
            payload = json.loads(self.body)
        except (TypeError, ValueError):
            payload = None
        self.response_payload = payload if isinstance(payload, dict) else None
        self.machine_error = extract_machine_error(self.response_payload, headers)
        location = f" from {url}" if url else ""
        super().__init__(f"HTTP {self.status}{location}: {self.body[:4000]}")


class RequestContractError(RuntimeError):
    pass


class TransportError(RuntimeError):
    pass


def first_non_empty(*values):
    for value in values:
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return None


def optional_int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def optional_bool(value):
    if isinstance(value, bool):
        return value
    lowered = str(value or "").strip().lower()
    if lowered in {"true", "1", "yes"}:
        return True
    if lowered in {"false", "0", "no"}:
        return False
    return None


def header_value(headers, name):
    if headers is None:
        return None
    try:
        return headers.get(name)
    except (AttributeError, KeyError, TypeError):
        return None


def extract_machine_error(payload=None, headers=None):
    payload = payload if isinstance(payload, dict) else {}
    error = payload.get("error")
    source = error if isinstance(error, dict) else payload
    machine_error = {
        "code": first_non_empty(
            source.get("code"),
            header_value(headers, "X-Haolo-Error-Code"),
        ),
        "category": first_non_empty(
            source.get("category"),
            header_value(headers, "X-Haolo-Error-Category"),
        ),
        "retryable": optional_bool(
            source.get("retryable")
            if source.get("retryable") is not None
            else header_value(headers, "X-Haolo-Retryable")
        ),
        "retry_after_ms": optional_int(
            source.get("retry_after_ms")
            if source.get("retry_after_ms") is not None
            else header_value(headers, "X-Haolo-Retry-After-Ms")
        ),
        "request_id": first_non_empty(
            source.get("request_id"),
            header_value(headers, "X-Client-Request-Id"),
        ),
        "upstream_status": optional_int(
            source.get("upstream_status")
            if source.get("upstream_status") is not None
            else header_value(headers, "X-Haolo-Upstream-Status")
        ),
        "route_exhausted": optional_bool(
            source.get("route_exhausted")
            if source.get("route_exhausted") is not None
            else header_value(headers, "X-Haolo-Route-Exhausted")
        ),
    }
    return machine_error if any(value is not None for value in machine_error.values()) else None


def machine_error_from_exception(exc):
    machine_error = getattr(exc, "machine_error", None)
    if isinstance(machine_error, dict):
        return machine_error
    return extract_machine_error(getattr(exc, "response_payload", None))


def machine_error_from_text(value):
    text = str(value or "")
    decoder = json.JSONDecoder()
    for index, character in enumerate(text):
        if character != "{":
            continue
        try:
            payload, _ = decoder.raw_decode(text[index:])
        except json.JSONDecodeError:
            continue
        machine_error = extract_machine_error(payload)
        if machine_error:
            return machine_error
    return None


def normalize_public_model(model):
    clean = str(model or "").strip()
    return PUBLIC_MODEL_ALIASES.get(clean.lower(), clean or DEFAULT_MODEL)


def fallback_models_after(model):
    try:
        index = GPT_IMAGE_FALLBACK_CHAIN.index(model)
    except ValueError:
        return []
    return list(GPT_IMAGE_FALLBACK_CHAIN[index + 1 :])


def is_explicit_terminal_timeout(exc):
    lowered = str(exc or "").lower()
    return any(
        token in lowered
        for token in (
            "'timeout'",
            "'timed_out'",
            "'timed-out'",
            "'deadline_exceeded'",
            '"timeout"',
            '"timed_out"',
            '"timed-out"',
            '"deadline_exceeded"',
        )
    )


def is_authoritative_retryable_route_exhaustion(exc):
    machine_error = machine_error_from_exception(exc) or {}
    status = getattr(exc, "status", None)
    upstream_status = machine_error.get("upstream_status")
    return bool(
        str(machine_error.get("code") or "").upper() == "UPSTREAM_TEMPORARILY_UNAVAILABLE"
        and machine_error.get("retryable") is True
        and machine_error.get("route_exhausted") is True
        and (
            status in {408, 425, 429}
            or (isinstance(status, int) and 500 <= status < 600)
            or upstream_status in {408, 425, 429}
            or (isinstance(upstream_status, int) and 500 <= upstream_status < 600)
        )
    )


def is_authoritative_pre_provider_route_failure(exc):
    """Return true only when the relay proves no provider task was created."""
    machine_error = machine_error_from_exception(exc) or {}
    status = optional_int(getattr(exc, "status", None))
    return bool(
        status == 503
        and str(machine_error.get("code") or "").upper()
        == "SERVICE_TEMPORARILY_UNAVAILABLE"
        and str(machine_error.get("category") or "").lower() == "transport"
        and machine_error.get("retryable") is True
        and machine_error.get("route_exhausted") is False
        and optional_int(machine_error.get("upstream_status")) == 0
    )


def is_media_catalog_policy_mismatch(exc, model):
    if model == BUMING_IMAGE2_MODEL or optional_int(getattr(exc, "status", None)) != 403:
        return False
    machine_error = machine_error_from_exception(exc) or {}
    body = str(getattr(exc, "body", "") or "").replace('\\"', '"')
    return bool(
        str(machine_error.get("code") or "").upper() == "PERMISSION_DENIED"
        and str(machine_error.get("category") or "").lower() == "policy"
        and machine_error.get("retryable") is False
        and machine_error.get("route_exhausted") is False
        and optional_int(machine_error.get("upstream_status")) == 0
        and f'model "{model}" is not enabled for' in body
    )


def migrate_gateway_url(value, *, preserve_query=False):
    clean = str(value or "").strip().rstrip("/")
    try:
        url = urllib.parse.urlsplit(clean)
        ports = {"aiapi.youleai.top": {None, 80, 443}, "8.216.5.161": {None, 80, 443, 8080}, "54.235.242.62": {None, 80, 3000}, "haolo.pro": {None, 80, 443}}
        if url.scheme not in {"http", "https"} or url.username or url.password or (url.query and not preserve_query) or url.fragment:
            return clean
        if url.hostname not in ports or url.port not in ports[url.hostname]:
            return clean
        return urllib.parse.urlunsplit(("https", "haolo.pro", url.path.rstrip("/") or "/v1", url.query, ""))
    except ValueError:
        return clean


def normalized_haolo_base_url(base_url):
    clean = migrate_gateway_url(base_url)
    if not clean:
        return None
    lowered = clean.lower()
    if lowered == "https://haolo.pro":
        return DEFAULT_HAOLO_BASE_URL
    for suffix in (
        "/images/generations",
        "/images/edits",
        "/videos/generations",
        "/videos",
    ):
        if lowered.endswith(suffix):
            return clean[: -len(suffix)]
    return clean


def normalize_base_url(base_url):
    return normalized_haolo_base_url(base_url) or DEFAULT_HAOLO_BASE_URL


def images_endpoint(base_url):
    return f"{normalize_base_url(base_url)}/images/generations"


def image_edits_endpoint(base_url):
    return f"{normalize_base_url(base_url)}/images/edits"


def video_generation_endpoint(base_url):
    # GPT-Image async tiers use the provider-compatible task API directly.
    return f"{normalize_base_url(base_url)}/videos"


def normalized_haolo_api_url(api_url):
    clean = migrate_gateway_url(api_url)
    if not clean:
        return None
    lowered = clean.lower()
    if lowered in {"https://haolo.pro", "https://haolo.pro/v1"}:
        return images_endpoint(DEFAULT_HAOLO_BASE_URL)
    if lowered.endswith("/images/generations"):
        return clean
    return clean


def base_url_from_api_url(api_url):
    clean = str(api_url or "").strip().rstrip("/")
    lowered = clean.lower()
    for suffix in (
        "/images/generations",
        "/images/edits",
        "/videos/generations",
        "/videos",
    ):
        if lowered.endswith(suffix):
            return clean[: -len(suffix)]
    return normalize_base_url(clean)


def status_url(base_url, task_id):
    query = urllib.parse.urlencode({"task_id": str(task_id)})
    return f"{normalize_base_url(base_url)}/media/status?{query}"


def documented_status_url(base_url, model, task_id):
    if model in GPT_IMAGE_ASYNC_MODELS:
        encoded_task_id = urllib.parse.quote(str(task_id), safe="")
        return f"{normalize_base_url(base_url)}/videos/{encoded_task_id}"
    return status_url(base_url, task_id)


def status_url_template(base_url, model):
    if model in GPT_IMAGE_ASYNC_MODELS:
        return f"{normalize_base_url(base_url)}/videos/<TASK_ID>"
    return f"{normalize_base_url(base_url)}/media/status?task_id=<TASK_ID>"


def load_toml(path):
    if not path.exists():
        return {}
    if tomllib is not None:
        with path.open("rb") as handle:
            return tomllib.load(handle)

    # Minimal fallback for simple key = "value" files.
    data = {}
    section = data
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("[") and line.endswith("]"):
            section = data
            for part in line.strip("[]").split("."):
                section = section.setdefault(part, {})
            continue
        if "=" in line:
            key, value = line.split("=", 1)
            section[key.strip()] = value.strip().strip('"').strip("'")
    return data


def discover_haolo_config_dirs():
    candidates = []
    if os.environ.get("HAOLO_AI_CONFIG_DIR"):
        candidates.append(Path(os.environ["HAOLO_AI_CONFIG_DIR"]))
    if os.environ.get("HAOLO_AI_HOME"):
        candidates.append(Path(os.environ["HAOLO_AI_HOME"]))

    candidates.extend([DEFAULT_HAOLO_CONFIG_DIR, DEFAULT_HAOLO_AI_HOME])

    # When installed under a Haolo AI home, infer that home from:
    # <haolo-ai-home>/skills/.system/imagegen/scripts/this_file.py
    for parent in Path(__file__).resolve().parents:
        if parent.name == "skills":
            candidates.append(parent.parent)
            break

    unique = []
    seen = set()
    for candidate in candidates:
        resolved = candidate.expanduser()
        key = str(resolved).lower()
        if key not in seen:
            seen.add(key)
            unique.append(resolved)
    return unique


def select_provider(config):
    provider_name = (
        config.get("model_provider")
        or config.get("default_model_provider")
        or config.get("provider")
    )
    providers = config.get("model_providers", {})
    if provider_name and isinstance(providers, dict):
        return providers.get(provider_name, {}) or {}
    if isinstance(providers, dict) and len(providers) == 1:
        return next(iter(providers.values())) or {}
    return {}


def load_json_object(path_value):
    if not path_value:
        return {}
    try:
        value = json.loads(Path(path_value).read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError, TypeError):
        return {}


def media_model_credential(auth, model, capability="image_generation"):
    credentials_file = load_json_object(
        os.environ.get("HAOLO_MODEL_CREDENTIALS_FILE")
    )
    roots = (
        credentials_file.get("HAOLO_MEDIA_MODEL_CREDENTIALS"),
        auth.get("HAOLO_MEDIA_MODEL_CREDENTIALS"),
    )
    for root in roots:
        if not isinstance(root, dict):
            continue
        capability_credentials = root.get(capability)
        if not isinstance(capability_credentials, dict):
            continue
        credential = capability_credentials.get(model)
        if not isinstance(credential, dict):
            normalized_model = normalize_public_model(model)
            credential = next(
                (
                    candidate
                    for credential_model, candidate in capability_credentials.items()
                    if normalize_public_model(credential_model) == normalized_model
                    and isinstance(candidate, dict)
                ),
                None,
            )
        if not isinstance(credential, dict):
            continue
        api_key = str(credential.get("api_key") or "").strip()
        base_url = normalized_haolo_base_url(credential.get("base_url"))
        if api_key:
            return {
                "api_key": api_key,
                "base_url": base_url,
                "credential_source": "haolo_business_model_pool",
            }
    return {}


def load_haolo_defaults(model=None):
    config_dirs = discover_haolo_config_dirs()
    selected = config_dirs[0] if config_dirs else DEFAULT_HAOLO_CONFIG_DIR
    config = {}
    auth = {}

    for config_dir in config_dirs:
        candidate_config = load_toml(config_dir / "config.toml")
        candidate_auth_path = config_dir / "auth.json"
        candidate_auth = {}
        if candidate_auth_path.exists():
            candidate_auth = json.loads(candidate_auth_path.read_text(encoding="utf-8"))

        provider = select_provider(candidate_config)
        has_runtime_data = bool(provider.get("base_url") or candidate_auth)
        if has_runtime_data or (config_dir / "config.toml").exists():
            selected = config_dir
            config = candidate_config
            auth = candidate_auth
            if has_runtime_data:
                break

    provider = select_provider(config)
    model_credential = media_model_credential(auth, model) if model else {}
    if model == BUMING_IMAGE2_MODEL:
        base_url = normalized_haolo_base_url(
            os.environ.get("OPENAI_BASE_URL")
            or auth.get("OPENAI_BASE_URL")
            or provider.get("base_url")
        )
        api_key = os.environ.get("OPENAI_API_KEY") or auth.get("OPENAI_API_KEY")
        return {
            "config_dir": str(selected),
            "config_candidates": [str(path) for path in config_dirs],
            "base_url": base_url,
            "env_key": "OPENAI_API_KEY",
            "api_key": api_key,
            "credential_source": (
                "environment:OPENAI_API_KEY"
                if os.environ.get("OPENAI_API_KEY")
                else "haolo_auth_json:OPENAI_API_KEY"
                if auth.get("OPENAI_API_KEY")
                else None
            ),
        }
    auth_base_url = normalized_haolo_base_url(
        os.environ.get("LLMHUB_BASE_URL")
        or auth.get("LLMHUB_BASE_URL")
        or model_credential.get("base_url")
        or os.environ.get("SUB2API_BASE_URL")
        or auth.get("SUB2API_BASE_URL")
        or os.environ.get("TRANSIT_BASE_URL")
        or auth.get("TRANSIT_BASE_URL")
        or os.environ.get("MODEL_BASE_URL")
        or auth.get("MODEL_BASE_URL")
        or auth.get("OPENAI_BASE_URL")
    )
    base_url = auth_base_url or normalized_haolo_base_url(provider.get("base_url"))
    env_key = provider.get("env_key", "OPENAI_API_KEY")

    credential_source = None
    api_key = os.environ.get("LLMHUB_API_KEY")
    if api_key:
        credential_source = "environment:LLMHUB_API_KEY"
    elif auth.get("LLMHUB_API_KEY"):
        api_key = auth.get("LLMHUB_API_KEY")
        credential_source = "haolo_auth_json:LLMHUB_API_KEY"
    elif model_credential.get("api_key"):
        api_key = model_credential["api_key"]
        credential_source = model_credential["credential_source"]
    elif os.environ.get("SUB2API_API_KEY"):
        api_key = os.environ.get("SUB2API_API_KEY")
        credential_source = "environment:SUB2API_API_KEY"
    elif auth.get("SUB2API_API_KEY"):
        api_key = auth.get("SUB2API_API_KEY")
        credential_source = "haolo_auth_json:SUB2API_API_KEY"
    elif os.environ.get(env_key):
        api_key = os.environ.get(env_key)
        credential_source = f"environment:{env_key}"
    elif auth.get(env_key):
        api_key = auth.get(env_key)
        credential_source = f"haolo_auth_json:{env_key}"
    elif os.environ.get("OPENAI_API_KEY"):
        api_key = os.environ.get("OPENAI_API_KEY")
        credential_source = "environment:OPENAI_API_KEY"
    elif auth.get("OPENAI_API_KEY"):
        api_key = auth.get("OPENAI_API_KEY")
        credential_source = "haolo_auth_json:OPENAI_API_KEY"

    return {
        "config_dir": str(selected),
        "config_candidates": [str(path) for path in config_dirs],
        "base_url": base_url,
        "env_key": env_key,
        "api_key": api_key,
        "credential_source": credential_source,
    }


def parse_args():
    parser = argparse.ArgumentParser(
        description="Generate images through the subapi AIHubCC async media task API."
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--prompt", help="Image prompt text.")
    group.add_argument("--prompt-file", help="Path to a UTF-8 prompt file.")
    request_group = parser.add_mutually_exclusive_group()
    request_group.add_argument("--user-request", help="The user's literal request used by the local preset gate.")
    request_group.add_argument("--request-file", help="UTF-8 file containing the user's literal request.")
    parser.add_argument(
        "--preset-check-file",
        help="JSON check record created by scripts/resolve_prompt_preset.py. Required for live AIHubCC submissions.",
    )
    parser.add_argument("--prompt-output", help="Optional UTF-8 path where the final enhanced prompt is saved before submit.")
    parser.add_argument("--output-dir", default="outputs/images", help="Directory for generated images.")
    parser.add_argument("--basename", default="aihubcc-image", help="Base filename without extension.")
    parser.add_argument(
        "--model",
        default=os.environ.get("SUB2API_IMAGE_MODEL") or os.environ.get("OPENAI_IMAGE_MODEL") or DEFAULT_MODEL,
        help=(
            "Public subapi model. Bare gpt-image-2 and legacy provider-prefixed "
            "aliases are normalized to aihubcc/gpt-image-2."
        ),
    )
    parser.add_argument(
        "--exact-model",
        action="store_true",
        help=(
            "Use the live catalog model exactly, except known legacy aliases are always "
            "normalized to the canonical public ID."
        ),
    )
    parser.add_argument(
        "--provider-fallback-only",
        action="store_true",
        help=(
            "Keep the selected gpt-image-2 family locked while allowing only the "
            "same-family Buming image2 provider fallback. Intended for Haolo Image Generation mode."
        ),
    )
    parser.add_argument(
        "--interaction-id",
        default=None,
        help="Optional Haolo interaction ID used to correlate this image charge with its visible task.",
    )
    parser.add_argument(
        "--conversation-id",
        default=None,
        help="Haolo conversation ID used to correlate this image charge with the current visible task.",
    )
    parser.add_argument(
        "--source-type",
        default=None,
        help="Haolo consumption source type used to describe the billed task in usage details.",
    )
    parser.add_argument(
        "--api-url",
        default=None,
        help="Advanced testing only: full /v1/images/generations endpoint.",
    )
    parser.add_argument(
        "--base-url",
        default=None,
        help="Advanced testing only: subapi base URL, for example https://haolo.pro/v1.",
    )
    parser.add_argument("--quality", default="auto", choices=["low", "medium", "high", "auto"])
    parser.add_argument("--size", default="auto", choices=IMAGE_SIZE_CHOICES)
    parser.add_argument(
        "--aspect-ratio",
        default=None,
        choices=ASPECT_RATIO_CHOICES,
        help="Aspect ratio for models whose API uses aspect_ratio instead of pixel size.",
    )
    parser.add_argument("--output-format", default="png", choices=["png", "jpeg", "webp"])
    parser.add_argument("--background", default="auto", choices=["auto", "transparent", "opaque"])
    parser.add_argument("--moderation", default="auto", choices=["auto", "low"])
    parser.add_argument(
        "--image-url",
        action="append",
        dest="image_urls",
        default=[],
        help="Public reference/edit image URL. Repeat for multiple URLs; AIHubCC supports up to 6.",
    )
    parser.add_argument(
        "--images",
        default=None,
        help="Comma-separated public reference/edit image URLs. Equivalent to repeated --image-url.",
    )
    parser.add_argument(
        "--strict-edit",
        action="store_true",
        help=(
            "Preserve all unspecified source-image content. The base model uses the canonical "
            "/v1/images/edits route; selected gpt-image-2-1k uses its asynchronous reference-image "
            "task route. Disables model fallback."
        ),
    )
    parser.add_argument("--poll-interval", type=int, default=5, help="Seconds between status polls.")
    parser.add_argument(
        "--timeout",
        type=int,
        default=600,
        help="Submit read and soft polling timeout in seconds. Accepted tasks remain resumable.",
    )
    parser.add_argument(
        "--allow-insecure-http",
        action="store_true",
        help="Allow plain HTTP for localhost/private testing only. Avoid using this with real remote relays.",
    )
    parser.add_argument("--dry-run", action="store_true", help="Print request payload without calling the API.")
    return parser.parse_args()


def read_prompt(args):
    if args.prompt_file:
        return Path(args.prompt_file).read_text(encoding="utf-8").strip()
    return args.prompt.strip()


def read_user_request(args):
    if args.request_file:
        return Path(args.request_file).read_text(encoding="utf-8").strip()
    return str(args.user_request or "").strip()


def configure_usage_correlation(args):
    interaction_id = str(
        args.interaction_id or os.environ.get("HAOLO_INTERACTION_ID") or ""
    ).strip()
    conversation_id = str(
        args.conversation_id or os.environ.get("HAOLO_CONVERSATION_ID") or ""
    ).strip()
    source_type = str(
        args.source_type or os.environ.get("HAOLO_SOURCE_TYPE") or ""
    ).strip()
    if interaction_id:
        os.environ["HAOLO_INTERACTION_ID"] = interaction_id
    if conversation_id:
        os.environ["HAOLO_CONVERSATION_ID"] = conversation_id
    if source_type:
        os.environ["HAOLO_SOURCE_TYPE"] = source_type
    return interaction_id, conversation_id, source_type


def haolo_usage_headers(include_media_routing=True):
    pairs = (
        ("X-Haolo-Interaction-ID", "HAOLO_INTERACTION_ID"),
        ("X-Haolo-Conversation-ID", "HAOLO_CONVERSATION_ID"),
        ("X-Haolo-Source-Type", "HAOLO_SOURCE_TYPE"),
    )
    headers = {
        header: str(os.environ.get(env_name) or "").strip()
        for header, env_name in pairs
        if str(os.environ.get(env_name) or "").strip()
    }
    if include_media_routing:
        headers.update(
            {
                "X-Haolo-Model-Pool": "media_creation",
                "X-Haolo-Model-Capability": "image_generation",
            }
        )
    return headers


def sha256_text(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def canonical_json_sha256(value):
    return sha256_text(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False))


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 16), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_json_file(path, label):
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"Could not read {label} JSON at {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise RuntimeError(f"{label} JSON must be an object: {path}")
    return value


def replace_job_file(source, destination):
    # Keep a transient Windows read handle from aborting a resumable task.
    for attempt in range(10):
        try:
            os.replace(source, destination)
            return
        except PermissionError as error:
            if getattr(error, "winerror", None) not in {5, 32, 33} or attempt == 9:
                raise
            time.sleep(0.02 * (attempt + 1))


def atomic_write_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_name(f"{path.name}.tmp-{os.getpid()}-{time.time_ns()}")
    try:
        temp_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
        replace_job_file(temp_path, path)
    finally:
        try:
            temp_path.unlink(missing_ok=True)
        except OSError:
            pass


def validate_preset_check(args, require):
    check_value = str(args.preset_check_file or "").strip()
    if not check_value:
        if require:
            raise RequestContractError(
                "A local preset check is required before AIHubCC submit. Run scripts/resolve_prompt_preset.py, "
                "then pass --preset-check-file and --user-request/--request-file."
            )
        return {
            "preset_checked": False,
            "matched": False,
            "preset_id": None,
            "request_id": None,
            "check_file": None,
        }

    user_request = read_user_request(args)
    if not user_request:
        raise RequestContractError("--user-request or --request-file is required with --preset-check-file.")
    check_path = Path(check_value).expanduser().resolve()
    try:
        record = read_json_file(check_path, "preset check")
    except RuntimeError as exc:
        raise RequestContractError(str(exc)) from exc
    if record.get("schema_version") != 1 or record.get("preset_checked") is not True:
        raise RequestContractError("The preset check record is invalid or was not completed.")
    if str(record.get("check_file") or "") != str(check_path):
        raise RequestContractError("The preset check record was moved or copied from its resolver-created path.")
    request_id = str(record.get("request_id") or "").strip()
    if not request_id:
        raise RequestContractError("The preset check record has no request_id.")
    try:
        parsed_request_id = uuid.UUID(request_id)
    except ValueError as exc:
        raise RequestContractError("The preset check request_id must be a canonical UUID4.") from exc
    if parsed_request_id.version != 4 or str(parsed_request_id) != request_id:
        raise RequestContractError("The preset check request_id must be a canonical UUID4.")
    if record.get("request_sha256") != sha256_text(user_request):
        raise RequestContractError("The preset check record belongs to a different user request.")

    matched = record.get("matched") is True
    if local_preset_resolver is None:
        raise RequestContractError("The bundled local preset resolver is unavailable.")
    try:
        entries = local_preset_resolver.load_preset_entries()
        if record.get("match_type") == "explicit":
            expected = local_preset_resolver.explicit_match(entries, record.get("preset_id"))
        else:
            expected = local_preset_resolver.choose_preset(entries, user_request)
    except (OSError, RuntimeError, ValueError) as exc:
        raise RequestContractError(f"The bundled local preset resolver could not validate the check: {exc}") from exc

    if expected is None:
        if matched or record.get("preset_id") != "none":
            raise RequestContractError("The preset check does not match the current local resolver result.")
    else:
        expected_entry, _, expected_match_type = expected
        if (
            not matched
            or record.get("preset_id") != expected_entry["id"]
            or Path(str(record.get("preset_path") or "")).expanduser().resolve() != expected_entry["path"]
            or (record.get("match_type") != "explicit" and record.get("match_type") != expected_match_type)
        ):
            raise RequestContractError("The preset check does not match the current local resolver result.")

    if matched:
        preset_path_value = str(record.get("preset_path") or "").strip()
        expected_hash = str(record.get("preset_sha256") or "").strip()
        if not preset_path_value or not expected_hash:
            raise RequestContractError("The matched preset check is missing its path or SHA-256.")
        preset_path = Path(preset_path_value).expanduser().resolve()
        if not preset_path.exists() or sha256_file(preset_path) != expected_hash:
            raise RequestContractError("The matched local preset changed after it was checked; run the preset resolver again.")
    elif record.get("preset_id") != "none":
        raise RequestContractError("An unmatched preset check must use preset_id=none.")

    return {
        **record,
        "check_file": str(check_path),
        "user_request_sha256": sha256_text(user_request),
    }


def normalized_prompt_text(value):
    return str(value or "").replace("\r\n", "\n").strip()


def enforce_gated_prompt(prompt, args, preset_check):
    """Keep the local preset and literal request in the exact prompt sent to AIHubCC."""
    if preset_check.get("preset_checked") is not True:
        return prompt

    final_prompt = normalized_prompt_text(prompt)
    user_request = normalized_prompt_text(read_user_request(args))
    additions = []

    if preset_check.get("matched") is True:
        preset_path = Path(str(preset_check.get("preset_path") or "")).expanduser().resolve()
        try:
            preset_text = normalized_prompt_text(preset_path.read_text(encoding="utf-8"))
        except OSError as exc:
            raise RequestContractError(f"Could not read the validated local preset: {exc}") from exc
        if preset_text and preset_text not in final_prompt:
            additions.append(f"Local prompt preset (apply these requirements):\n{preset_text}")

    if user_request and user_request not in final_prompt:
        additions.append(f"User request (authoritative, preserve literally):\n{user_request}")

    if not additions:
        return final_prompt
    additions.append(f"Enhanced prompt:\n{final_prompt}")
    return "\n\n".join(additions)


def preset_check_summary(record):
    return {
        "preset_checked": record.get("preset_checked") is True,
        "matched": record.get("matched") is True,
        "preset_id": record.get("preset_id"),
        "preset_sha256": record.get("preset_sha256"),
        "match_type": record.get("match_type"),
        "request_id": record.get("request_id"),
        "check_file": record.get("check_file"),
    }


def save_prompt_file(path_value, prompt):
    if not path_value:
        return None
    prompt_path = Path(path_value).expanduser().resolve()
    prompt_path.parent.mkdir(parents=True, exist_ok=True)
    with prompt_path.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(prompt.rstrip() + "\n")
    return str(prompt_path)


def validate_prompt_output_path(path_value, preset_check):
    if not path_value or preset_check.get("preset_checked") is not True:
        return
    prompt_path = Path(path_value).expanduser().resolve()
    journal_dir = Path(str(preset_check.get("check_file") or "")).expanduser().resolve().parent
    try:
        prompt_path.relative_to(journal_dir)
    except ValueError:
        return
    raise RequestContractError("--prompt-output must not be inside the preset check and media journal directory.")


def media_job_path(preset_check, request_id):
    job_dir = Path(str(preset_check.get("check_file") or "")).expanduser().resolve().parent
    job_path = (job_dir / f"image-{request_id}.json").resolve()
    if job_path.parent != job_dir:
        raise RequestContractError("The preset check request_id produced an unsafe image job path.")
    return job_path


def try_acquire_media_job_lock(path):
    """Return a process-held per-request lock, or None when another invocation owns it."""
    path.parent.mkdir(parents=True, exist_ok=True)
    lock_path = path.with_name(f"{path.name}.lock")
    handle = lock_path.open("a+b")
    try:
        handle.seek(0, os.SEEK_END)
        if handle.tell() == 0:
            handle.write(b"0")
            handle.flush()
        handle.seek(0)
        if os.name == "nt":
            import msvcrt

            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl

            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        return handle
    except (OSError, IOError):
        handle.close()
        return None


def release_media_job_lock(handle):
    if handle is None or handle.closed:
        return
    try:
        handle.seek(0)
        if os.name == "nt":
            import msvcrt

            msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl

            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
    finally:
        handle.close()


def load_media_job(path):
    if not path.exists():
        return None
    return read_json_file(path, "image job")


def write_media_job(path, current=None, **updates):
    value = dict(current or {})
    on_disk = None
    if path.exists():
        on_disk = read_json_file(path, "image job")
    if on_disk:
        value.update(on_disk)
        if on_disk.get("state") == "succeeded" and updates.get("state") != "succeeded":
            return on_disk
        if on_disk.get("terminal") is True and updates.get("state") != "failed":
            return on_disk
        if on_disk.get("state") == "ready" and updates.get("state") in {"accepted", "polling", "pending"}:
            updates = {**updates, "state": "ready"}
        for field in ("task_id", "submit_response", "source_urls", "saved", "metadata"):
            if on_disk.get(field) and not updates.get(field):
                updates.pop(field, None)
    value.update(updates)
    value["revision"] = max(int(value.get("revision") or 0), int((on_disk or {}).get("revision") or 0)) + 1
    value["updated_at_unix"] = int(time.time())
    atomic_write_json(path, value)
    return value


def validate_resumable_job(job, payload, model, preset_check, args):
    if job.get("schema_version") != 1:
        raise RequestContractError("The saved image job has an unsupported schema version.")
    if job.get("request_id") != preset_check.get("request_id"):
        raise RequestContractError("The saved image job belongs to a different preset check.")
    if job.get("payload_sha256") != canonical_json_sha256(payload):
        raise RequestContractError("The prompt or generation parameters changed for an existing image task; create a new preset check instead.")
    if job.get("model") != model:
        raise RequestContractError("The model changed for an existing image task; create a new preset check instead.")
    if bool(job.get("strict_edit")) != bool(args.strict_edit):
        raise RequestContractError("The strict-edit mode changed for an existing image task; create a new preset check instead.")
    saved_output_dir = os.path.normcase(str(Path(str(job.get("output_dir") or "")).expanduser().resolve()))
    requested_output_dir = os.path.normcase(str(Path(args.output_dir).expanduser().resolve()))
    if saved_output_dir != requested_output_dir or job.get("basename") != args.basename or job.get("output_format") != args.output_format:
        raise RequestContractError(
            "The output directory, basename, or format changed for an existing image task; resume with the original command."
        )
    return job


def build_opener():
    # Image generation holds the connection open for minutes; local HTTP
    # proxies (e.g. Clash) tend to kill held connections around 160s, which
    # surfaces as RemoteDisconnected. The gateway is directly reachable, so
    # bypass system proxies unless explicitly requested.
    if os.environ.get("HAOLO_GEN_USE_PROXY") == "1":
        return urllib.request.build_opener()
    return urllib.request.build_opener(urllib.request.ProxyHandler({}))


OPENER = build_opener()


def resolve_curl_executable():
    for name in ("curl.exe", "curl"):
        found = shutil.which(name)
        if found:
            return found
    return None


def resolve_http_transport():
    requested = str(os.environ.get("HAOLO_GEN_HTTP_TRANSPORT") or "").strip().lower()
    if requested in {"urllib", "python"}:
        return "urllib"
    if requested == "curl":
        if not resolve_curl_executable():
            raise TransportError(
                "HAOLO_GEN_HTTP_TRANSPORT=curl was requested, but curl was not found"
            )
        return "curl"
    # Python's OpenSSL transport can terminate long-lived Windows image-edit
    # responses with EOF-in-violation-of-protocol even though the relay is
    # still healthy. Windows curl uses Schannel and is already the stable
    # transport for the bundled video Director, so use the same transport for
    # image submit/status calls. urllib remains the portable fallback.
    if os.name == "nt" and resolve_curl_executable():
        return "curl"
    return "urllib"


def curl_base_args(timeout):
    curl = resolve_curl_executable()
    if not curl:
        raise TransportError("curl executable was not found")
    seconds = max(1, int(timeout or 60))
    args = [
        curl,
        "--silent",
        "--show-error",
        "--location",
        "--max-time",
        str(seconds),
        "--connect-timeout",
        str(min(30, seconds)),
    ]
    if os.environ.get("HAOLO_GEN_USE_PROXY") != "1":
        args.extend(["--noproxy", "*"])
    return args


def split_curl_status(stdout):
    text = stdout.decode("utf-8", "replace")
    marker_index = text.rfind(CURL_STATUS_MARKER)
    if marker_index < 0:
        return text, None
    body = text[:marker_index]
    status = text[marker_index + len(CURL_STATUS_MARKER) :].strip().splitlines()[0]
    try:
        return body, int(status)
    except ValueError:
        return body, None


def run_curl(args, input_bytes=None, timeout=60):
    try:
        return subprocess.run(
            args,
            input=input_bytes,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=max(1, int(timeout or 60)) + 15,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise TransportError(f"curl timed out after {timeout}s") from exc
    except OSError as exc:
        raise TransportError(exc) from exc


def curl_request_json(
    url,
    api_key,
    data=None,
    content_type="application/json",
    timeout=60,
    extra_headers=None,
    include_media_routing=True,
):
    args = curl_base_args(timeout)
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": content_type,
    }
    headers.update(haolo_usage_headers(include_media_routing))
    if extra_headers:
        headers.update(extra_headers)
    for name, value in headers.items():
        args.extend(["-H", f"{name}: {value}"])
    if data is not None:
        args.extend(["-X", "POST", "--data-binary", "@-"])
    args.extend(["--write-out", f"{CURL_STATUS_MARKER}%{{http_code}}", url])
    result = run_curl(args, input_bytes=data, timeout=timeout)
    body, status = split_curl_status(result.stdout)
    stderr = result.stderr.decode("utf-8", "replace").strip()
    if status and status >= 400:
        raise RelayHTTPError(status, body, url=url)
    if result.returncode != 0:
        raise TransportError(stderr or body or f"curl exited with code {result.returncode}")
    if not status or status == 0:
        raise TransportError(stderr or body or "curl did not return an HTTP status")
    try:
        value = json.loads(body)
    except json.JSONDecodeError as exc:
        raise TransportError(f"Expected JSON from {url}: {(body or stderr)[:1000]}") from exc
    if not isinstance(value, dict):
        raise TransportError(f"Expected a JSON object from {url}, got {type(value).__name__}.")
    return value


def collect_image_urls(args, model):
    image_urls = list(args.image_urls or [])
    if args.images:
        image_urls.extend(part.strip() for part in args.images.split(",") if part.strip())

    cleaned = []
    for image_url in image_urls:
        parsed = urllib.parse.urlparse(image_url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise RuntimeError("--image-url values must be public http(s) URLs.")
        cleaned.append(image_url)

    if model == GPT_IMAGE_BASE_MODEL and len(cleaned) > 1:
        raise RequestContractError("gpt-image-2 editing accepts exactly one reference image.")
    if model in MULTI_REFERENCE_MODELS and len(cleaned) > GPT_IMAGE_REFERENCE_MAX_COUNT:
        raise RequestContractError(
            f"{model} accepts at most {GPT_IMAGE_REFERENCE_MAX_COUNT} reference image URLs."
        )
    return cleaned


def enforce_strict_edit_contract(args, prompt, model, image_urls):
    if not args.strict_edit:
        return prompt
    if model not in {GPT_IMAGE_BASE_MODEL, *GPT_IMAGE_ASYNC_MODELS}:
        raise RequestContractError(
            "--strict-edit requires aihubcc/gpt-image-2 or an asynchronous "
            "gpt-image-2 1K/2K/3.5K tier; Buming image2 is not enabled for local-edit requests."
        )
    if len(image_urls) != 1:
        raise RequestContractError("--strict-edit requires exactly one --image-url source image.")
    prefix = STRICT_EDIT_PROMPT_PREFIX if model == GPT_IMAGE_BASE_MODEL else REFERENCE_EDIT_PROMPT_PREFIX
    if prefix in prompt:
        return prompt
    return f"{prefix}\n\n{prompt}"


def operation_mode(args, model):
    if not args.strict_edit:
        return "generate_or_reference"
    return "strict_edit" if model == GPT_IMAGE_BASE_MODEL else "reference_edit"


def reference_delivery_contract(model, image_urls, api_url, strict_edit=False):
    count = len(image_urls)
    if not count:
        return {
            "count": 0,
            "transport": "none",
            "field": None,
            "endpoint": api_url,
            "strict_edit": bool(strict_edit),
        }
    if model == GPT_IMAGE_BASE_MODEL:
        transport = "multipart/form-data"
        field = "image"
    elif model == BUMING_IMAGE2_MODEL:
        transport = "application/json"
        field = "image"
    else:
        transport = "application/json"
        field = "reference_image_urls"
    return {
        "count": count,
        "transport": transport,
        "field": field,
        "endpoint": api_url,
        "strict_edit": bool(strict_edit),
    }


def reference_image_audit(loaded_references):
    audit = []
    for index, (image_url, data, mime_type) in enumerate(loaded_references, 1):
        width, height = image_dimensions(data, mime_type)
        audit.append(
            {
                "position": index,
                "url_sha256": sha256_text(image_url),
                "content_sha256": hashlib.sha256(data).hexdigest(),
                "mime_type": mime_type,
                "byte_length": len(data),
                "width": width or None,
                "height": height or None,
            }
        )
    return audit


def build_payload(args, prompt, model):
    if model not in DIRECTOR_IMAGE_MODELS:
        raise RequestContractError(f"Unsupported image model: {model}")
    image_urls = collect_image_urls(args, model)
    payload = {
        "model": model,
        "prompt": prompt,
    }
    if model == BUMING_IMAGE2_MODEL:
        if args.aspect_ratio is not None:
            raise RequestContractError("image2 uses --size, not --aspect-ratio.")
        resolved_size = "1024x1024" if args.size == "auto" else args.size
        if resolved_size not in GPT_IMAGE_1K_SIZE_CHOICES:
            raise RequestContractError(f"size {resolved_size} is not supported by {model}.")
        payload.update(
            {
                "size": resolved_size,
                "quality": "high" if args.quality == "auto" else args.quality,
                "response_format": "url",
                "n": 1,
            }
        )
        if image_urls:
            payload["image"] = image_urls
        return payload
    if model == GPT_IMAGE_BASE_MODEL:
        if args.aspect_ratio is not None:
            raise RequestContractError("gpt-image-2 uses --size, not --aspect-ratio.")
        if args.size not in GPT_IMAGE_BASE_SIZE_CHOICES:
            raise RequestContractError(f"size {args.size} is not supported by {model}.")
        if image_urls:
            payload["image"] = image_urls[0]
            return payload
        payload.update(
            {
                "size": args.size,
                "quality": args.quality,
                "response_format": "url",
                "n": 1,
            }
        )
        return payload
    if args.quality != "auto":
        raise RequestContractError(f"{model} does not support the quality parameter.")
    if args.size != "auto":
        raise RequestContractError(f"{model} uses --aspect-ratio, not --size.")
    if args.aspect_ratio in (None, "auto"):
        payload["aspect_ratio"] = "1:1"
    else:
        payload["aspect_ratio"] = args.aspect_ratio
    if image_urls:
        payload["reference_image_urls"] = image_urls
    return payload


def download_reference_bytes(image_url, max_bytes):
    request = urllib.request.Request(
        migrate_gateway_url(image_url, preserve_query=True),
        headers={"User-Agent": BROWSER_UA, "Accept": "image/png,image/jpeg,image/webp"},
    )
    with OPENER.open(request, timeout=60) as response:
        content_type = (response.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        data = response.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise RequestContractError(
            f"Reference images exceed the documented {max_bytes // (1024 * 1024)} MB limit."
        )
    detected_type = detect_image_mime(data)
    if detected_type not in GPT_IMAGE_ALLOWED_MIME_TYPES:
        raise RequestContractError("Reference images must be JPEG, PNG, or WebP.")
    if content_type.startswith("image/") and content_type != detected_type:
        content_type = detected_type
    return data, detected_type


def detect_image_mime(data):
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8"):
        return "image/jpeg"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return ""


def image_dimensions(data, mime_type):
    if mime_type == "image/png" and len(data) >= 24:
        return struct.unpack(">II", data[16:24])
    if mime_type == "image/jpeg":
        offset = 2
        while offset + 9 <= len(data):
            if data[offset] != 0xFF:
                offset += 1
                continue
            marker = data[offset + 1]
            offset += 2
            if marker in {0xD8, 0xD9}:
                continue
            if offset + 2 > len(data):
                break
            segment_length = int.from_bytes(data[offset : offset + 2], "big")
            if segment_length < 2 or offset + segment_length > len(data):
                break
            if marker in {
                0xC0,
                0xC1,
                0xC2,
                0xC3,
                0xC5,
                0xC6,
                0xC7,
                0xC9,
                0xCA,
                0xCB,
                0xCD,
                0xCE,
                0xCF,
            }:
                height = int.from_bytes(data[offset + 3 : offset + 5], "big")
                width = int.from_bytes(data[offset + 5 : offset + 7], "big")
                return width, height
            offset += segment_length
    if mime_type == "image/webp" and len(data) >= 30:
        chunk = data[12:16]
        if chunk == b"VP8X":
            width = 1 + int.from_bytes(data[24:27], "little")
            height = 1 + int.from_bytes(data[27:30], "little")
            return width, height
        if chunk == b"VP8 " and len(data) >= 30 and data[23:26] == b"\x9d\x01\x2a":
            width = int.from_bytes(data[26:28], "little") & 0x3FFF
            height = int.from_bytes(data[28:30], "little") & 0x3FFF
            return width, height
        if chunk == b"VP8L" and len(data) >= 25 and data[20] == 0x2F:
            bits = int.from_bytes(data[21:25], "little")
            width = (bits & 0x3FFF) + 1
            height = ((bits >> 14) & 0x3FFF) + 1
            return width, height
    return 0, 0


def validate_and_load_reference_images(model, image_urls):
    if not image_urls:
        return []
    byte_limit = (
        20 * 1024 * 1024
        if model == GPT_IMAGE_BASE_MODEL
        else GPT_IMAGE_REFERENCE_MAX_BYTES
    )
    loaded = []
    total = 0
    for image_url in image_urls:
        remaining = byte_limit - total
        if remaining <= 0:
            raise RequestContractError("Reference images must total no more than 5 MB.")
        data, mime_type = download_reference_bytes(image_url, remaining)
        total += len(data)
        loaded.append((image_url, data, mime_type))
    if model in MULTI_REFERENCE_MODELS and total > GPT_IMAGE_REFERENCE_MAX_BYTES:
        raise RequestContractError("Reference images must total no more than 5 MB.")
    if model == GPT_IMAGE_BASE_MODEL:
        width, height = image_dimensions(loaded[0][1], loaded[0][2])
        if not width or not height:
            raise RequestContractError("Could not determine the reference image dimensions.")
        if max(width, height) > GPT_IMAGE_BASE_MAX_EDGE:
            raise RequestContractError(
                f"gpt-image-2 reference image long edge must not exceed {GPT_IMAGE_BASE_MAX_EDGE}px."
            )
    return loaded


def multipart_image_edit_body(payload, loaded_image):
    _, data, mime_type = loaded_image
    extension = EXT_BY_MIME.get(mime_type) or mimetypes.guess_extension(mime_type) or ".bin"
    if not str(extension).startswith("."):
        extension = f".{extension}"
    boundary = f"----haolo-image-{uuid.uuid4().hex}"
    buffer = io.BytesIO()

    def write_field(name, value):
        buffer.write(f"--{boundary}\r\n".encode("ascii"))
        buffer.write(
            f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("utf-8")
        )
        buffer.write(str(value).encode("utf-8"))
        buffer.write(b"\r\n")

    write_field("model", payload["model"])
    write_field("prompt", payload["prompt"])
    buffer.write(f"--{boundary}\r\n".encode("ascii"))
    buffer.write(
        (
            f'Content-Disposition: form-data; name="image"; '
            f'filename="reference{extension}"\r\n'
        ).encode("utf-8")
    )
    buffer.write(f"Content-Type: {mime_type}\r\n\r\n".encode("ascii"))
    buffer.write(data)
    buffer.write(b"\r\n")
    buffer.write(f"--{boundary}--\r\n".encode("ascii"))
    return buffer.getvalue(), f"multipart/form-data; boundary={boundary}"


def http_request_json(
    url,
    api_key,
    data,
    content_type,
    timeout=60,
    extra_headers=None,
    include_media_routing=True,
):
    if resolve_http_transport() == "curl":
        return curl_request_json(
            url,
            api_key,
            data=data,
            content_type=content_type,
            timeout=timeout,
            extra_headers=extra_headers,
            include_media_routing=include_media_routing,
        )
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": content_type,
    }
    headers.update(haolo_usage_headers(include_media_routing))
    if extra_headers:
        headers.update(extra_headers)
    request = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers=headers,
    )
    try:
        with OPENER.open(request, timeout=timeout) as response:
            response_text = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RelayHTTPError(exc.code, body, headers=exc.headers) from exc
    try:
        value = json.loads(response_text)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Expected JSON from {url}: {response_text[:1000]}") from exc
    if not isinstance(value, dict):
        raise RuntimeError(f"Expected a JSON object from {url}, got {type(value).__name__}.")
    return value


def http_json(url, api_key, payload=None, timeout=60, include_media_routing=True):
    if resolve_http_transport() == "curl":
        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        return curl_request_json(
            url,
            api_key,
            data=data,
            timeout=timeout,
            include_media_routing=include_media_routing,
        )
    if payload is not None:
        return http_request_json(
            url,
            api_key,
            json.dumps(payload).encode("utf-8"),
            "application/json",
            timeout=timeout,
            include_media_routing=include_media_routing,
        )
    data = None
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    headers.update(haolo_usage_headers(include_media_routing))
    request = urllib.request.Request(
        url,
        data=data,
        method="POST" if payload is not None else "GET",
        headers=headers,
    )
    try:
        with OPENER.open(request, timeout=timeout) as response:
            response_text = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RelayHTTPError(exc.code, body, url=url, headers=exc.headers) from exc
    try:
        value = json.loads(response_text)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Invalid JSON from {url}: {response_text[:1000]}") from exc
    if not isinstance(value, dict):
        raise RuntimeError(f"Expected a JSON object from {url}, got {type(value).__name__}.")
    return value


def submit_image_job(
    url,
    api_key,
    model,
    timeout,
    *,
    payload=None,
    data=None,
    content_type=None,
    extra_headers=None,
):
    include_media_routing = model != BUMING_IMAGE2_MODEL

    def submit(include_routing):
        if data is not None:
            return http_request_json(
                url,
                api_key,
                data,
                content_type,
                timeout=timeout,
                extra_headers=extra_headers,
                include_media_routing=include_routing,
            )
        return http_json(
            url,
            api_key,
            payload=payload,
            timeout=timeout,
            include_media_routing=include_routing,
        )

    try:
        return submit(include_media_routing)
    except RelayHTTPError as error:
        # upstream_status=0 proves the relay rejected this before a provider task
        # existed. Retry the same request once, omitting only optional routing
        # hints so the credential's own media group can choose its valid route.
        if include_media_routing and (
            is_media_catalog_policy_mismatch(error, model)
            or is_authoritative_pre_provider_route_failure(error)
        ):
            return submit(False)
        raise


def extract_task_id(response_body):
    code = response_body.get("code")
    if code not in (None, 200, "200"):
        raise RuntimeError(f"submit response code was {code}: {json.dumps(response_body, ensure_ascii=False)[:2000]}")

    data = response_body.get("data") or {}
    if isinstance(data, dict):
        task_id = data.get("task_id") or data.get("id")
        if not task_id:
            task_ids = data.get("任务ids") or data.get("task_ids")
            if isinstance(task_ids, list) and task_ids:
                task_id = task_ids[0]
        if task_id:
            return str(task_id)

    task_id = response_body.get("task_id") or response_body.get("id")
    if task_id:
        return str(task_id)

    raise RuntimeError(f"submit response had no task_id: {json.dumps(response_body, ensure_ascii=False)[:2000]}")


def collect_result_urls(value):
    urls = []

    def visit(item):
        if isinstance(item, str):
            clean = item.strip()
            if clean:
                urls.append(clean)
            return
        if isinstance(item, list):
            for child in item:
                visit(child)
            return
        if isinstance(item, dict):
            for key in ("image_url", "video_url", "result_url", "content_url", "url"):
                if key in item:
                    visit(item.get(key))
            encoded = item.get("b64_json")
            if isinstance(encoded, str) and encoded.strip():
                urls.append(f"data:image/png;base64,{encoded.strip()}")
            for key in ("result_urls", "unsigned_urls", "urls", "images", "data"):
                if key in item:
                    visit(item.get(key))

    visit(value)
    unique = []
    seen = set()
    for url in urls:
        if url not in seen:
            seen.add(url)
            unique.append(url)
    return unique


def poll_result(base_url, api_key, model, task_id, timeout, poll_interval, on_status=None):
    deadline = time.monotonic() + timeout
    last_status = None
    last_error = None

    while time.monotonic() <= deadline:
        try:
            current = http_json(
                documented_status_url(base_url, model, task_id),
                api_key,
                timeout=60,
                include_media_routing=model != BUMING_IMAGE2_MODEL,
            )
        except (RuntimeError, urllib.error.URLError, OSError, http.client.HTTPException) as exc:
            error_class, http_status = classify_error(exc)
            if http_status in EXPLICIT_TIMEOUT_HTTP_STATUS:
                raise MediaTaskPendingError(
                    f"task {task_id} status request returned explicit timeout HTTP {http_status}: {exc}"
                ) from exc
            if error_class != "availability":
                raise
            last_error = str(exc)
            time.sleep(max(1, min(poll_interval, 10)))
            continue
        last_status = current
        last_error = None
        if on_status is not None:
            on_status(current)
        data = current.get("data") if isinstance(current.get("data"), dict) else {}
        state = str(
            current.get("state")
            or data.get("state")
            or current.get("status")
            or data.get("status")
            or ""
        ).strip().lower()
        result_urls = collect_result_urls(current)
        if state == "completed":
            if not result_urls:
                current["content_url"] = (
                    f"{normalize_base_url(base_url)}/videos/"
                    f"{urllib.parse.quote(str(task_id), safe='')}/content"
                )
            return current
        if state in TERMINAL_FAILURE:
            raise MediaTaskTerminalError(
                f"task {task_id} ended as '{state}': {json.dumps(current, ensure_ascii=False)[:2000]}",
                response_payload=current,
            )
        try:
            response_code = int(current.get("code"))
        except (TypeError, ValueError):
            response_code = None
        if response_code in EXPLICIT_TIMEOUT_HTTP_STATUS:
            raise MediaTaskPendingError(
                f"task {task_id} status response reported explicit timeout code {response_code}: "
                f"{json.dumps(current, ensure_ascii=False)[:2000]}"
            )
        time.sleep(poll_interval)

    detail = json.dumps(last_status, ensure_ascii=False)[:2000] if last_status is not None else last_error
    raise MediaTaskPendingError(f"timed out after {timeout}s while polling task {task_id}: {detail}")


def extension_from_url(result_url, default_format):
    parsed = urllib.parse.urlparse(result_url)
    suffix = Path(parsed.path).suffix.lower().lstrip(".")
    if suffix in {"png", "jpg", "jpeg", "webp", "gif"}:
        return "jpg" if suffix == "jpeg" else suffix
    return "jpg" if default_format == "jpeg" else default_format


def write_data_url(result_url, output_dir, basename, stamp, output_format, index):
    header, encoded = result_url.split(",", 1)
    mime = header.split(";")[0].replace("data:", "")
    ext = EXT_BY_MIME.get(mime, "jpg" if output_format == "jpeg" else output_format)
    path = output_dir / f"{basename}-{stamp}-{index}.{ext}"
    path.write_bytes(base64.b64decode(encoded))
    return str(path)


def download_result(result_url, api_key, base_url, output_dir, basename, output_format, stamp, index):
    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)

    if str(result_url).startswith("data:image/"):
        return write_data_url(result_url, output, basename, stamp, output_format, index)

    result_url = migrate_gateway_url(result_url, preserve_query=True)
    base_url = normalize_base_url(base_url)
    headers = {"User-Agent": BROWSER_UA}
    if urllib.parse.urlparse(result_url).netloc == urllib.parse.urlparse(base_url).netloc:
        headers["Authorization"] = f"Bearer {api_key}"
    request = urllib.request.Request(result_url, headers=headers)
    with OPENER.open(request, timeout=300) as response:
        first = response.read(1 << 16)
        if first.lstrip()[:1] in (b"{", b"["):
            raise RuntimeError("result_url returned JSON instead of image bytes: " + first.decode("utf-8", "replace")[:500])
        mime = (response.headers.get("Content-Type") or "").split(";")[0].strip()
        ext = EXT_BY_MIME.get(mime) or extension_from_url(result_url, output_format)
        path = output / f"{basename}-{stamp}-{index}.{ext}"
        with open(path, "wb") as handle:
            handle.write(first)
            while True:
                chunk = response.read(1 << 16)
                if not chunk:
                    break
                handle.write(chunk)
    return str(path)


def download_results(result_urls, api_key, base_url, output_dir, basename, output_format):
    stamp = time.strftime("%Y%m%d-%H%M%S")
    saved = []
    content_hashes = set()
    for index, result_url in enumerate(result_urls, 1):
        result_path = download_result(
            result_url,
            api_key,
            base_url,
            output_dir,
            basename,
            output_format,
            stamp,
            index,
        )
        digest = hashlib.sha256(Path(result_path).read_bytes()).hexdigest()
        if digest in content_hashes:
            try:
                Path(result_path).unlink()
            except OSError:
                pass
            continue
        content_hashes.add(digest)
        saved.append(result_path)
    return saved


def save_metadata(
    output_dir,
    basename,
    submit_body,
    status_body,
    saved,
    source_urls,
    request_id=None,
    preset_check=None,
    reference_delivery=None,
    reference_images=None,
):
    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    meta_path = output / f"{basename}-{stamp}.json"
    meta_path.write_text(
        json.dumps(
            {
                "request_id": request_id,
                "preset_check": preset_check,
                "submit_response": submit_body,
                "status_response": status_body,
                "saved": saved,
                "source_urls": source_urls,
                "reference_delivery": reference_delivery,
                "reference_images": reference_images or [],
            },
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    return str(meta_path)


def validate_api_url(api_url, allow_insecure_http):
    parsed = urllib.parse.urlparse(api_url)
    if parsed.scheme == "https":
        return
    if parsed.scheme == "http":
        host = (parsed.hostname or "").lower()
        local_hosts = {"localhost", "127.0.0.1", "::1"}
        if host in local_hosts:
            return
        if allow_insecure_http:
            return
        raise RuntimeError(
            "Refusing to send API credentials over plain HTTP to a remote endpoint. "
            "Use HTTPS, a localhost relay, or pass --allow-insecure-http only for disposable-key testing."
        )
    raise RuntimeError(f"Unsupported API URL scheme: {parsed.scheme or '(missing)'}")


def model_submit_endpoint(base_url, model, has_reference_images):
    if model == GPT_IMAGE_BASE_MODEL and has_reference_images:
        return image_edits_endpoint(base_url)
    if model in GPT_IMAGE_ASYNC_MODELS:
        return video_generation_endpoint(base_url)
    return images_endpoint(base_url)


def resolve_endpoint(args, haolo, model, has_reference_images):
    endpoint_source = "default_subapi"
    if args.api_url:
        configured_api_url = normalized_haolo_api_url(args.api_url)
        base_url = base_url_from_api_url(configured_api_url)
        endpoint_source = "argument_api_url"
        return (
            base_url,
            model_submit_endpoint(base_url, model, has_reference_images),
            endpoint_source,
        )
    if os.environ.get("OPENAI_IMAGE_API_URL"):
        configured_api_url = normalized_haolo_api_url(os.environ["OPENAI_IMAGE_API_URL"])
        base_url = base_url_from_api_url(configured_api_url)
        endpoint_source = "environment_api_url"
        return (
            base_url,
            model_submit_endpoint(base_url, model, has_reference_images),
            endpoint_source,
        )
    if args.base_url:
        base_url = normalize_base_url(args.base_url)
        endpoint_source = "argument_base_url"
    elif haolo.get("base_url"):
        base_url = normalize_base_url(haolo["base_url"])
        endpoint_source = "haolo_default_config"
    else:
        base_url = DEFAULT_HAOLO_BASE_URL
    return (
        base_url,
        model_submit_endpoint(base_url, model, has_reference_images),
        endpoint_source,
    )


def main():
    args = parse_args()
    configure_usage_correlation(args)
    prompt = read_prompt(args)

    try:
        if args.exact_model:
            model = normalize_public_model(args.model)
            if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}", model):
                raise RequestContractError("--exact-model requires a safe non-empty model ID from the live catalog.")
        else:
            model = normalize_public_model(args.model)
        if args.provider_fallback_only and (
            not args.exact_model or model != GPT_IMAGE_BASE_MODEL
        ):
            raise RequestContractError(
                "--provider-fallback-only requires --exact-model --model aihubcc/gpt-image-2 "
                "(legacy aliases are accepted and normalized)."
            )
        haolo = load_haolo_defaults(model)
        preset_check = validate_preset_check(args, require=not args.dry_run)
        validate_prompt_output_path(args.prompt_output, preset_check)
        if args.poll_interval <= 0:
            raise RequestContractError("--poll-interval must be greater than zero.")
        if args.timeout <= 0:
            raise RequestContractError("--timeout must be greater than zero.")
        prompt = enforce_gated_prompt(prompt, args, preset_check)
        reference_urls = collect_image_urls(args, model)
        prompt = enforce_strict_edit_contract(args, prompt, model, reference_urls)
        payload = build_payload(args, prompt, model)
        base_url, api_url, endpoint_source = resolve_endpoint(
            args,
            haolo,
            model,
            bool(reference_urls),
        )
        reference_delivery = reference_delivery_contract(
            model,
            reference_urls,
            api_url,
            strict_edit=args.strict_edit,
        )
    except (RuntimeError, OSError) as exc:
        return report_request_failure(exc)

    prompt_saved = None

    if args.dry_run:
        prompt_saved = save_prompt_file(args.prompt_output, prompt)
        print(
            json.dumps(
                {
                    "api_url": api_url,
                    "status_url_template": status_url_template(base_url, model),
                    "endpoint_source": endpoint_source,
                    "credential_source": haolo.get("credential_source") or "not_found",
                    "http_transport": resolve_http_transport(),
                    "haolo_config_dir": haolo.get("config_dir"),
                    "haolo_config_candidates": haolo.get("config_candidates"),
                    "timeout_seconds": args.timeout,
                    "payload": payload,
                    "operation_mode": operation_mode(args, model),
                    "reference_delivery": reference_delivery,
                    "preset_gate": preset_check_summary(preset_check),
                    "prompt_saved": prompt_saved,
                },
                indent=2,
                ensure_ascii=False,
            )
        )
        return 0

    try:
        validate_api_url(api_url, args.allow_insecure_http or endpoint_source == "haolo_default_config")
    except RuntimeError as exc:
        return report_request_failure(exc)

    api_key = haolo.get("api_key")
    if not api_key:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error_class": "auth",
                    "error": "No API credential found. Set LLMHUB_API_KEY, SUB2API_API_KEY, or log in so haolo_desktop injects OPENAI_API_KEY.",
                },
                ensure_ascii=False,
            )
        )
        return 2

    request_id = preset_check["request_id"]
    try:
        job_path = media_job_path(preset_check, request_id)
    except RuntimeError as exc:
        return report_request_failure(exc)

    job_lock = try_acquire_media_job_lock(job_path)
    if job_lock is None:
        active_job = None
        try:
            active_job = load_media_job(job_path)
        except RuntimeError:
            pass
        return report_pending_task(
            MediaTaskPendingError("Another process is already handling this exact image request."),
            request_id,
            (active_job or {}).get("task_id"),
            job_path,
            preset_check,
            state="active_elsewhere",
        )

    def finish(result):
        release_media_job_lock(job_lock)
        return result

    task_id = None
    submit_body = None
    status_body = None
    result_urls = []
    saved = []
    meta = None
    reference_images = []
    resumed = False
    job = None

    try:
        job = load_media_job(job_path)
        if job is not None:
            resumed = True
            job = validate_resumable_job(job, payload, model, preset_check, args)
            prompt_saved = save_prompt_file(args.prompt_output, prompt) or job.get("prompt_saved")
            task_id = job.get("task_id")
            submit_body = job.get("submit_response")
            status_body = job.get("last_status")
            result_urls = list(job.get("source_urls") or [])
            reference_delivery = job.get("reference_delivery") or reference_delivery
            reference_images = list(job.get("reference_images") or [])
            if job.get("base_url"):
                base_url = normalize_base_url(job["base_url"])
            if (
                job.get("state") in {"submitting", "reconciling"}
                and not task_id
                and not result_urls
            ):
                legacy_machine_error = (
                    job.get("machine_error")
                    if isinstance(job.get("machine_error"), dict)
                    else machine_error_from_text(job.get("last_error"))
                )
                legacy_error = MediaTaskTerminalError(
                    str(job.get("last_error") or "The prior image submit was rejected."),
                    machine_error=legacy_machine_error,
                )
                legacy_http_status = optional_int(job.get("http_status"))
                if legacy_http_status is None:
                    status_match = re.search(r"HTTP (\d{3})", str(job.get("last_error") or ""))
                    legacy_http_status = int(status_match.group(1)) if status_match else None
                if legacy_http_status is None:
                    legacy_http_status = optional_int(
                        (legacy_machine_error or {}).get("upstream_status")
                    )
                legacy_error.status = legacy_http_status
                if (
                    is_authoritative_retryable_route_exhaustion(legacy_error)
                    or is_authoritative_pre_provider_route_failure(legacy_error)
                ):
                    job = write_media_job(
                        job_path,
                        job,
                        state="failed",
                        accepted=False,
                        terminal=True,
                        error_class="availability",
                        http_status=legacy_error.status,
                        machine_error=legacy_machine_error,
                    )
                    return finish(
                        report_terminal_task(
                            legacy_error,
                            request_id,
                            task_id,
                            job_path,
                            preset_check,
                            model=model,
                            allow_model_fallback=not args.exact_model or args.provider_fallback_only,
                            provider_fallback_only=args.provider_fallback_only,
                            strict_edit=args.strict_edit,
                        )
                    )
            if job.get("terminal") is True or job.get("state") == "failed":
                saved_error = MediaTaskTerminalError(
                    str(job.get("last_error") or "The saved image task is terminal."),
                    machine_error=job.get("machine_error"),
                )
                saved_error.status = optional_int(job.get("http_status"))
                return finish(
                    report_terminal_task(
                        saved_error,
                        request_id,
                        task_id,
                        job_path,
                        preset_check,
                        model=model,
                        allow_model_fallback=not args.exact_model or args.provider_fallback_only,
                        provider_fallback_only=args.provider_fallback_only,
                        strict_edit=args.strict_edit,
                    )
                )
            if job.get("state") == "succeeded":
                saved = list(job.get("saved") or [])
                if saved and all(Path(item).exists() for item in saved):
                    print(
                        json.dumps(
                            {
                                "ok": True,
                                "model": model,
                                "request_id": request_id,
                                "task_id": task_id,
                                "saved": saved,
                                "metadata": job.get("metadata"),
                                "source_url": result_urls[0] if result_urls else None,
                                "source_urls": result_urls,
                                "preset_check": preset_check_summary(preset_check),
                                "prompt_saved": prompt_saved,
                                "operation_mode": operation_mode(args, model),
                                "reference_delivery": reference_delivery,
                                "reference_images": reference_images,
                                "resumed": True,
                            },
                            ensure_ascii=False,
                        )
                    )
                    return finish(0)
            if not task_id and not result_urls:
                raise MediaTaskPendingError(
                    "The prior submit result is unknown. Keep this request pending; do not create another preset check or POST."
                )
        else:
            prompt_saved = save_prompt_file(args.prompt_output, prompt)
            loaded_references = validate_and_load_reference_images(
                model,
                reference_urls,
            )
            reference_images = reference_image_audit(loaded_references)
            job = write_media_job(
                job_path,
                schema_version=1,
                request_id=request_id,
                state="submitting",
                prompt_sha256=sha256_text(prompt),
                payload_sha256=canonical_json_sha256(payload),
                model=model,
                base_url=base_url,
                api_url=api_url,
                output_dir=str(Path(args.output_dir).expanduser().resolve()),
                basename=args.basename,
                output_format=args.output_format,
                strict_edit=bool(args.strict_edit),
                reference_delivery=reference_delivery,
                reference_images=reference_images,
                preset_check=preset_check_summary(preset_check),
                prompt_saved=prompt_saved,
                created_at_unix=int(time.time()),
            )
            if model == GPT_IMAGE_BASE_MODEL and loaded_references:
                multipart_body, multipart_type = multipart_image_edit_body(
                    payload,
                    loaded_references[0],
                )
                submit_body = submit_image_job(
                    api_url,
                    api_key,
                    model,
                    timeout=args.timeout,
                    data=multipart_body,
                    content_type=multipart_type,
                    extra_headers={
                        "X-Haolo-Reference-Image-URL": loaded_references[0][0],
                    },
                )
            else:
                submit_body = submit_image_job(
                    api_url,
                    api_key,
                    model,
                    timeout=args.timeout,
                    payload=payload,
                )
            result_urls = collect_result_urls(submit_body)
            if result_urls:
                job = write_media_job(
                    job_path,
                    job,
                    state="ready",
                    submit_response=submit_body,
                    source_urls=result_urls,
                )
            else:
                task_id = extract_task_id(submit_body)
                job = write_media_job(
                    job_path,
                    job,
                    state="accepted",
                    task_id=task_id,
                    submit_response=submit_body,
                )

        if not result_urls:
            def record_status(current):
                nonlocal job
                job = write_media_job(
                    job_path,
                    job,
                    state="polling",
                    task_id=task_id,
                    last_status=current,
                    progress=current.get("progress"),
                )

            status_body = poll_result(
                base_url,
                api_key,
                model,
                task_id,
                args.timeout,
                args.poll_interval,
                on_status=record_status,
            )
            result_urls = collect_result_urls(status_body)
            job = write_media_job(
                job_path,
                job,
                state="ready",
                task_id=task_id,
                last_status=status_body,
                source_urls=result_urls,
            )

        saved = download_results(result_urls, api_key, base_url, args.output_dir, args.basename, args.output_format)
        meta = save_metadata(
            args.output_dir,
            args.basename,
            submit_body,
            status_body,
            saved,
            result_urls,
            request_id=request_id,
            preset_check=preset_check_summary(preset_check),
            reference_delivery=reference_delivery,
            reference_images=reference_images,
        )
        job = write_media_job(
            job_path,
            job,
            state="succeeded",
            task_id=task_id,
            last_status=status_body,
            source_urls=result_urls,
            saved=saved,
            metadata=meta,
            completed_at_unix=int(time.time()),
        )
    except MediaTaskPendingError as exc:
        pending_state = "pending" if task_id else "reconciling"
        job = write_media_job(
            job_path,
            job,
            state=pending_state,
            task_id=task_id,
            last_error=str(exc)[:2000],
        )
        return finish(report_pending_task(exc, request_id, task_id, job_path, preset_check, state=pending_state))
    except MediaTaskTerminalError as exc:
        machine_error = machine_error_from_exception(exc)
        job = write_media_job(
            job_path,
            job,
            state="failed",
            task_id=task_id,
            terminal=True,
            last_error=str(exc)[:2000],
            machine_error=machine_error,
        )
        return finish(
            report_terminal_task(
                exc,
                request_id,
                task_id,
                job_path,
                preset_check,
                model=model,
                allow_model_fallback=not args.exact_model or args.provider_fallback_only,
                provider_fallback_only=args.provider_fallback_only,
                strict_edit=args.strict_edit,
            )
        )
    except (RuntimeError, urllib.error.URLError, OSError, http.client.HTTPException) as exc:
        if isinstance(exc, RequestContractError):
            return finish(report_request_failure(exc))
        error_class, http_status = classify_error(exc)
        if job is None and job_path.exists():
            return finish(
                report_pending_task(
                    exc,
                    request_id,
                    None,
                    job_path,
                    preset_check,
                    state="journal_unreadable",
                )
            )
        explicit_submit_rejection = (
            http_status is not None
            and 400 <= http_status < 500
            and http_status not in {408, 409, 425, 429}
        )
        authoritative_route_exhaustion = bool(
            job is not None
            and job.get("state") == "submitting"
            and not task_id
            and (
                is_authoritative_retryable_route_exhaustion(exc)
                or is_authoritative_pre_provider_route_failure(exc)
            )
        )
        if authoritative_route_exhaustion:
            machine_error = machine_error_from_exception(exc)
            job = write_media_job(
                job_path,
                job,
                state="failed",
                accepted=False,
                terminal=True,
                error_class=error_class,
                http_status=http_status,
                machine_error=machine_error,
                last_error=str(exc)[:2000],
            )
            return finish(
                report_terminal_task(
                    exc,
                    request_id,
                    task_id,
                    job_path,
                    preset_check,
                    model=model,
                    allow_model_fallback=not args.exact_model or args.provider_fallback_only,
                    provider_fallback_only=args.provider_fallback_only,
                    strict_edit=args.strict_edit,
                )
            )
        if job is not None and job.get("state") == "submitting" and not task_id and explicit_submit_rejection:
            write_media_job(
                job_path,
                job,
                state="failed",
                accepted=False,
                terminal=True,
                error_class=error_class,
                http_status=http_status,
                last_error=str(exc)[:2000],
            )
            return finish(report_request_failure(exc))
        if job is not None and (task_id or job.get("state") in {"submitting", "accepted", "polling", "ready", "pending"}):
            next_state = "ready" if result_urls else ("pending" if task_id else "reconciling")
            job = write_media_job(
                job_path,
                job,
                state=next_state,
                task_id=task_id,
                source_urls=result_urls,
                error_class=error_class,
                http_status=http_status,
                machine_error=machine_error_from_exception(exc),
                last_error=str(exc)[:2000],
            )
            return finish(report_pending_task(exc, request_id, task_id, job_path, preset_check, state=next_state))
        return finish(report_request_failure(exc))

    print(
        json.dumps(
            {
                "ok": True,
                "model": model,
                "request_id": request_id,
                "task_id": task_id,
                "saved": saved,
                "metadata": meta,
                "source_url": result_urls[0] if result_urls else None,
                "source_urls": result_urls,
                "preset_check": preset_check_summary(preset_check),
                "prompt_saved": prompt_saved,
                "operation_mode": operation_mode(args, model),
                "reference_delivery": reference_delivery,
                "reference_images": reference_images,
                "resumed": resumed,
            },
            ensure_ascii=False,
        )
    )
    return finish(0)


def classify_error(exc):
    if isinstance(exc, RequestContractError):
        return "request", None
    text = str(exc)
    status = getattr(exc, "status", None)
    match = re.search(r"HTTP (\d{3})", text)
    if isinstance(status, int) or match:
        code = status if isinstance(status, int) else int(match.group(1))
        lowered = text.lower()
        if code in (401, 403):
            return "auth", code
        if code == 400 and any(token in lowered for token in ("moderation", "content_policy", "content policy", "safety")):
            return "policy", code
        if code in {408, 425, 429} or 500 <= code < 600:
            return "availability", code
        return "request", code
    if "timed out" in text.lower():
        return "availability", None
    if any(
        token in text
        for token in (
            "--image-url",
            "reference image URLs",
            "must be",
            "supports at most",
            "preset check",
            "preset gate",
            "user request",
            "saved image job",
            "existing image task",
        )
    ):
        return "request", None
    return "availability", None


def report_request_failure(exc):
    error_class, status = classify_error(exc)
    print(
        json.dumps(
            {
                "ok": False,
                "error_class": error_class,
                "http_status": status,
                "error": str(exc)[:2000],
                "hint": "Before task acceptance, availability may be retried with a new preset check. After task acceptance, resume the saved job and never POST again.",
            },
            ensure_ascii=False,
        )
    )
    return 3


def report_pending_task(exc, request_id, task_id, job_path, preset_check, state="pending"):
    if state == "active_elsewhere":
        retry_action = "wait_for_the_active_invocation_to_finish_then_read_or_resume_the_saved_job"
    elif task_id:
        retry_action = "rerun_the_same_command_with_the_same_preset_check_file"
    else:
        retry_action = "do_not_retry_automatically_request_an_explicit_fresh_attempt_if_recovery_is_needed"
    print(
        json.dumps(
            {
                "ok": False,
                "pending": True,
                "state": state,
                "error_class": "availability",
                "error": str(exc)[:2000],
                "request_id": request_id,
                "task_id": task_id,
                "job_file": str(job_path),
                "preset_check": preset_check_summary(preset_check),
                "safe_to_resubmit": False,
                "retry_action": retry_action,
            },
            ensure_ascii=False,
        )
    )
    return 0


def report_terminal_task(
    exc,
    request_id,
    task_id,
    job_path,
    preset_check,
    model=None,
    allow_model_fallback=False,
    provider_fallback_only=False,
    strict_edit=False,
):
    if provider_fallback_only and model == GPT_IMAGE_BASE_MODEL:
        fallback_models = [GPT_IMAGE_1K_MODEL]
    else:
        fallback_models = fallback_models_after(model)
    fallback_reason = (
        "explicit_terminal_timeout"
        if is_explicit_terminal_timeout(exc)
        else "authoritative_retryable_route_exhaustion"
        if task_id is None and is_authoritative_retryable_route_exhaustion(exc)
        else "authoritative_pre_provider_route_failure"
        if task_id is None and is_authoritative_pre_provider_route_failure(exc)
        else None
    )
    fallback_allowed = bool(
        allow_model_fallback
        and fallback_models
        and fallback_reason
    )
    machine_error = machine_error_from_exception(exc)
    print(
        json.dumps(
            {
                "ok": False,
                "pending": False,
                "state": "failed",
                "error_class": "availability",
                "error": str(exc)[:2000],
                "request_id": request_id,
                "task_id": task_id,
                "job_file": str(job_path),
                "preset_check": preset_check_summary(preset_check),
                "safe_to_resubmit": fallback_allowed,
                "fallback_allowed": fallback_allowed,
                "fallback_model": fallback_models[0] if fallback_allowed else None,
                "fallback_models": fallback_models if fallback_allowed else [],
                "fallback_reason": fallback_reason if fallback_allowed else None,
                "fallback_blocked_reason": (
                    (
                        "strict_edit_reference_task_unavailable"
                        if model == GPT_IMAGE_1K_MODEL
                        else "strict_edit_requires_fidelity_preserving_images_edits_route"
                    )
                    if strict_edit and fallback_reason and not fallback_allowed
                    else None
                ),
                "machine_error": machine_error,
                "retry_action": (
                    "create_a_new_preset_check_and_retry_with_the_next_fallback_model"
                    if fallback_allowed
                    else "create_a_new_preset_check_only_after_an_explicit_user_retry"
                ),
            },
            ensure_ascii=False,
        )
    )
    return 3


if __name__ == "__main__":
    raise SystemExit(main())
