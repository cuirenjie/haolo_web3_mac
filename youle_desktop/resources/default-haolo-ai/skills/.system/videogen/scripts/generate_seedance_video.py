#!/usr/bin/env python3
"""Video generation via the Haolo subapi async media task API.

Flow: Grok 1.5 uses POST {base}/videos -> task id -> GET {base}/videos/{task_id}.
Legacy compatibility models retain the relay media-task endpoints.

Default base: https://haolo.pro/v1
Default video model: grok-imagine-video-1.5
Credentials: LLMHUB_API_KEY, SUB2API_API_KEY, or OPENAI_API_KEY injected by
haolo_desktop after login.
"""

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

DEFAULT_BASE_URL = "https://haolo.pro/v1"
VIDEO_MODEL = "grok-imagine-video-1.5"
LEGACY_VIDEO_MODELS = {
    "grok-imagine-video-1.5-preview",
    "aihubcc/grok-imagine-video-1.5-preview",
}
GROK_RELAY_MODEL = "aihubcc/grok-video-3.5"
VIDEO_FALLBACK_CHAIN = (
    VIDEO_MODEL,
    GROK_RELAY_MODEL,
    "omni-fast-no-water",
)
SEEDANCE_RELAY_MODEL = "bytedance/seedance-2.0"
OMNI_RELAY_MODEL = "omni_flash-10s"
SEEDANCE_MODELS = {
    "Seedance-2.0-480p",
    "Seedance-2.0-720p",
    "Seedance-2.0-1080p",
    "Seedance-2.0-mini-480p",
    "Seedance-2.0-mini-720p",
}
OMNI_IMAGE_MODEL = "omni-fast-no-water"
OMNI_VIDEO_MODEL = "omni-fast-v2v-no-water"
DOCUMENTED_MODELS = SEEDANCE_MODELS | {
    VIDEO_MODEL,
    GROK_RELAY_MODEL,
    OMNI_IMAGE_MODEL,
    OMNI_VIDEO_MODEL,
}
SUPPORTED_MODELS = {
    *DOCUMENTED_MODELS,
    OMNI_RELAY_MODEL,
    SEEDANCE_RELAY_MODEL,
}
MODEL_ALIASES = {
    "grok-video-3.5": GROK_RELAY_MODEL,
    **{model: VIDEO_MODEL for model in LEGACY_VIDEO_MODELS},
}
BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)
TERMINAL_FAILURE = {"failed", "error", "cancelled", "canceled", "expired"}
AVAILABILITY_HTTP = {429, 500, 502, 503, 504}
RETRYABLE_ROUTE_EXHAUSTION_CODES = {
    "UPSTREAM_TEMPORARILY_UNAVAILABLE",
    "UPSTREAM_RATE_LIMITED",
    "UPSTREAM_OVERLOADED",
    "UPSTREAM_TIMEOUT",
}
ASPECT_RATIOS = {
    "16:9",
    "9:16",
    "1:1",
    "3:2",
    "2:3",
    "3:4",
    "4:3",
    "21:9",
    "9:21",
    "4:7",
    "7:4",
}
RESOLUTIONS = {"1080p", "720p", "480p"}
MODEL_OPTIONS = {
    VIDEO_MODEL: {
        "durations": {str(value) for value in range(1, 16)},
        "aspect_ratios": {"16:9", "9:16", "1:1", "4:3", "3:4", "2:3", "3:2"},
        "resolutions": {"720p", "480p"},
    },
    GROK_RELAY_MODEL: {
        "durations": {str(value) for value in range(1, 16)},
        "aspect_ratios": {"16:9", "9:16", "1:1", "3:2", "2:3"},
        "resolutions": {"720p", "480p"},
    },
    "Seedance-2.0-480p": {
        "durations": {str(value) for value in range(4, 16)},
        "aspect_ratios": {"16:9", "9:16", "1:1", "21:9", "3:4", "4:3"},
        "resolutions": {"480p"},
    },
    "Seedance-2.0-720p": {
        "durations": {str(value) for value in range(4, 16)},
        "aspect_ratios": {"16:9", "9:16", "1:1", "21:9", "3:4", "4:3"},
        "resolutions": {"720p"},
    },
    "Seedance-2.0-1080p": {
        "durations": {str(value) for value in range(4, 16)},
        "aspect_ratios": {"16:9", "9:16", "1:1", "21:9", "3:4", "4:3"},
        "resolutions": {"1080p"},
    },
    "Seedance-2.0-mini-480p": {
        "durations": {str(value) for value in range(4, 16)},
        "aspect_ratios": {"16:9", "9:16", "1:1", "21:9", "3:4", "4:3"},
        "resolutions": {"480p"},
    },
    "Seedance-2.0-mini-720p": {
        "durations": {str(value) for value in range(4, 16)},
        "aspect_ratios": {"16:9", "9:16", "1:1", "21:9", "3:4", "4:3"},
        "resolutions": {"720p"},
    },
    OMNI_IMAGE_MODEL: {
        "durations": {"10"},
        "aspect_ratios": {"16:9", "9:16"},
        "resolutions": {"720p"},
    },
    OMNI_VIDEO_MODEL: {
        "durations": {"10"},
        "aspect_ratios": {"16:9", "9:16"},
        "resolutions": {"720p"},
    },
    "omni_flash-10s": {
        "durations": {"10"},
        "aspect_ratios": {"16:9", "9:16"},
        "resolutions": {"720p"},
    },
    "bytedance/seedance-2.0": {
        "durations": {str(value) for value in range(4, 16)},
        "aspect_ratios": {"1:1", "3:4", "9:16", "4:3", "16:9", "21:9", "9:21"},
        "resolutions": {"480p", "720p"},
    },
}
INPUT_MODE_IMAGE_TO_VIDEO = "image-to-video"
INPUT_MODE_TEXT_TO_VIDEO = "text-to-video"
INPUT_MODE_TEXT_OR_IMAGE = "text-or-image-to-video"
INPUT_MODE_FIRST_LAST_FRAME = "first-last-frame-to-video"
INPUT_MODE_VIDEO_TO_VIDEO = "video-to-video"
INPUT_MODE_MULTIMODAL = "multimodal-to-video"
CURL_STATUS_MARKER = "\n__HAOLO_HTTP_STATUS__:"
MEDIA_JOB_TTL_SECONDS = 24 * 60 * 60
MEDIA_JOB_SCHEMA = 1


class HttpStatusError(Exception):
    def __init__(self, code, body, url, headers=None):
        super().__init__(f"HTTP {code} from {url}")
        self.code = int(code)
        self.body = str(body or "")
        self.url = url
        try:
            payload = json.loads(self.body)
        except (TypeError, ValueError):
            payload = None
        self.response_payload = payload if isinstance(payload, dict) else None
        self.machine_error = extract_machine_error(self.response_payload, headers)

    def read(self):
        return self.body.encode("utf-8", "replace")


class TransportError(Exception):
    def __init__(self, reason):
        super().__init__(str(reason))
        self.reason = str(reason)


class MissingTaskIdError(RuntimeError):
    def __init__(self, response_payload):
        self.response_payload = (
            response_payload if isinstance(response_payload, dict) else {}
        )
        super().__init__(
            "submit response had no task_id: "
            + json.dumps(self.response_payload, ensure_ascii=False)[:2000]
        )


class VideoTaskPendingError(RuntimeError):
    def __init__(self, message, response_payload=None):
        super().__init__(message)
        self.response_payload = response_payload


class VideoTaskTerminalError(RuntimeError):
    def __init__(self, message, response_payload=None):
        super().__init__(message)
        self.response_payload = response_payload
        self.machine_error = extract_machine_error(response_payload)


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


