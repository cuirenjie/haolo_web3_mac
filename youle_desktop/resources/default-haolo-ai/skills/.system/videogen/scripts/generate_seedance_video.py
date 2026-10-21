#!/usr/bin/env python3
"""Video Director for explicitly selected OpenRouter and OtuAPI models."""
import argparse
import hashlib
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "imagegen/scripts"))
import generate_openai_image as transport

SUPPORTED_MODELS = ("bytedance/seedance-2.0", "omni_flash-10s")
TERMINAL_FAILURE = {"failed", "error", "cancelled", "canceled", "expired"}


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    prompt = parser.add_mutually_exclusive_group()
    prompt.add_argument("--prompt")
    prompt.add_argument("--prompt-file")
    parser.add_argument("--model", choices=SUPPORTED_MODELS)
    parser.add_argument("--exact-model", action="store_true")
    parser.add_argument("--input-mode", default="image-to-video", choices=["image-to-video"])
    parser.add_argument("--image-url", action="append", default=[])
    parser.add_argument("--aspect-ratio", default="9:16")
    parser.add_argument("--resolution", default="720p")
    parser.add_argument("--size", default="")
    parser.add_argument("--duration", type=int)
    parser.add_argument("--base-url")
    parser.add_argument("--output-dir", default="outputs/videos")
    parser.add_argument("--basename", default="video")
    parser.add_argument("--job-dir", default=".media-jobs/videogen")
    parser.add_argument("--request-id")
    parser.add_argument("--resume-latest", action="store_true")
    parser.add_argument("--timeout", type=int, default=600)
    parser.add_argument("--poll-interval", type=float, default=5)
    for name in ("interaction-id", "conversation-id", "source-type"):
        parser.add_argument("--"+name)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def endpoint(base, model):
    if model == "bytedance/seedance-2.0":
        return base.removesuffix("/v1")+"/api/v1/videos"
    return base+"/videos"


def validate_url(url):
    parsed = urllib.parse.urlsplit(url)
    if parsed.username or parsed.password or parsed.fragment:
        raise RuntimeError("Invalid media URL")
    if parsed.scheme == "https":
        return
    if parsed.scheme == "http" and parsed.hostname in ("localhost", "127.0.0.1", "::1"):
        return
    raise RuntimeError("Media URLs must use HTTPS")


def get_json(url, api_key):
    validate_url(url)
    headers = {"Authorization": "Bearer "+api_key, **transport.haolo_usage_headers()}
    headers["X-Haolo-Model-Capability"] = "video_generation"
    with transport.opener().open(urllib.request.Request(transport.model_transport_url(url), headers=headers), timeout=60) as response:
        return json.loads(response.read(4 * 1024 * 1024))


def build_payload(args, model, prompt):
    if not prompt or not args.image_url:
        raise RuntimeError("The selected video model requires a prompt and reference image")
    for url in args.image_url:
        validate_url(url)
    if args.resolution != "720p":
        raise RuntimeError("Select the 720p resolution provided by the live catalog")
    if model == "bytedance/seedance-2.0":
        if args.duration not in range(4, 16) or args.aspect_ratio not in {"1:1","3:4","9:16","4:3","16:9","21:9","9:21"}:
            raise RuntimeError("Invalid Seedance duration or aspect ratio")
        body = {"model": model, "prompt": prompt, "aspect_ratio": args.aspect_ratio,
                "resolution": args.resolution, "duration": args.duration,
                "input_references": [{"type":"image_url", "image_url":{"url":url}} for url in args.image_url]}
    else:
        if args.duration != 10 or args.aspect_ratio not in {"9:16","16:9"} or len(args.image_url) != 1:
            raise RuntimeError("Omni Flash requires one image, 10 seconds and a portrait or landscape ratio")
        body = {"model":model, "prompt":prompt, "images":args.image_url, "duration":10}
    if args.size:
        body["size"] = args.size
    elif model == "omni_flash-10s":
        body["size"] = "720x1280" if args.aspect_ratio == "9:16" else "1280x720"
    return body


def download_video(url, api_key, base, out_path):
    validate_url(url)
    headers = {}
    if urllib.parse.urlsplit(url).netloc == urllib.parse.urlsplit(base).netloc:
        headers["Authorization"] = "Bearer "+api_key
    out_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = out_path.with_suffix(".mp4.part")
    request = urllib.request.Request(transport.model_transport_url(url), headers=headers)
    # Never forward the gateway credential on a redirected download.
    with transport.opener().open(request, timeout=300) as response, temporary.open("wb") as target:
        first = response.read(65536)
        if not first or first.lstrip()[:1] in (b"{", b"[", b"<"):
            raise RuntimeError("Video endpoint did not return video bytes")
        target.write(first)
        while True:
            chunk = response.read(65536)
            if not chunk:
                break
            target.write(chunk)
    temporary.replace(out_path)
    return str(out_path.resolve())


