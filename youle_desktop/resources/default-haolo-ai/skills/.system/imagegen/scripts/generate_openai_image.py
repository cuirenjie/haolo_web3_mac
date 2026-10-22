#!/usr/bin/env python3
"""Generate/edit images through Haolo's official Codex OAuth gateway route."""
import argparse
import base64
import hashlib
import json
import os
import re
import shutil
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
DEFAULT_MODEL = "codex/gpt-image-2"
LOCALAPPDATA = Path(os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData/Local")))
APPDATA = Path(os.environ.get("APPDATA", str(Path.home() / "AppData/Roaming")))
DEFAULT_HAOLO_CONFIG_DIR = LOCALAPPDATA / "Programs/haolo_desktop/resources/default-haolo-ai"
DEFAULT_HAOLO_AI_HOME = APPDATA / "haolo_desktop/haolo-ai-home"
MAX_REFERENCE_BYTES = 20 * 1024 * 1024
MAX_RESPONSE_BYTES = 64 * 1024 * 1024

class RequestContractError(RuntimeError):
    pass

class TransportError(RuntimeError):
    pass

class RelayHTTPError(RuntimeError):
    def __init__(self, status, message):
        self.status = status
        super().__init__(f"Gateway returned HTTP {status}: {message}")

def normalize_public_model(model):
    return str(model or DEFAULT_MODEL).strip()

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

def load_haolo_defaults(model=None, capability="image_generation"):
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
    model_credential = media_model_credential(auth, model, capability) if model else {}
    auth_base_url = normalized_haolo_base_url(
        model_credential.get("base_url")
        or os.environ.get("LLMHUB_BASE_URL")
        or auth.get("LLMHUB_BASE_URL")
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
    api_key = model_credential.get("api_key")
    if api_key:
        credential_source = model_credential["credential_source"]
    elif os.environ.get("LLMHUB_API_KEY"):
        api_key = os.environ.get("LLMHUB_API_KEY")
        credential_source = "environment:LLMHUB_API_KEY"
    elif auth.get("LLMHUB_API_KEY"):
        api_key = auth.get("LLMHUB_API_KEY")
        credential_source = "haolo_auth_json:LLMHUB_API_KEY"
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
                "A local preset check is required before official image submit. Run scripts/resolve_prompt_preset.py, "
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
    """Keep the local preset and literal request in the exact prompt sent to official image."""
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

def model_transport_url(value):
    """Route at the wire boundary; persisted job URLs keep the public origin."""
    relay_value = os.environ.get("HAOLO_MODEL_RELAY_URL", "").strip()
    url = urllib.parse.urlsplit(value)
    if not relay_value or url.scheme != "https" or url.hostname != "haolo.pro" or url.port not in (None, 443) or url.username or url.password:
        return value
    relay = urllib.parse.urlsplit(relay_value)
    if relay.scheme != "http" or relay.hostname != "127.0.0.1" or not relay.port or relay.username or relay.password or relay.query or relay.fragment:
        raise RuntimeError("Invalid desktop model routing relay")
    return urllib.parse.urlunsplit((relay.scheme, relay.netloc, url.path, url.query, ""))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def opener():
    handlers = [NoRedirect()]
    if os.environ.get("HAOLO_GEN_USE_PROXY") != "1":
        handlers.append(urllib.request.ProxyHandler({}))
    return urllib.request.build_opener(*handlers)


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--prompt")
    group.add_argument("--prompt-file")
    request = parser.add_mutually_exclusive_group()
    request.add_argument("--user-request")
    request.add_argument("--request-file")
    parser.add_argument("--preset-check-file")
    parser.add_argument("--prompt-output")
    parser.add_argument("--output-dir", default="outputs/images")
    parser.add_argument("--basename", default="codex-image")
    parser.add_argument("--model", default=DEFAULT_MODEL, choices=[DEFAULT_MODEL])
    parser.add_argument("--exact-model", action="store_true")
    parser.add_argument("--base-url")
    parser.add_argument("--api-url")
    parser.add_argument("--quality", default="auto", choices=["auto", "low", "medium", "high"])
    parser.add_argument("--size", default="auto", help="Requested size; the official endpoint decides the actual output dimensions.")
    parser.add_argument("--background", default="opaque", choices=["auto", "opaque", "transparent"])
    parser.add_argument("--output-format", default="png", choices=["png"])
    parser.add_argument("--image-url", action="append", dest="image_urls", default=[])
    parser.add_argument("--image", action="append", default=[], help="Local reference image path.")
    parser.add_argument("--strict-edit", action="store_true")
    parser.add_argument("--timeout", type=int, default=600)
    for name in ("interaction-id", "conversation-id", "source-type"):
        parser.add_argument("--"+name)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def validate_gateway_url(value):
    url = urllib.parse.urlsplit(value)
    if url.username or url.password or url.query or url.fragment:
        raise RequestContractError("Invalid gateway URL")
    if url.scheme == "https" and url.hostname == "haolo.pro" and url.port in (None, 443):
        return
    if url.scheme == "http" and url.hostname in ("127.0.0.1", "localhost", "::1"):
        return
    raise RequestContractError("Use the Haolo HTTPS gateway or a loopback test server.")


def load_reference(value, local=False):
    if local:
        path = Path(value).expanduser()
        if path.stat().st_size > MAX_REFERENCE_BYTES:
            raise RequestContractError("Reference image exceeds 20 MiB")
        data = path.read_bytes()
    elif value.startswith("data:image/"):
        try:
            data = base64.b64decode(value.split(",", 1)[1], validate=True)
        except (ValueError, IndexError) as error:
            raise RequestContractError("Invalid reference image data URL") from error
    else:
        url = urllib.parse.urlsplit(value)
        if url.scheme != "https" or url.username or url.password:
            raise RequestContractError("Reference URLs must use HTTPS without credentials")
        # Reference retrieval never receives the gateway credential.
        with opener().open(value, timeout=60) as response:
            data = response.read(MAX_REFERENCE_BYTES + 1)
    if len(data) > MAX_REFERENCE_BYTES:
        raise RequestContractError("Reference image exceeds 20 MiB")
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        mime = "image/png"
    elif data.startswith(b"\xff\xd8"):
        mime = "image/jpeg"
    elif data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        mime = "image/webp"
    else:
        raise RequestContractError("Reference image must be PNG, JPEG or WebP")
    return "data:"+mime+";base64,"+base64.b64encode(data).decode("ascii")


def post_json(url, api_key, payload, request_id, timeout, capability="image_generation", accepted_status=(200,)):
    headers = {
        "Authorization": "Bearer "+api_key, "Content-Type": "application/json",
        "X-Client-Request-Id": request_id, **haolo_usage_headers(),
    }
    headers["X-Haolo-Model-Capability"] = capability
    wire_url = model_transport_url(url)
    raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    curl = shutil.which("curl.exe") or shutil.which("curl")
    use_curl = os.environ.get("HAOLO_GEN_HTTP_TRANSPORT") == "curl" or (
        os.name == "nt" and os.environ.get("HAOLO_GEN_HTTP_TRANSPORT") != "urllib" and curl
    )
    if use_curl:
        if not curl:
            raise TransportError("curl is unavailable")
        # Put credentials in stdin, never command-line arguments or a temp file.
        config = ["silent", "show-error", "max-redirs = 0",
                  "connect-timeout = 30", "max-time = "+str(timeout),
                  "url = "+json.dumps(wire_url), "max-filesize = "+str(MAX_RESPONSE_BYTES)]
        if os.environ.get("HAOLO_GEN_USE_PROXY") != "1":
            config.append('noproxy = "*"')
        config += ["header = "+json.dumps(k+": "+v) for k, v in headers.items()]
        config += ["data = "+json.dumps(raw.decode("utf-8"), ensure_ascii=False),
                   'write-out = "\\n__HAOLO_STATUS__%{http_code}"']
        try:
            result = subprocess.run([curl, "--config", "-"], input=("\n".join(config)+"\n").encode("utf-8"),
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout+15)
        except (OSError, subprocess.TimeoutExpired) as error:
            raise TransportError("Image request interrupted; acceptance is unknown. Do not resubmit automatically.") from error
        if result.returncode:
            raise TransportError("Image connection failed; acceptance is unknown. Do not resubmit automatically.")
        body, marker, status = result.stdout.rpartition(b"\n__HAOLO_STATUS__")
        if not marker:
            raise TransportError("Missing gateway response status")
        status = int(status)
    else:
        request = urllib.request.Request(wire_url, data=raw, headers=headers, method="POST")
        try:
            with opener().open(request, timeout=timeout) as response:
                body, status = response.read(MAX_RESPONSE_BYTES + 1), response.status
        except urllib.error.HTTPError as error:
            body, status = error.read(8192), error.code
        except (OSError, urllib.error.URLError) as error:
            raise TransportError("Image connection failed; acceptance is unknown. Do not resubmit automatically.") from error
    if len(body) > MAX_RESPONSE_BYTES:
        raise TransportError("Image response is too large; do not resubmit automatically")
    if status not in accepted_status:
        try:
            error = json.loads(body).get("error", {})
            message = error.get("message", "request rejected") if isinstance(error, dict) else "request rejected"
        except (ValueError, AttributeError):
            message = "request rejected"
        raise RelayHTTPError(status, str(message).replace(api_key, "[redacted]")[:800])
    try:
        return json.loads(body)
    except ValueError as error:
        raise TransportError("Invalid image response; do not resubmit automatically") from error


def save_images(response, output_dir, basename, request_id):
    items = response.get("data")
    if not isinstance(items, list) or not items:
        raise TransportError("Official image response contains no image")
    output_dir.mkdir(parents=True, exist_ok=True)
    saved = []
    for index, item in enumerate(items):
        try:
            data = base64.b64decode(item["b64_json"], validate=True)
        except (KeyError, TypeError, ValueError) as error:
            raise TransportError("Invalid image data") from error
        if not data.startswith(b"\x89PNG\r\n\x1a\n") or len(data) < 24:
            raise TransportError("Official image response is not a PNG")
        path = output_dir / f"{basename}-{request_id}-{index+1}.png"
        path.write_bytes(data)
        saved.append({"path": str(path.resolve()), "bytes": len(data),
                      "width": int.from_bytes(data[16:20], "big"), "height": int.from_bytes(data[20:24], "big"),
                      "sha256": hashlib.sha256(data).hexdigest()})
    return saved


def main():
    args = parse_args()
    configure_usage_correlation(args)
    job_path = None
    lock = None
    job = {}
    try:
        if args.timeout < 1 or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", args.basename):
            raise RequestContractError("Invalid timeout or basename")
        if not re.fullmatch(r"auto|\d{2,4}x\d{2,4}", args.size):
            raise RequestContractError("Invalid requested image size")
        prompt = read_prompt(args)
        if not prompt:
            raise RequestContractError("Prompt is empty")
        check = validate_preset_check(args, require=not args.dry_run)
        validate_prompt_output_path(args.prompt_output, check)
        prompt = enforce_gated_prompt(prompt, args, check)
        if len(args.image) + len(args.image_urls) > 4:
            raise RequestContractError("At most four reference images are supported")
        images = [load_reference(value, local=True) for value in args.image]
        images += [load_reference(value) for value in args.image_urls]
        if sum(len(base64.b64decode(value.split(",",1)[1])) for value in images) > MAX_REFERENCE_BYTES:
            raise RequestContractError("Reference images exceed 20 MiB total")
        if args.strict_edit and not images:
            raise RequestContractError("--strict-edit requires a reference image")
        if args.strict_edit:
            prompt = "Edit only what the user requested; preserve all unspecified content as closely as possible.\n\n"+prompt
        payload = {"model": DEFAULT_MODEL, "prompt": prompt, "quality": args.quality,
                   "size": args.size, "background": args.background, "n": 1}
        if images:
            payload["images"] = [{"image_url": value} for value in images]
        defaults = load_haolo_defaults(DEFAULT_MODEL)
        base_url = normalize_base_url(args.base_url or defaults.get("base_url"))
        endpoint = "edits" if images else "generations"
        url = args.api_url or base_url+"/images/"+endpoint
        validate_gateway_url(url)
        if urllib.parse.urlsplit(url).path != "/v1/images/"+endpoint:
            raise RequestContractError("The request must use the matching Haolo Images endpoint")
        if args.dry_run:
            safe_payload = {**payload}
            if images:
                safe_payload["images"] = [{"image_url": "<reference image data>"} for _ in images]
            print(json.dumps({"api_url": url, "payload": safe_payload, "preset_gate": preset_check_summary(check),
                              "credential_source": defaults.get("credential_source") or "not_found"}, ensure_ascii=False))
            return 0
        api_key = defaults.get("api_key")
        if not api_key:
            raise RequestContractError("No Haolo credential. Log in and enable the official image model in the gateway.")
        request_id = check["request_id"]
        job_path = media_job_path(check, request_id)
        lock = try_acquire_media_job_lock(job_path)
        if lock is None:
            raise RequestContractError("Another process owns this image request; do not resubmit")
        output_dir = Path(args.output_dir).expanduser().resolve()
        contract = canonical_json_sha256({"payload": payload, "url": url, "output_dir": str(output_dir), "basename": args.basename})
        job = read_json_file(job_path, "image job") if job_path.exists() else {}
        if job:
            if job.get("contract") != contract:
                raise RequestContractError("Existing image request parameters changed; do not overwrite its journal")
            if job.get("state") == "succeeded":
                result = job["result"]
                if not all(Path(item["path"]).is_file() for item in result["saved"]):
                    raise RequestContractError("A saved image is missing; do not regenerate automatically")
                print(json.dumps({**result, "resumed": True}, ensure_ascii=False))
                return 0
            if job.get("state") != "received":
                print(json.dumps({"ok": False, "state": job.get("state"), "pending": job.get("state") != "failed",
                                  "safe_to_resubmit": False, "error": "This request was already submitted. Check its original result before retrying."}))
                return 3
        else:
            job = {"request_id": request_id, "contract": contract, "state": "submitting", "model": DEFAULT_MODEL}
            save_prompt_file(args.prompt_output, prompt)
            atomic_write_json(job_path, job)
            response = post_json(url, api_key, payload, request_id, args.timeout)
            response_path = job_path.with_suffix(".response.json")
            atomic_write_json(response_path, response)
            job.update(state="received", response_path=str(response_path))
            atomic_write_json(job_path, job)
        response = read_json_file(Path(job["response_path"]), "image response")
        saved = save_images(response, output_dir, args.basename, request_id)
        result = {"ok": True, "state": "succeeded", "pending": False, "model": DEFAULT_MODEL, "api_url": url,
                  "request_id": request_id, "saved": saved, "usage": response.get("usage"),
                  "requested_size": args.size, "actual_size": response.get("size"),
                  "preset_gate": preset_check_summary(check)}
        job.update(state="succeeded", result=result)
        atomic_write_json(job_path, job)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except (OSError, RuntimeError, ValueError) as error:
        pending = not isinstance(error, RelayHTTPError) and (isinstance(error, TransportError) or bool(job and job.get("state") == "submitting"))
        if job_path and lock and job and job.get("state") == "submitting":
            job["state"] = "failed" if isinstance(error, RelayHTTPError) else "unknown"
            try:
                atomic_write_json(job_path, job)
            except OSError:
                pass
        print(json.dumps({"ok": False, "state": "unknown" if pending else "failed", "pending": pending,
                          "safe_to_resubmit": False, "error": str(error)}, ensure_ascii=False))
        return 3 if pending else 2
    finally:
        release_media_job_lock(lock)


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    raise SystemExit(main())