def is_authoritative_retryable_route_exhaustion(exc):
    machine_error = machine_error_from_exception(exc) or {}
    status = optional_int(getattr(exc, "code", None))
    upstream_status = optional_int(machine_error.get("upstream_status"))
    return bool(
        str(machine_error.get("code") or "").upper()
        in RETRYABLE_ROUTE_EXHAUSTION_CODES
        and machine_error.get("retryable") is True
        and machine_error.get("route_exhausted") is True
        and (
            status in {408, 425, 429}
            or (isinstance(status, int) and 500 <= status < 600)
            or upstream_status in {408, 425, 429}
            or (isinstance(upstream_status, int) and 500 <= upstream_status < 600)
        )
    )


def is_media_catalog_policy_mismatch(exc, model):
    if model != OMNI_VIDEO_MODEL or optional_int(getattr(exc, "code", None)) != 403:
        return False
    machine_error = machine_error_from_exception(exc) or {}
    body = str(getattr(exc, "body", "") or "")
    return bool(
        str(machine_error.get("code") or "").upper() == "PERMISSION_DENIED"
        and str(machine_error.get("category") or "").lower() == "policy"
        and machine_error.get("retryable") is False
        and machine_error.get("route_exhausted") is False
        and optional_int(machine_error.get("upstream_status")) == 0
        and f'model \\"{model}\\" is not enabled for' in body
    )


def fallback_models_after(model):
    try:
        index = VIDEO_FALLBACK_CHAIN.index(model)
    except ValueError:
        return []
    return list(VIDEO_FALLBACK_CHAIN[index + 1 :])


def configured_fallback_models(args, model):
    if args.provider_fallback_only:
        return [GROK_RELAY_MODEL] if model == VIDEO_MODEL and args.image_url else []
    if args.exact_model:
        return []
    fallbacks = fallback_models_after(model)
    if model == VIDEO_MODEL and not args.image_url:
        fallbacks = [candidate for candidate in fallbacks if candidate != GROK_RELAY_MODEL]
    return fallbacks


def parse_args():
    parser = argparse.ArgumentParser(description="Generate a video through a Haolo subapi video model.")
    group = parser.add_mutually_exclusive_group(required=False)
    group.add_argument("--prompt", help="Video prompt text.")
    group.add_argument("--prompt-file", help="Path to a UTF-8 prompt file.")
    parser.add_argument(
        "--resume-latest",
        action="store_true",
        help="Resume the newest recoverable video for this user/conversation without submitting a new task.",
    )
    parser.add_argument(
        "--request-id",
        default=None,
        help="Stable client interaction ID used for idempotent local recovery.",
    )
    parser.add_argument(
        "--conversation-id",
        default=None,
        help="Desktop conversation ID used to recover a server-side task after restart.",
    )
    parser.add_argument(
        "--job-dir",
        default=".media-jobs/videogen",
        help="Directory for 24-hour local task journals.",
    )
    parser.add_argument("--output-dir", default="outputs/videos", help="Directory for the downloaded video.")
    parser.add_argument("--basename", default="video", help="Base filename without extension.")
    parser.add_argument("--mode", choices=["normal", "pro"], default="pro", help="Compatibility flag retained for older callers.")
    parser.add_argument("--model", default=None, help="Public subapi model. Bare upstream names are normalized.")
    parser.add_argument(
        "--exact-model",
        action="store_true",
        help="Preserve an explicit client/user model selection and disable automatic fallback metadata.",
    )
    parser.add_argument(
        "--provider-fallback-only",
        action="store_true",
        help=(
            "Keep selected AIHubCC Grok locked while allowing only the same-model "
            "Buming Grok provider fallback. Requires --exact-model."
        ),
    )
    parser.add_argument(
        "--image-url",
        action="append",
        default=[],
        help="Public reference image URL. Repeat for models that accept multiple images.",
    )
    parser.add_argument(
        "--first-frame-url",
        dest="image_url",
        action="append",
        help="Compatibility alias for --image-url.",
    )
    parser.add_argument("--last-frame-url", default=None, help="Public last-frame image URL for first/last-frame models.")
    parser.add_argument(
        "--video-url",
        action="append",
        default=[],
        help="Public source video URL. Repeat for video-to-video models.",
    )
    parser.add_argument(
        "--audio-url",
        action="append",
        default=[],
        help="Public reference audio URL. Seedance accepts at most one and requires a main image.",
    )
    parser.add_argument(
        "--input-mode",
        default=INPUT_MODE_TEXT_OR_IMAGE,
        help="Model input contract returned by the authenticated video capability catalog.",
    )
    parser.add_argument("--duration", default="6", help="Video duration supported by the selected model.")
    parser.add_argument("--aspect-ratio", default="16:9", help="Aspect ratio supported by the selected model.")
    parser.add_argument("--resolution", default="720p", help="Resolution supported by the selected model.")
    parser.add_argument("--size", default=None, help='Exact output size such as "1280x720".')
    parser.add_argument(
        "--base-url",
        default=None,
        help="Haolo subapi base URL, e.g. https://haolo.pro/v1. Defaults from LLMHUB_BASE_URL, SUB2API_BASE_URL, or the bundled gateway.",
    )
    parser.add_argument("--poll-interval", type=int, default=5, help="Seconds between status polls.")
    parser.add_argument("--timeout", type=int, default=900, help="Overall timeout in seconds incl. polling.")
    parser.add_argument("--dry-run", action="store_true", help="Print request payload without calling the API.")
    return parser.parse_args()


def read_prompt(args):
    if args.prompt_file:
        return Path(args.prompt_file).read_text(encoding="utf-8-sig").strip()
    return str(args.prompt or "").strip()


def configure_usage_correlation(args):
    request_id = str(
        args.request_id or os.environ.get("HAOLO_INTERACTION_ID") or ""
    ).strip()
    conversation_id = str(
        args.conversation_id or os.environ.get("HAOLO_CONVERSATION_ID") or ""
    ).strip()
    if request_id:
        os.environ["HAOLO_INTERACTION_ID"] = request_id
    if conversation_id:
        os.environ["HAOLO_CONVERSATION_ID"] = conversation_id
    return request_id, conversation_id


def media_job_path(job_dir, request_id):
    digest = hashlib.sha256(str(request_id).encode("utf-8")).hexdigest()
    return Path(job_dir) / f"{digest}.json"


def replace_job_file(source, destination):
    # Windows readers can briefly deny replacement; retry only this local write,
    # never the generation request or task ownership decision.
    for attempt in range(10):
        try:
            os.replace(source, destination)
            return
        except PermissionError as error:
            if getattr(error, "winerror", None) not in {5, 32, 33} or attempt == 9:
                raise
            time.sleep(0.02 * (attempt + 1))


def write_media_job(path, job):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = dict(job)
    payload["schema"] = MEDIA_JOB_SCHEMA
    payload["updated_at"] = time.time()
    temp_path = path.with_suffix(path.suffix + f".{os.getpid()}.tmp")
    temp_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    replace_job_file(temp_path, path)
    return payload


def load_media_job(path):
    try:
        value = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return None
    return value if isinstance(value, dict) else None


def prune_media_jobs(job_dir):
    cutoff = time.time() - MEDIA_JOB_TTL_SECONDS
    try:
        paths = list(Path(job_dir).glob("*.json"))
    except OSError:
        return
    for path in paths:
        try:
            if path.stat().st_mtime < cutoff:
                path.unlink()
        except OSError:
            pass


def latest_local_media_job(job_dir, conversation_id=None):
    candidates = []
    try:
        paths = Path(job_dir).glob("*.json")
    except OSError:
        return None, None
    for path in paths:
        job = load_media_job(path)
        if not job:
            continue
        if conversation_id and str(job.get("conversation_id") or "") != conversation_id:
            continue
        candidates.append((float(job.get("updated_at") or 0), path, job))
    if not candidates:
        return None, None
    _, path, job = max(candidates, key=lambda item: item[0])
    return path, job