def main():
    args = parse_args()
    transport.configure_usage_correlation(args)
    job_dir = Path(args.job_dir).expanduser().resolve()
    job_path = None
    lock = None
    job = {}
    try:
        if args.timeout < 1 or args.poll_interval <= 0 or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}",args.basename):
            raise RuntimeError("Invalid timeout, interval or basename")
        conversation = str(args.conversation_id or os.environ.get("HAOLO_CONVERSATION_ID") or "")
        if args.resume_latest:
            jobs = []
            for path in job_dir.glob("video-*.json"):
                candidate = transport.read_json_file(path, "video journal")
                if candidate.get("conversation_id") == conversation:
                    jobs.append((path.stat().st_mtime_ns, path, candidate))
            if not jobs:
                raise RuntimeError("No local video task exists for this conversation; a continuation never creates a new task")
            _, job_path, job = max(jobs, key=lambda entry:entry[0])
        else:
            request_id = args.request_id or str(uuid.uuid4())
            if not re.fullmatch(r"[A-Za-z0-9_:-]{1,200}",request_id):
                raise RuntimeError("Invalid request ID")
            job_path = job_dir / ("video-"+hashlib.sha256(request_id.encode()).hexdigest()+".json")
            if job_path.exists():
                job = transport.read_json_file(job_path, "video journal")
        if job and (args.prompt or args.prompt_file):
            prompt = Path(args.prompt_file).read_text(encoding="utf-8-sig").strip() if args.prompt_file else str(args.prompt or "").strip()
            if args.model != job.get("model") or build_payload(args, args.model, prompt) != job.get("payload"):
                raise RuntimeError("This request ID already belongs to a different video request")
        if job and job.get("conversation_id") != conversation:
            raise RuntimeError("This task belongs to another conversation")
        model = job.get("model") or args.model
        if model not in SUPPORTED_MODELS:
            raise RuntimeError("Select a currently available video model; this task's old route cannot be resumed")
        defaults = transport.load_haolo_defaults(model, "video_generation")
        base = transport.normalize_base_url(job.get("base_url") or args.base_url or defaults.get("base_url"))
        transport.validate_gateway_url(base)
        if not job:
            prompt = Path(args.prompt_file).read_text(encoding="utf-8-sig").strip() if args.prompt_file else str(args.prompt or "").strip()
            payload = build_payload(args, model, prompt)
            if args.dry_run:
                print(json.dumps({"submit_url":endpoint(base,model), "payload":payload},ensure_ascii=False))
                return 0
            job = {"request_id":request_id, "conversation_id":conversation, "model":model,
                   "base_url":base, "payload":payload, "state":"new",
                   "output_dir":str(Path(args.output_dir).expanduser().resolve()), "basename":args.basename}
        key = defaults.get("api_key")
        if not key:
            raise RuntimeError("No Haolo credential for this video model")
        lock = transport.try_acquire_media_job_lock(job_path)
        if lock is None:
            raise RuntimeError("Another process owns this video task")
        if job_path.exists():
            job = transport.read_json_file(job_path, "video journal")
        if job.get("state") == "succeeded":
            if not Path(job["result"]["saved"]).is_file():
                raise RuntimeError("Saved video is missing; do not generate again automatically")
            print(json.dumps({**job["result"],"resumed":True},ensure_ascii=False))
            return 0
        if job.get("state") in TERMINAL_FAILURE:
            raise RuntimeError("This video task already failed; continuation will not submit another task")
        if not job.get("task_id"):
            if job.get("state") != "new":
                raise RuntimeError("Submission acceptance is unknown. No task ID is available; do not resubmit automatically")
            job["state"] = "submitting"
            transport.atomic_write_json(job_path,job)
            response = transport.post_json(endpoint(base,model),key,job["payload"],job["request_id"],args.timeout,
                                           capability="video_generation",accepted_status=(200,201,202))
            data = response.get("data") if isinstance(response.get("data"),dict) else {}
            task_id = response.get("id") or response.get("task_id") or data.get("id") or data.get("task_id")
            if not task_id:
                raise RuntimeError("Video submission returned no task ID; acceptance is unknown")
            job.update(task_id=str(task_id),state="pending")
            transport.atomic_write_json(job_path,job)
        poll_url = endpoint(base,model)+"/"+urllib.parse.quote(job["task_id"],safe="")
        deadline = time.monotonic()+args.timeout
        while time.monotonic() < deadline:
            current = get_json(poll_url,key)
            state = video_result_state(current)
            url = video_result_url(current)
            if state in TERMINAL_FAILURE:
                job["state"] = state
                transport.atomic_write_json(job_path,job)
                raise RuntimeError("Video task ended as "+state)
            if state in ("completed","success","succeeded"):
                if not url:
                    url = poll_url+"/content"
                url = urllib.parse.urljoin(base+"/",url)
                out_path = Path(job["output_dir"])/(job["basename"]+"-"+hashlib.sha256(job["request_id"].encode()).hexdigest()[:16]+".mp4")
                saved = download_video(url,key,base,out_path)
                result = {"ok":True,"state":"succeeded","pending":False,"task_id":job["task_id"],"model":model,"saved":saved}
                job.update(state="succeeded",result=result)
                transport.atomic_write_json(job_path,job)
                print(json.dumps(result,ensure_ascii=False))
                return 0
            time.sleep(args.poll_interval)
        print(json.dumps({"ok":False,"pending":True,"state":"pending","task_id":job["task_id"],"safe_to_resubmit":False}))
        return 3
    except (OSError,RuntimeError,ValueError) as error:
        print(json.dumps({"ok":False,"pending":job.get("state") not in TERMINAL_FAILURE and bool(job),
                          "state":job.get("state","failed"),"safe_to_resubmit":False,"error":str(error)},ensure_ascii=False))
        return 2
    finally:
        transport.release_media_job_lock(lock)


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

if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    raise SystemExit(main())
