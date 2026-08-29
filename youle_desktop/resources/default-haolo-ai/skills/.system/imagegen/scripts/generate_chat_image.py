#!/usr/bin/env python3
"""Compatibility-only direct image2 path via the Haolo gateway.

Ordinary-chat automatic fallback now stays inside generate_openai_image.py and
uses its journaled `--model image2` path. Keep this helper only for direct
compatibility diagnostics. It still calls the **Haolo gateway** with the same
OPENAI_API_KEY — there is no separate OtuAPI key or host on the desktop.

Endpoint: POST {base}/images/generations
Default base: https://haolo.pro/v1 (overridable via OPENAI_BASE_URL)
Default model: image2
Credentials: OPENAI_API_KEY (Bearer) — the Haolo credential injected by the
main process after login.

The response is synchronous (no polling): {created, data:[{url|b64_json,
revised_prompt}]}. URLs are downloaded; b64_json entries are decoded.
"""

import argparse
import base64
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

DEFAULT_BASE_URL = "https://haolo.pro/v1"
DEFAULT_MODEL = "image2"
# Returned image URLs may be third-party CDN (Cloudflare-fronted); urllib's
# default User-Agent can draw a 403 (error 1010), so present a browser UA.
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

# HTTP statuses that map to error_class "availability" (retry/failover-worthy).
AVAILABILITY_HTTP = {429, 500, 502, 503, 504}


def parse_args():
    parser = argparse.ArgumentParser(description="Generate images via the Haolo gateway image2 model (availability failover).")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--prompt", help="Image prompt text.")
    group.add_argument("--prompt-file", help="Path to a UTF-8 prompt file.")
    parser.add_argument("--output-dir", default="outputs/images", help="Directory for generated images.")
    parser.add_argument("--basename", default="image2", help="Base filename without extension.")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--n", type=int, default=1, help="Number of images, 1-4.")
    parser.add_argument("--size", default="1024x1024", help="1024x1024 / 1536x1024 / 1024x1536.")
    parser.add_argument("--quality", default="high", help="low / medium / high.")
    parser.add_argument(
        "--base-url",
        default=None,
        help="Haolo gateway base URL; defaults to OPENAI_BASE_URL env or the Haolo gateway.",
    )
    parser.add_argument("--timeout", type=int, default=600, help="HTTP timeout in seconds (generation can be slow).")
    parser.add_argument("--dry-run", action="store_true", help="Print request payload without calling the API.")
    return parser.parse_args()


def read_prompt(args):
    if args.prompt_file:
        return Path(args.prompt_file).read_text(encoding="utf-8").strip()
    return args.prompt.strip()


def migrate_gateway_url(value):
    clean = str(value or "").strip().rstrip("/")
    try:
        url = urllib.parse.urlsplit(clean)
        ports = {"aiapi.youleai.top": {None, 80, 443}, "8.216.5.161": {None, 80, 443, 8080}, "54.235.242.62": {None, 80, 3000}, "haolo.pro": {None, 80, 443}}
        if url.scheme not in {"http", "https"} or url.username or url.password or url.query or url.fragment:
            return clean
        if url.hostname not in ports or url.port not in ports[url.hostname]:
            return clean
        return urllib.parse.urlunsplit(("https", "haolo.pro", url.path.rstrip("/") or "/v1", "", ""))
    except ValueError:
        return clean


def resolve_base_url(args):
    base = args.base_url or os.environ.get("OPENAI_BASE_URL") or DEFAULT_BASE_URL
    return migrate_gateway_url(base)


def fail(message, detail=None, error_class=None):
    payload = {"ok": False, "error": message}
    if error_class:
        payload["error_class"] = error_class
    if detail:
        payload["detail"] = detail
    print(json.dumps(payload, ensure_ascii=False))
    sys.exit(1)


def build_opener():
    # Generation holds the connection open for minutes; local HTTP proxies
    # (e.g. Clash) tend to kill it around 160s. The gateway is directly
    # reachable, so bypass system proxies unless explicitly requested.
    if os.environ.get("HAOLO_GEN_USE_PROXY") == "1":
        return urllib.request.build_opener()
    return urllib.request.build_opener(urllib.request.ProxyHandler({}))


def classify_http(code):
    if code in AVAILABILITY_HTTP:
        return "availability"
    if code in (401, 403):
        return "auth"
    return "request"


def main():
    args = parse_args()
    prompt = read_prompt(args)
    base_url = resolve_base_url(args)
    api_url = f"{base_url}/images/generations"
    payload = {
        "model": args.model,
        "prompt": prompt,
        "n": args.n,
        "size": args.size,
        "quality": args.quality,
        "response_format": "url",
    }
    if args.dry_run:
        print(
            json.dumps(
                {
                    "ok": True,
                    "dry_run": True,
                    "api_url": api_url,
                    "payload": payload,
                    "credential_source": "environment:OPENAI_API_KEY" if os.environ.get("OPENAI_API_KEY") else "missing",
                },
                ensure_ascii=False,
            )
        )
        return

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        fail(
            "OPENAI_API_KEY is not set. In haolo_desktop it is injected after logging in to haolo.com.",
            error_class="auth",
        )

    opener = build_opener()
    request = urllib.request.Request(
        api_url,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
    )
    try:
        with opener.open(request, timeout=args.timeout) as response:
            body = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        fail(
            f"HTTP {error.code} from {api_url}",
            detail=error.read().decode("utf-8", "replace")[:2000],
            error_class=classify_http(error.code),
        )
    except urllib.error.URLError as error:
        fail(f"request failed: {error.reason}", error_class="availability")

    data = body.get("data") or []
    if not data:
        fail("response contained no data", detail=json.dumps(body)[:2000], error_class="request")

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    saved = []
    for index, item in enumerate(data):
        item = item or {}
        suffix = f"-{index + 1}" if len(data) > 1 else ""
        encoded = item.get("b64_json")
        if encoded:
            path = output_dir / f"{args.basename}{suffix}.png"
            path.write_bytes(base64.b64decode(encoded))
            saved.append(str(path))
            continue
        url = item.get("url")
        if not url:
            continue
        try:
            with opener.open(urllib.request.Request(url, headers={"User-Agent": BROWSER_UA}), timeout=args.timeout) as resp:
                img_bytes = resp.read()
                mime = (resp.headers.get("Content-Type") or "").split(";")[0].strip()
        except (urllib.error.HTTPError, urllib.error.URLError) as error:
            fail(f"failed to download image: {error}", detail=url, error_class="availability")
        ext = EXT_BY_MIME.get(mime, "png")
        path = output_dir / f"{args.basename}{suffix}.{ext}"
        path.write_bytes(img_bytes)
        saved.append(str(path))

    if not saved:
        fail("data present but no url/b64_json entries", detail=json.dumps(data)[:1000], error_class="request")

    print(
        json.dumps(
            {
                "ok": True,
                "model": args.model,
                "api_url": api_url,
                "saved": saved,
                "revised_prompt": (data[0] or {}).get("revised_prompt", ""),
                "usage": body.get("usage"),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()