def acquire_media_submit_lock(job_path, wait_seconds=135):
    lock_path = Path(str(job_path) + ".submit.lock")
    deadline = time.monotonic() + wait_seconds
    while time.monotonic() <= deadline:
        try:
            descriptor = os.open(
                lock_path,
                os.O_CREAT | os.O_EXCL | os.O_WRONLY,
                0o600,
            )
            os.write(descriptor, str(os.getpid()).encode("ascii"))
            return lock_path, descriptor
        except FileExistsError:
            try:
                if time.time() - lock_path.stat().st_mtime > wait_seconds:
                    lock_path.unlink()
                    continue
            except OSError:
                pass
            current = load_media_job(job_path)
            if current and (
                str(current.get("task_id") or "").strip()
                or current.get("state") == "completed"
            ):
                return lock_path, None
            time.sleep(0.25)
    fail(
        "Another process is still reconciling this video submission; no second task was submitted.",
        error_class="availability",
    )


def release_media_submit_lock(lock_path, descriptor):
    if descriptor is None:
        return
    try:
        os.close(descriptor)
    finally:
        try:
            Path(lock_path).unlink()
        except OSError:
            pass


def configure_text_output():
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure:
            try:
                reconfigure(encoding="utf-8", errors="replace")
            except (LookupError, OSError):
                pass


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


def normalize_base_url(base_url):
    clean = migrate_gateway_url(base_url)
    if not clean:
        return DEFAULT_BASE_URL
    lowered = clean.lower()
    if lowered == "https://haolo.pro":
        return DEFAULT_BASE_URL
    for suffix in ("/videos/generations", "/videos"):
        if lowered.endswith(suffix):
            return clean[: -len(suffix)]
    return clean


def load_json_object(path):
    try:
        value = json.loads(Path(path).read_text(encoding="utf-8-sig"))
    except (OSError, TypeError, ValueError):
        return {}
    return value if isinstance(value, dict) else {}


def saved_media_model_credential(model):
    candidates = []
    explicit = str(os.environ.get("HAOLO_MODEL_CREDENTIALS_FILE") or "").strip()
    if explicit:
        candidates.append(Path(explicit).expanduser())
    for root_name in ("HAOLO_AI_HOME", "CODEX_HOME"):
        root = str(os.environ.get(root_name) or "").strip()
        if root:
            candidates.append(Path(root).expanduser() / "auth.json")
    checked = set()
    for path in candidates:
        resolved = str(path.resolve())
        if resolved in checked:
            continue
        checked.add(resolved)
        auth = load_json_object(path)
        pools = auth.get("HAOLO_MEDIA_MODEL_CREDENTIALS")
        video_pool = pools.get("video_generation") if isinstance(pools, dict) else None
        if not isinstance(video_pool, dict):
            continue
        credential = video_pool.get(model)
        if not isinstance(credential, dict) and model == VIDEO_MODEL:
            for legacy_model in LEGACY_VIDEO_MODELS:
                credential = video_pool.get(legacy_model)
                if isinstance(credential, dict):
                    break
        if not isinstance(credential, dict) and model == GROK_RELAY_MODEL:
            credential = video_pool.get(VIDEO_MODEL)
        if isinstance(credential, dict) and str(credential.get("api_key") or "").strip():
            return credential
    return {}


def resolve_base_url(args, model=None):
    credential = saved_media_model_credential(model) if model else {}
    return normalize_base_url(
        args.base_url
        or os.environ.get("LLMHUB_BASE_URL")
        or os.environ.get("SUB2API_BASE_URL")
        or credential.get("base_url")
        or os.environ.get("TRANSIT_BASE_URL")
        or os.environ.get("MODEL_BASE_URL")
        or DEFAULT_BASE_URL
    )


def normalize_model(model):
    clean = str(model or "").strip()
    return MODEL_ALIASES.get(clean, clean)


def resolve_model(args):
    if args.model:
        model = normalize_model(args.model)
    else:
        model = VIDEO_MODEL
    if model not in SUPPORTED_MODELS:
        fail(f"unsupported video model: {model}", error_class="request")
    return model


def status_url(base_url, model, task_id):
    if model == VIDEO_MODEL:
        return f"{base_url}/videos/{urllib.parse.quote(str(task_id), safe='')}"
    query_values = {"task_id": str(task_id)}
    query = urllib.parse.urlencode(query_values)
    return f"{base_url}/media/status?{query}"


def submit_url(base_url, model):
    if model == VIDEO_MODEL:
        return f"{base_url}/videos"
    return f"{base_url}/videos/generations"


def status_url_template(base_url, model):
    if normalize_model(model) == VIDEO_MODEL:
        return f"{base_url}/videos/<TASK_ID>"
    return f"{base_url}/media/status?task_id=<TASK_ID>"


def media_jobs_url(base_url, conversation_id=None):
    query = {"limit": "50"}
    if conversation_id:
        query["conversation_id"] = conversation_id
    return f"{base_url}/media/jobs?{urllib.parse.urlencode(query)}"


def recover_server_job(base_url, api_key, conversation_id=None, request_id=None):
    response = http_json(
        media_jobs_url(base_url, conversation_id),
        api_key,
        timeout=60,
    )
    jobs = response.get("data") if isinstance(response, dict) else None
    if not isinstance(jobs, list):
        return None
    request_id = str(request_id or "").strip()
    usable = []
    for job in jobs:
        if not isinstance(job, dict) or not str(job.get("task_id") or "").strip():
            continue
        if request_id and str(job.get("interaction_id") or "").strip() != request_id:
            continue
        state = str(job.get("state") or "").strip().lower()
        if state in TERMINAL_FAILURE:
            continue
        usable.append(job)
    return usable[0] if usable else None


def resolve_api_key(model=None):
    if os.environ.get("LLMHUB_API_KEY"):
        return os.environ["LLMHUB_API_KEY"], "environment:LLMHUB_API_KEY"
    if os.environ.get("SUB2API_API_KEY"):
        return os.environ["SUB2API_API_KEY"], "environment:SUB2API_API_KEY"
    credential = saved_media_model_credential(model) if model else {}
    if str(credential.get("api_key") or "").strip():
        return str(credential["api_key"]).strip(), "haolo_business_model_pool"
    if os.environ.get("OPENAI_API_KEY"):
        return os.environ["OPENAI_API_KEY"], "environment:OPENAI_API_KEY"
    return None, "missing"


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
        for header, env_name in (
            ("X-Haolo-Model-Pool", "HAOLO_MODEL_POOL"),
            ("X-Haolo-Model-Capability", "HAOLO_MODEL_CAPABILITY"),
        ):
            value = str(os.environ.get(env_name) or "").strip()
            if value:
                headers[header] = value
    return headers


def fail(message, detail=None, error_class=None, **fields):
    payload = {"ok": False, "error": message}
    if error_class:
        payload["error_class"] = error_class
    if detail:
        payload["detail"] = detail
    payload.update(fields)
    print(json.dumps(payload, ensure_ascii=False))
    sys.exit(1)


def closest_omni_aspect_ratio(aspect_ratio):
    return "9:16" if aspect_ratio in {"9:16", "2:3", "3:4", "4:7", "9:21"} else "16:9"


def fallback_adjustments(args, fallback_model):
    if fallback_model == GROK_RELAY_MODEL:
        return {
            "model": fallback_model,
            "input_mode": INPUT_MODE_IMAGE_TO_VIDEO,
            "duration": "15",
            "aspect_ratio": (
                args.aspect_ratio
                if args.aspect_ratio in MODEL_OPTIONS[GROK_RELAY_MODEL]["aspect_ratios"]
                else closest_omni_aspect_ratio(args.aspect_ratio)
            ),
            "resolution": (
                args.resolution
                if args.resolution in MODEL_OPTIONS[GROK_RELAY_MODEL]["resolutions"]
                else "720p"
            ),
            "size": None,
        }
    if fallback_model == OMNI_IMAGE_MODEL:
        return {
            "model": fallback_model,
            "input_mode": INPUT_MODE_TEXT_OR_IMAGE,
            "duration": "10",
            "aspect_ratio": closest_omni_aspect_ratio(args.aspect_ratio),
            "resolution": "720p",
            "size": None,
        }
    return {"model": fallback_model}


def fallback_failure_fields(args, model, reason, task_id=None, machine_error=None):
    fallback_models = configured_fallback_models(args, model)
    fallback_allowed = bool(
        not args.resume_latest
        and fallback_models
        and reason
    )
    fallback_model = fallback_models[0] if fallback_allowed else None
    return {
        "pending": False,
        "state": "failed",
        "task_id": task_id or None,
        "safe_to_resubmit": fallback_allowed,
        "fallback_allowed": fallback_allowed,
        "fallback_model": fallback_model,
        "fallback_models": fallback_models if fallback_allowed else [],
        "fallback_reason": reason if fallback_allowed else None,
        "fallback_adjustments": (
            fallback_adjustments(args, fallback_model)
            if fallback_model
            else None
        ),
        "machine_error": machine_error,
        "retry_action": (
            "create_a_new_request_id_and_retry_with_the_next_fallback_model"
            if fallback_allowed
            else "retry_only_after_an_explicit_user_request"
        ),
    }


def fail_submit_with_fallback(
    args,
    model,
    journal,
    job_path,
    request_id,
    message,
    detail=None,
    http_status=None,
    machine_error=None,
):
    fallback_reason = "submit_without_task_id"
    journal.update(
        {
            "state": "failed",
            "terminal": True,
            "acceptance_ambiguous": True,
            "duplicate_risk_accepted": True,
            "error": message,
            "detail": detail or "",
            "error_class": "availability",
            "fallback_reason": fallback_reason,
        }
    )
    if http_status is not None:
        journal["http_status"] = int(http_status)
    if machine_error:
        journal["machine_error"] = machine_error
    write_media_job(job_path, journal)
    fail(
        message,
        detail=detail,
        error_class="availability",
        model=model,
        request_id=request_id,
        acceptance_ambiguous=True,
        duplicate_risk_accepted=True,
        **fallback_failure_fields(
            args,
            model,
            fallback_reason,
            machine_error=machine_error,
        ),
    )


def build_opener():
    if os.environ.get("HAOLO_GEN_USE_PROXY") == "1":
        return urllib.request.build_opener()
    return urllib.request.build_opener(urllib.request.ProxyHandler({}))


OPENER = None


def get_opener():
    global OPENER
    if OPENER is None:
        OPENER = build_opener()
    return OPENER


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
            fail("HAOLO_GEN_HTTP_TRANSPORT=curl was requested, but curl was not found", error_class="availability")
        return "curl"
    if os.name == "nt" and resolve_curl_executable():
        return "curl"
    return "urllib"


def normalize_duration(value):
    try:
        duration = int(str(value).strip())
    except ValueError:
        fail('duration must be a positive integer string', error_class="request")
    if duration < 1 or duration > 60:
        fail('duration must be between "1" and "60"', error_class="request")
    return str(duration)


def normalize_aspect_ratio(value):
    clean = str(value or "").strip()
    if clean not in ASPECT_RATIOS:
        fail("aspect_ratio is not recognized", error_class="request")
    return clean


def normalize_resolution(value):
    clean = str(value or "").strip().lower()
    if clean not in RESOLUTIONS:
        fail("resolution must be one of 1080p, 720p, or 480p", error_class="request")
    return clean


def normalize_input_mode(value):
    mode = str(value or "").strip().lower().replace("_", "-").replace(" ", "-")
    if mode in {
        "multimodal-to-video",
        "all-reference-to-video",
        "mixed-media-to-video",
    }:
        return INPUT_MODE_MULTIMODAL
    if mode in {"video-to-video", "v2v"} or (
        mode.startswith("video") and mode.endswith("video")
    ):
        return INPUT_MODE_VIDEO_TO_VIDEO
    if (
        ("first" in mode or "start" in mode)
        and ("last" in mode or "end" in mode)
    ):
        return INPUT_MODE_FIRST_LAST_FRAME
    if mode in {"text-or-image-to-video", "text-image-to-video"} or (
        ("text" in mode or "prompt" in mode)
        and "image" in mode
        and "video" in mode
    ):
        return INPUT_MODE_TEXT_OR_IMAGE
    if mode in {"text", "text-only", "t2v"} or (
        ("text" in mode or "prompt" in mode) and "video" in mode
    ):
        return INPUT_MODE_TEXT_TO_VIDEO
    return INPUT_MODE_IMAGE_TO_VIDEO


def validate_public_urls(values, option_name):
    urls = []
    for value in values or []:
        clean = str(value or "").strip()
        if not clean:
            continue
        parsed = urllib.parse.urlparse(clean)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            fail(f"{option_name} must be a public http(s) URL", error_class="request")
        if clean not in urls:
            urls.append(clean)
    return urls


def video_input_urls(args):
    input_mode = normalize_input_mode(args.input_mode)
    image_urls = validate_public_urls(args.image_url, "--image-url")
    image_urls.extend(
        url
        for url in validate_public_urls([args.last_frame_url], "--last-frame-url")
        if url not in image_urls
    )
    video_urls = validate_public_urls(args.video_url, "--video-url")
    audio_urls = validate_public_urls(args.audio_url, "--audio-url")
    if input_mode == INPUT_MODE_TEXT_TO_VIDEO:
        if image_urls or video_urls or audio_urls:
            fail("text-to-video generation does not accept reference media", error_class="request")
        return input_mode, [], [], []
    if input_mode == INPUT_MODE_TEXT_OR_IMAGE:
        if video_urls or audio_urls:
            fail("text-or-image generation does not accept source videos", error_class="request")
        return input_mode, image_urls, [], []
    if input_mode == INPUT_MODE_FIRST_LAST_FRAME:
        if len(image_urls) != 2 or video_urls or audio_urls:
            fail("first/last-frame generation requires exactly two image URLs", error_class="request")
        return input_mode, image_urls, [], []
    if input_mode == INPUT_MODE_VIDEO_TO_VIDEO:
        if image_urls or audio_urls or not 1 <= len(video_urls) <= 2:
            fail("video-to-video generation requires one or two source video URLs", error_class="request")
        return input_mode, [], video_urls, []
    if input_mode == INPUT_MODE_MULTIMODAL:
        return input_mode, image_urls, video_urls, audio_urls
    if len(image_urls) != 1 or video_urls or audio_urls:
        fail("image-to-video generation requires exactly one public image URL", error_class="request")
    return input_mode, image_urls, [], []


def bind_seedance_image_references(prompt, input_mode, image_count):
    if image_count <= 0 or input_mode == INPUT_MODE_FIRST_LAST_FRAME:
        return prompt
    tokens = [f"@image{index}" for index in range(1, image_count + 1)]
    lowered_prompt = prompt.lower()
    if all(token in lowered_prompt for token in tokens):
        return prompt
    if image_count == 1:
        binding = (
            "Use @image1 as the source visual and primary subject reference. "
            "Preserve its subject identity, face, clothing, objects, composition, "
            "and environment unless the following instructions explicitly request a change."
        )
    else:
        binding = (
            f"Use {', '.join(tokens)} as the visual references, with @image1 as the "
            "primary subject reference. Preserve the referenced identities, appearances, "
            "objects, and environments unless the following instructions explicitly request a change."
        )
    return f"{binding}\n\n{prompt}"


def build_payload(args, model, prompt):
    input_mode, image_urls, video_urls, audio_urls = video_input_urls(args)
    duration = normalize_duration(args.duration)
    aspect_ratio = normalize_aspect_ratio(args.aspect_ratio)
    resolution = normalize_resolution(args.resolution)
    validate_model_options(model, duration, aspect_ratio, resolution)
    size = str(args.size or "").strip()
    params = {
        "aspect_ratio": aspect_ratio,
        "resolution": resolution,
        "duration": duration,
    }
    if image_urls:
        params["images"] = image_urls
    if size:
        params["size"] = size
    if model in SEEDANCE_MODELS:
        prompt = bind_seedance_image_references(prompt, input_mode, len(image_urls))
        if len(prompt) > 5000:
            fail(f"{model} prompt accepts at most 5000 characters", error_class="request")
        if len(image_urls) > 4:
            fail(
                f"{model} currently accepts at most four reference images",
                error_class="request",
            )
        if len(video_urls) > 3:
            fail(
                f"{model} currently accepts at most three reference videos",
                error_class="request",
            )
        if len(audio_urls) > 1:
            fail(
                f"{model} currently accepts at most one reference audio",
                error_class="request",
            )
        if (video_urls or audio_urls) and not image_urls:
            fail(
                f"{model} reference video or audio requires at least one main image",
                error_class="request",
            )
        payload = {
            "model": model,
            "prompt": prompt,
            "aspect_ratio": aspect_ratio,
            "duration": int(duration),
        }
        if image_urls:
            if input_mode == INPUT_MODE_FIRST_LAST_FRAME:
                payload["first_image_url"] = image_urls[0]
                payload["last_image_url"] = image_urls[1]
            else:
                payload["reference_image_urls"] = image_urls
        if video_urls:
            payload["reference_videos"] = video_urls
        if audio_urls:
            payload["reference_audios"] = audio_urls
        return payload
    if model == GROK_RELAY_MODEL:
        if len(prompt) > 4500:
            fail(f"{model} prompt accepts at most 4500 characters", error_class="request")
        if len(image_urls) != 1 or video_urls or audio_urls:
            fail(f"{model} requires exactly one reference image", error_class="request")
        return {
            "model": model,
            "prompt": prompt,
            "params": {
                "images": image_urls,
                "aspect_ratio": aspect_ratio,
                "resolution": resolution,
                "duration": int(duration),
            },
        }
    if model == VIDEO_MODEL:
        if len(image_urls) > 1 or video_urls or audio_urls:
            fail(f"{model} accepts at most one reference image", error_class="request")
        payload = {
            "model": model,
            "prompt": prompt,
            "seconds": duration,
            "aspect_ratio": aspect_ratio,
            "resolution": resolution,
        }
        if image_urls:
            payload["image"] = image_urls[0]
        return payload
    if model == OMNI_IMAGE_MODEL:
        if video_urls or audio_urls:
            fail(f"{model} accepts reference images only", error_class="request")
        if len(image_urls) > 5:
            fail(
                f"{model} accepts at most five reference images",
                error_class="request",
            )
        payload = {
            "model": model,
            "prompt": prompt,
            "aspect_ratio": aspect_ratio,
            "duration": int(duration),
        }
        if image_urls:
            payload["images"] = image_urls
        return payload
    if model == OMNI_VIDEO_MODEL:
        if image_urls or audio_urls or not 1 <= len(video_urls) <= 2:
            fail(f"{model} requires one or two reference videos", error_class="request")
        return {
            "model": model,
            "prompt": prompt,
            "aspect_ratio": aspect_ratio,
            "duration": int(duration),
            "videos": video_urls,
        }
    if model == "bytedance/seedance-2.0":
        payload = {
            "model": model,
            "prompt": prompt,
            "aspect_ratio": aspect_ratio,
            "resolution": resolution,
            "duration": int(duration),
            "input_references": [
                {
                    "type": "image_url",
                    "image_url": {"url": image_url},
                }
                for image_url in image_urls
            ],
        }
        if not image_urls:
            payload.pop("input_references")
        if size:
            payload["size"] = size
        return payload
    if model == "omni_flash-10s":
        payload = {
            "model": model,
            "prompt": prompt,
            "size": size,
            "duration": int(duration),
        }
        if image_urls:
            payload["images"] = image_urls
        return payload
    payload = {
        "model": model,
        "prompt": prompt,
        "aspect_ratio": aspect_ratio,
        "resolution": resolution,
        "duration": int(duration),
        **({"size": size} if size else {}),
        "params": params,
    }
    if image_urls:
        payload["images"] = image_urls
    return payload


def validate_model_options(model, duration, aspect_ratio, resolution):
    options = MODEL_OPTIONS.get(model) or {}
    if duration not in options.get("durations", set()):
        fail(
            f"duration {duration} is not supported by {model}",
            error_class="request",
        )
    if aspect_ratio not in options.get("aspect_ratios", set()):
        fail(
            f"aspect_ratio {aspect_ratio} is not supported by {model}",
            error_class="request",
        )
    if resolution not in options.get("resolutions", set()):
        fail(
            f"resolution {resolution} is not supported by {model}",
            error_class="request",
        )


def http_json(
    url,
    api_key,
    payload=None,
    timeout=60,
    include_media_routing=True,
):
    if resolve_http_transport() == "curl":
        return curl_json(
            url,
            api_key,
            payload=payload,
            timeout=timeout,
            include_media_routing=include_media_routing,
        )
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    headers.update(haolo_usage_headers(include_media_routing=include_media_routing))
    request = urllib.request.Request(
        url,
        data=data,
        method="POST" if payload is not None else "GET",
        headers=headers,
    )
    try:
        with get_opener().open(request, timeout=timeout) as response:
            body = response.read().decode("utf-8", "replace")
            try:
                return json.loads(body or "{}")
            except json.JSONDecodeError as exc:
                raise TransportError(
                    f"HTTP response was not JSON: {body[:1000]}"
                ) from exc
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")
        raise HttpStatusError(exc.code, body, url, headers=exc.headers) from exc


def submit_video_job(url, api_key, payload, model):
    include_media_routing = model != GROK_RELAY_MODEL
    try:
        return http_json(
            url,
            api_key,
            payload=payload,
            timeout=120,
            include_media_routing=include_media_routing,
        )
    except (urllib.error.HTTPError, HttpStatusError) as error:
        # A catalog policy response with upstream_status=0 is rejected before any
        # provider task exists. Retry once with the same key and correlation IDs,
        # omitting only the optional pool/capability hints so the key's own media
        # group can perform its authoritative model routing.
        if include_media_routing and is_media_catalog_policy_mismatch(error, model):
            return http_json(
                url,
                api_key,
                payload=payload,
                timeout=120,
                include_media_routing=False,
            )
        raise


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


def curl_json(
    url,
    api_key,
    payload=None,
    timeout=60,
    include_media_routing=True,
):
    input_bytes = None
    args = curl_base_args(timeout)
    args.extend(["-H", f"Authorization: Bearer {api_key}", "-H", "Content-Type: application/json"])
    for name, value in haolo_usage_headers(
        include_media_routing=include_media_routing
    ).items():
        args.extend(["-H", f"{name}: {value}"])
    if payload is not None:
        input_bytes = json.dumps(payload).encode("utf-8")
        args.extend(["-X", "POST", "--data-binary", "@-"])
    args.extend(["--write-out", f"{CURL_STATUS_MARKER}%{{http_code}}", url])
    result = run_curl(args, input_bytes=input_bytes, timeout=timeout)
    body, status = split_curl_status(result.stdout)
    stderr = result.stderr.decode("utf-8", "replace").strip()
    if status and status >= 400:
        raise HttpStatusError(status, body, url)
    if result.returncode != 0:
        raise TransportError(stderr or body or f"curl exited with code {result.returncode}")
    if not status or status == 0:
        raise TransportError(stderr or body or "curl did not return an HTTP status")
    try:
        return json.loads(body or "{}")
    except json.JSONDecodeError as exc:
        raise TransportError(
            f"HTTP response was not JSON: {(body or stderr)[:1000]}"
        ) from exc


def classify_http(code):
    if code in AVAILABILITY_HTTP:
        return "availability"
    if code in (401, 403):
        return "auth"
    return "request"


def extract_task_id(response_body):
    code = response_body.get("code")
    if code not in (None, 200, "200"):
        fail(f"submit response code was {code}", detail=json.dumps(response_body, ensure_ascii=False)[:2000], error_class="request")

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
    raise MissingTaskIdError(response_body)


def resolve_status_url(base_url, model, task_id, job):
    polling_url = str(job.get("polling_url") or "").strip()
    if polling_url:
        return migrate_gateway_url(
            urllib.parse.urljoin(base_url.rstrip("/") + "/", polling_url),
            preserve_query=True,
        )
    return status_url(base_url, model, task_id)


def video_result_url(status_body):
    raw_data = status_body.get("data")
    data = raw_data if isinstance(raw_data, dict) else {}
    first_data = (
        raw_data[0]
        if isinstance(raw_data, list)
        and raw_data
        and isinstance(raw_data[0], dict)
        else {}
    )
    unsigned_urls = status_body.get("unsigned_urls")
    data_unsigned_urls = data.get("unsigned_urls")
    first_data_unsigned_urls = first_data.get("unsigned_urls")
    candidates = [
        unsigned_urls[0] if isinstance(unsigned_urls, list) and unsigned_urls else None,
        data_unsigned_urls[0] if isinstance(data_unsigned_urls, list) and data_unsigned_urls else None,
        (
            first_data_unsigned_urls[0]
            if isinstance(first_data_unsigned_urls, list)
            and first_data_unsigned_urls
            else None
        ),
        first_data.get("video_url"),
        first_data.get("result_url"),
        first_data.get("url"),
        first_data.get("content_url"),
        data.get("video_url"),
        data.get("result_url"),
        data.get("url"),
        data.get("content_url"),
        status_body.get("video_url"),
        status_body.get("result_url"),
        status_body.get("url"),
        status_body.get("content_url"),
    ]
    return next((str(value).strip() for value in candidates if str(value or "").strip()), "")


def video_result_state(status_body):
    raw_data = status_body.get("data")
    data = raw_data if isinstance(raw_data, dict) else {}
    first_data = (
        raw_data[0]
        if isinstance(raw_data, list)
        and raw_data
        and isinstance(raw_data[0], dict)
        else {}
    )
    return str(
        status_body.get("state")
        or status_body.get("status")
        or data.get("state")
        or data.get("status")
        or first_data.get("state")
        or first_data.get("status")
        or ""
    ).lower()


def poll_result(base_url, api_key, model, task_id, job, timeout, poll_interval):
    deadline = time.monotonic() + timeout
    last_status = None
    poll_url = resolve_status_url(base_url, model, task_id, job)
    while time.monotonic() <= deadline:
        try:
            current = http_json(
                poll_url,
                api_key,
                timeout=60,
                include_media_routing=model != GROK_RELAY_MODEL,
            )
        except (urllib.error.HTTPError, HttpStatusError) as error:
            if error.code == 404:
                fail(
                    f"task {task_id} is no longer in the 24-hour recovery cache",
                    detail=error.read().decode("utf-8", "replace")[:1000],
                    error_class="request",
                )
            if classify_http(error.code) == "availability":
                raise VideoTaskPendingError(
                    f"HTTP {error.code} while polling task {task_id}",
                    response_payload=getattr(error, "response_payload", None),
                ) from error
            fail(
                f"HTTP {error.code} while polling task {task_id}",
                detail=error.read().decode("utf-8", "replace")[:1000],
                error_class=classify_http(error.code),
            )
        except (urllib.error.URLError, TransportError):
            time.sleep(poll_interval)
            continue

        last_status = current
        state = video_result_state(current)
        result_url = video_result_url(current)
        if result_url:
            result_url = urllib.parse.urljoin(base_url.rstrip("/") + "/", result_url)
        successful_states = {"completed"} if model == VIDEO_MODEL else {"success", "completed"}
        if current.get("is_final") is True:
            if state in successful_states and result_url:
                return {**current, "state": state, "result_url": result_url}
            raise VideoTaskTerminalError(
                f"task {task_id} ended as '{state or 'unknown'}'",
                response_payload=current,
            )
        if state in successful_states and result_url:
            return {**current, "state": state, "result_url": result_url}
        if state in TERMINAL_FAILURE:
            raise VideoTaskTerminalError(
                f"task {task_id} ended as '{state}'",
                response_payload=current,
            )
        time.sleep(poll_interval)
    raise VideoTaskPendingError(
        f"timed out after {timeout}s; task {task_id} is not final",
        response_payload=last_status,
    )


def download_video(video_url, api_key, base_url, output_dir, basename):
    video_url = migrate_gateway_url(video_url, preserve_query=True)
    base_url = normalize_base_url(base_url)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    out_path = output_dir / f"{basename}.mp4"
    headers = {"User-Agent": BROWSER_UA}
    if urllib.parse.urlparse(video_url).netloc == urllib.parse.urlparse(base_url).netloc:
        headers["Authorization"] = f"Bearer {api_key}"
    if resolve_http_transport() == "curl":
        return download_video_curl(video_url, headers, out_path)
    request = urllib.request.Request(video_url, headers=headers)
    temp_path = out_path.with_suffix(out_path.suffix + f".{os.getpid()}.part")
    try:
        with get_opener().open(request, timeout=300) as response:
            first = response.read(1 << 16)
            if first.lstrip()[:1] in (b"{", b"["):
                fail("content endpoint returned JSON instead of video bytes", detail=first.decode("utf-8", "replace")[:500], error_class="request")
            with open(temp_path, "wb") as fh:
                fh.write(first)
                while True:
                    chunk = response.read(1 << 16)
                    if not chunk:
                        break
                    fh.write(chunk)
            os.replace(temp_path, out_path)
    except (urllib.error.HTTPError, urllib.error.URLError) as error:
        try:
            temp_path.unlink(missing_ok=True)
        except OSError:
            pass
        fail(f"download failed: {error}", detail=video_url, error_class="availability")
    return str(out_path)


def download_video_curl(video_url, headers, out_path):
    temp_path = out_path.with_suffix(out_path.suffix + f".{os.getpid()}.part")
    try:
        temp_path.unlink(missing_ok=True)
    except OSError:
        pass
    args = curl_base_args(300)
    for name, value in headers.items():
        args.extend(["-H", f"{name}: {value}"])
    args.extend(["-o", str(temp_path), "--write-out", f"{CURL_STATUS_MARKER}%{{http_code}}", video_url])
    result = run_curl(args, timeout=300)
    _, status = split_curl_status(result.stdout)
    stderr = result.stderr.decode("utf-8", "replace").strip()
    if result.returncode != 0 or not status or status >= 400:
        detail = ""
        try:
            detail = temp_path.read_text(encoding="utf-8", errors="replace")[:1000]
        except OSError:
            detail = stderr
        fail(
            f"download failed: HTTP {status or 'unknown'}",
            detail=detail or video_url,
            error_class="availability" if not status or status in AVAILABILITY_HTTP else "request",
        )
    try:
        first = temp_path.read_bytes()[: 1 << 16]
        if first.lstrip()[:1] in (b"{", b"["):
            fail("content endpoint returned JSON instead of video bytes", detail=first.decode("utf-8", "replace")[:500], error_class="request")
        temp_path.replace(out_path)
    except OSError as exc:
        fail(f"download failed: {exc}", detail=video_url, error_class="availability")
    return str(out_path)


def main():
    configure_text_output()
    args = parse_args()
    request_id, conversation_id = configure_usage_correlation(args)
    prune_media_jobs(args.job_dir)
    credential_model = normalize_model(args.model or VIDEO_MODEL)
    base_url = resolve_base_url(args, credential_model)
    api_key, credential_source = resolve_api_key(credential_model)

    if args.resume_latest and args.dry_run:
        print(
            json.dumps(
                {
                    "ok": True,
                    "dry_run": True,
                    "http_transport": resolve_http_transport(),
                    "status_url_template": status_url_template(base_url, args.model or VIDEO_MODEL),
                    "credential_source": credential_source,
                    "resume_latest": True,
                    "request_id": request_id or None,
                    "conversation_id": conversation_id or None,
                },
                ensure_ascii=False,
            )
        )
        return

    if not api_key and not args.dry_run and not args.resume_latest:
        fail(
            "No API credential found. Set LLMHUB_API_KEY, SUB2API_API_KEY, or log in so haolo_desktop injects OPENAI_API_KEY.",
            error_class="auth",
        )

    job_path = None
    journal = None
    task_id = ""
    job = {}

    if args.resume_latest:
        job_path, journal = latest_local_media_job(args.job_dir, conversation_id)
        if journal:
            request_id = str(journal.get("request_id") or request_id or "").strip()
            if request_id:
                os.environ["HAOLO_INTERACTION_ID"] = request_id
            task_id = str(journal.get("task_id") or "").strip()
            credential_model = normalize_model(
                journal.get("model") or args.model or VIDEO_MODEL
            )
            base_url = resolve_base_url(args, credential_model)
            api_key, credential_source = resolve_api_key(credential_model)
        if not api_key:
            fail(
                "No API credential found for video recovery. Log in again and retry.",
                error_class="auth",
            )
        server_job = None
        if not task_id:
            try:
                server_job = recover_server_job(
                    base_url,
                    api_key,
                    conversation_id=conversation_id,
                    request_id=request_id or None,
                )
            except (urllib.error.HTTPError, HttpStatusError) as error:
                fail(
                    f"HTTP {error.code} while recovering the latest video",
                    detail=error.read().decode("utf-8", "replace")[:2000],
                    error_class=classify_http(error.code),
                )
            except (urllib.error.URLError, TransportError) as error:
                fail(
                    f"video recovery failed: {getattr(error, 'reason', error)}",
                    error_class="availability",
                )
            if not server_job and request_id:
                server_job = recover_server_job(
                    base_url,
                    api_key,
                    conversation_id=conversation_id,
                )
            if not server_job:
                fail(
                    "No recoverable video task was found in the 24-hour cache.",
                    error_class="request",
                )
            task_id = str(server_job.get("task_id") or "").strip()
            request_id = str(
                server_job.get("interaction_id")
                or request_id
                or f"recovered-{task_id}"
            ).strip()
            os.environ["HAOLO_INTERACTION_ID"] = request_id
            job_path = media_job_path(args.job_dir, request_id)
            journal = {
                "request_id": request_id,
                "conversation_id": str(
                    server_job.get("conversation_id") or conversation_id or ""
                ),
                "task_id": task_id,
                "model": str(server_job.get("model") or args.model or VIDEO_MODEL),
                "state": str(server_job.get("state") or "recovered"),
                "created_at": time.time(),
            }
            journal = write_media_job(job_path, journal)
            if server_job.get("cached") and server_job.get("result_url"):
                cached_result_url = urllib.parse.urljoin(
                    base_url.rstrip("/") + "/",
                    str(server_job["result_url"]),
                )
                status_body = {
                    "state": "completed",
                    "result_url": cached_result_url,
                }
            else:
                status_body = None
        else:
            status_body = None
        model = normalize_model(
            (journal or {}).get("model") or args.model or VIDEO_MODEL
        )
        base_url = resolve_base_url(args, model)
        api_key, credential_source = resolve_api_key(model)
        job = {"polling_url": (journal or {}).get("polling_url")}
    else:
        prompt = read_prompt(args)
        if not prompt:
            fail(
                "--prompt or --prompt-file is required unless --resume-latest is used.",
                error_class="request",
            )
        model = resolve_model(args)
        if args.provider_fallback_only and (
            not args.exact_model or model != VIDEO_MODEL
        ):
            fail(
                "--provider-fallback-only requires --exact-model "
                f"--model {VIDEO_MODEL}.",
                error_class="request",
            )
        base_url = resolve_base_url(args, model)
        api_key, credential_source = resolve_api_key(model)
        submission_url = submit_url(base_url, model)
        payload = build_payload(args, model, prompt)
        if args.dry_run:
            print(
                json.dumps(
                    {
                        "ok": True,
                        "dry_run": True,
                        "http_transport": resolve_http_transport(),
                        "submit_url": submission_url,
                        "status_url_template": status_url_template(base_url, model),
                        "input_mode": normalize_input_mode(args.input_mode),
                        "payload": payload,
                        "credential_source": credential_source,
                        "request_id": request_id or None,
                        "conversation_id": conversation_id or None,
                        "fallback_models": configured_fallback_models(args, model),
                    },
                    ensure_ascii=False,
                )
            )
            return

        request_id = request_id or str(uuid.uuid4())
        os.environ["HAOLO_INTERACTION_ID"] = request_id
        payload_hash = hashlib.sha256(
            json.dumps(
                payload,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        ).hexdigest()
        job_path = media_job_path(args.job_dir, request_id)
        journal = load_media_job(job_path)
        if journal and str(journal.get("payload_hash") or "") != payload_hash:
            fail(
                "The request ID is already bound to a different video payload.",
                detail=request_id,
                error_class="request",
            )
        if journal and journal.get("state") == "completed":
            saved = str(journal.get("saved") or "")
            if saved and Path(saved).is_file():
                print(json.dumps({"ok": True, **journal}, ensure_ascii=False))
                return
        if journal and journal.get("state") == "failed" and journal.get("terminal") is True:
            fallback_reason = str(journal.get("fallback_reason") or "").strip() or None
            machine_error = (
                journal.get("machine_error")
                if isinstance(journal.get("machine_error"), dict)
                else None
            )
            fail(
                str(journal.get("error") or "The saved video task is terminal."),
                detail=str(journal.get("detail") or "") or None,
                error_class=str(journal.get("error_class") or "request"),
                model=model,
                request_id=request_id,
                **fallback_failure_fields(
                    args,
                    model,
                    fallback_reason,
                    task_id=str(journal.get("task_id") or "").strip(),
                    machine_error=machine_error,
                ),
            )
        task_id = str((journal or {}).get("task_id") or "").strip()
        if journal and not task_id and journal.get("state") in {
            "submitting",
            "submit_ambiguous",
        }:
            recovered = recover_server_job(
                base_url,
                api_key,
                conversation_id=conversation_id,
                request_id=request_id,
            )
            if recovered:
                task_id = str(recovered.get("task_id") or "").strip()
                journal["task_id"] = task_id
                journal["state"] = str(recovered.get("state") or "recovered")
                journal = write_media_job(job_path, journal)
            else:
                fail_submit_with_fallback(
                    args,
                    model,
                    journal,
                    job_path,
                    request_id,
                    "The earlier submission still has no task ID; continue with the configured fallback.",
                    detail=request_id,
                )
        if not journal:
            journal = write_media_job(
                job_path,
                {
                    "request_id": request_id,
                    "conversation_id": conversation_id,
                    "model": model,
                    "exact_model": bool(args.exact_model),
                    "provider_fallback_only": bool(args.provider_fallback_only),
                    "payload_hash": payload_hash,
                    "state": "submitting",
                    "created_at": time.time(),
                    "output_dir": args.output_dir,
                    "basename": args.basename,
                },
            )
        if not task_id:
            lock_path, lock_descriptor = acquire_media_submit_lock(job_path)
            try:
                if lock_descriptor is None:
                    journal = load_media_job(job_path) or journal
                    task_id = str(journal.get("task_id") or "").strip()
                    if not task_id:
                        fail(
                            "The submission owner finished without a task ID; no second task was submitted.",
                            error_class="availability",
                        )
                    job = {"polling_url": journal.get("polling_url")}
                else:
                    latest = load_media_job(job_path) or journal
                    task_id = str(latest.get("task_id") or "").strip()
                    if task_id:
                        journal = latest
                        job = {"polling_url": journal.get("polling_url")}
                    else:
                        try:
                            job = submit_video_job(
                                submission_url,
                                api_key,
                                payload,
                                model,
                            )
                        except (urllib.error.HTTPError, HttpStatusError) as error:
                            detail = error.read().decode("utf-8", "replace")[:2000]
                            machine_error = machine_error_from_exception(error)
                            if is_authoritative_retryable_route_exhaustion(error):
                                journal.update(
                                    {
                                        "state": "failed",
                                        "accepted": False,
                                        "terminal": True,
                                        "error": f"HTTP {error.code}",
                                        "detail": detail,
                                        "error_class": "availability",
                                        "http_status": int(error.code),
                                        "machine_error": machine_error,
                                        "fallback_reason": "authoritative_retryable_route_exhaustion",
                                    }
                                )
                                journal = write_media_job(job_path, journal)
                                fail(
                                    f"HTTP {error.code} from {submission_url}",
                                    detail=detail,
                                    error_class="availability",
                                    model=model,
                                    request_id=request_id,
                                    **fallback_failure_fields(
                                        args,
                                        model,
                                        "authoritative_retryable_route_exhaustion",
                                        machine_error=machine_error,
                                    ),
                                )
                            if classify_http(error.code) == "availability":
                                fail_submit_with_fallback(
                                    args,
                                    model,
                                    journal,
                                    job_path,
                                    request_id,
                                    f"HTTP {error.code} from {submission_url}; continue with the configured fallback",
                                    detail=detail,
                                    http_status=error.code,
                                    machine_error=machine_error,
                                )
                            journal.update(
                                {
                                    "state": "failed",
                                    "accepted": False,
                                    "terminal": True,
                                    "error": f"HTTP {error.code}",
                                    "detail": detail,
                                    "error_class": classify_http(error.code),
                                    "http_status": int(error.code),
                                }
                            )
                            journal = write_media_job(job_path, journal)
                            fail(
                                f"HTTP {error.code} from {submission_url}",
                                detail=detail,
                                error_class=classify_http(error.code),
                                pending=False,
                                state="failed",
                                task_id=None,
                                safe_to_resubmit=False,
                                fallback_allowed=False,
                                fallback_model=None,
                                fallback_models=[],
                            )
                        except (urllib.error.URLError, TransportError) as error:
                            reason = str(getattr(error, "reason", error))
                            fail_submit_with_fallback(
                                args,
                                model,
                                journal,
                                job_path,
                                request_id,
                                f"submit returned no task ID: {reason}; continue with the configured fallback",
                                detail=reason,
                            )
                        try:
                            task_id = extract_task_id(job)
                        except MissingTaskIdError as error:
                            fail_submit_with_fallback(
                                args,
                                model,
                                journal,
                                job_path,
                                request_id,
                                "submit response had no task ID; continue with the configured fallback",
                                detail=json.dumps(
                                    error.response_payload,
                                    ensure_ascii=False,
                                )[:2000],
                                http_status=200,
                            )
                        journal["task_id"] = task_id
                        journal["polling_url"] = job.get("polling_url")
                        journal["state"] = "submitted"
                        journal = write_media_job(job_path, journal)
            finally:
                release_media_submit_lock(lock_path, lock_descriptor)
        else:
            job = {"polling_url": journal.get("polling_url")}
        status_body = None

    if args.dry_run:
        print(
            json.dumps(
                {
                    "ok": True,
                    "dry_run": True,
                    "http_transport": resolve_http_transport(),
                    "status_url_template": status_url_template(base_url, model),
                    "credential_source": credential_source,
                    "resume_latest": True,
                    "request_id": request_id or None,
                    "conversation_id": conversation_id or None,
                },
                ensure_ascii=False,
            )
        )
        return

    if status_body is None:
        try:
            status_body = poll_result(
                base_url,
                api_key,
                model,
                task_id,
                job,
                args.timeout,
                args.poll_interval,
            )
        except VideoTaskPendingError as error:
            if journal is not None and job_path is not None:
                journal.update(
                    {
                        "state": "pending",
                        "task_id": task_id,
                        "last_status": error.response_payload,
                        "error": str(error),
                    }
                )
                journal = write_media_job(job_path, journal)
            fail(
                str(error),
                detail=(
                    json.dumps(error.response_payload, ensure_ascii=False)[:2000]
                    if error.response_payload is not None
                    else None
                ),
                error_class="availability",
                pending=True,
                state="pending",
                model=model,
                task_id=task_id,
                request_id=request_id,
                safe_to_resubmit=False,
                safe_to_resume=True,
                fallback_allowed=False,
                fallback_model=None,
                fallback_models=[],
                retry_action="resume_the_same_request_id_without_another_post",
            )
        except VideoTaskTerminalError as error:
            machine_error = machine_error_from_exception(error)
            if journal is not None and job_path is not None:
                journal.update(
                    {
                        "state": "failed",
                        "terminal": True,
                        "task_id": task_id,
                        "last_status": error.response_payload,
                        "error": str(error),
                        "detail": (
                            json.dumps(error.response_payload, ensure_ascii=False)[:2000]
                            if error.response_payload is not None
                            else None
                        ),
                        "error_class": "request",
                        "machine_error": machine_error,
                        "fallback_reason": "explicit_terminal_failure",
                    }
                )
                journal = write_media_job(job_path, journal)
            fail(
                str(error),
                detail=(
                    json.dumps(error.response_payload, ensure_ascii=False)[:2000]
                    if error.response_payload is not None
                    else None
                ),
                error_class="request",
                model=model,
                request_id=request_id,
                **fallback_failure_fields(
                    args,
                    model,
                    "explicit_terminal_failure",
                    task_id=task_id,
                    machine_error=machine_error,
                ),
            )
    output_dir = str((journal or {}).get("output_dir") or args.output_dir)
    basename = str((journal or {}).get("basename") or args.basename)
    if journal is not None and job_path is not None:
        journal["state"] = "downloading"
        journal["result_url"] = status_body.get("result_url")
        journal = write_media_job(job_path, journal)
    out_path = download_video(
        status_body["result_url"],
        api_key,
        base_url,
        output_dir,
        basename,
    )
    if journal is not None and job_path is not None:
        journal["state"] = "completed"
        journal["saved"] = out_path
        journal["result_url"] = status_body.get("result_url")
        journal = write_media_job(job_path, journal)

    print(
        json.dumps(
            {
                "ok": True,
                "model": model,
                "task_id": task_id,
                "status": status_body.get("state"),
                "saved": out_path,
                "source_url": status_body.get("result_url"),
                "duration": normalize_duration(args.duration),
                "request_id": request_id or None,
                "conversation_id": conversation_id or None,
                "recovered": bool(args.resume_latest),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()

