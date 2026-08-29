---
name: "videogen"
description: "Generate short text-to-video, image-to-video, or video-to-video clips through the Haolo subapi video gateway. The desktop obtains the allowed model and documented input, screen-size, and duration combinations from the authenticated media model pool and Video Expert capability API. The skill only talks to https://haolo.pro/v1 with the user's Youle/subapi credential; it never calls a provider directly or needs a provider key. Use whenever the user asks to generate, make, or create a video (生成视频 / 生视频 / 做个视频 / 出个视频 / 文生视频 / 短片 / 动态视频 / video generation). Never satisfy a video request by composing animations with HTML/CSS/JS, canvas, or ffmpeg slideshows unless the user explicitly asks for a code-based animation."
---

# Video Generation Skill (Youle Subapi)

Generate video clips through the Haolo subapi asynchronous video API.

- Model and supported options: selected from the authenticated Video Expert capability API.
- Default model for direct script use: `grok-imagine-video-1.5`.
- Ordinary text-to-video and image-to-video requests start with AIHubCC `grok-imagine-video-1.5`. Image-to-video may safely fall back to Buming `aihubcc/grok-video-3.5` and then AIHubCC `omni-fast-no-water`. Do not automatically select Seedance.
- Current models: `Seedance-2.0-480p`, `Seedance-2.0-720p`, `Seedance-2.0-1080p`, `Seedance-2.0-mini-480p`, `Seedance-2.0-mini-720p`, `grok-imagine-video-1.5`, `aihubcc/grok-video-3.5`, `omni-fast-no-water`, and `omni-fast-v2v-no-water`.
- Relay routing: the script submits the selected business model ID unchanged. The gateway owns provider-account selection and any upstream model mapping.
- Grok 1.5 submit: `POST https://haolo.pro/v1/videos`.
- Grok 1.5 poll: `GET https://haolo.pro/v1/videos/{task_id}` until `status=completed`; then read `video_url`.
- Input: follow the selected model contract; Grok 1.5 accepts text alone or one public image URL, Seedance accepts up to 4 images, 3 videos, and 1 audio reference (audio requires a main image), Omni Fast accepts up to 5 images, and Omni V2V requires 1-2 source videos.
- Timeout guidance: poll every 3-5 seconds; allow up to 900 seconds.
- Recovery: every submit must include a stable `--request-id`, the desktop `--conversation-id`, and a persistent `--job-dir`. The relay and local journal retain the task for 24 hours.

## Routing hard rules

1. Any request for a video deliverable fires this skill immediately. "生成视频", "生视频", "做一个视频", "出个短片", "文生视频", and "make/generate a video" all mean: select a compatible model and run `scripts/generate_seedance_video.py`.
2. Unless the client or user explicitly selected a model, use this automatic priority:
   - Submit AIHubCC `grok-imagine-video-1.5` first, with or without one public reference image.
   - Advance one step to Buming `aihubcc/grok-video-3.5`, then AIHubCC `omni-fast-no-water`, only when the script returns `pending=false`, `state=failed`, and `fallback_allowed=true`.
   - Without an image, skip the image-only Buming fallback if AIHubCC Grok fails, and continue only to a compatible text-to-video route. Use `omni-fast-v2v-no-water` when the request contains source video instead of source images.
   - Do not automatically select a Seedance model. Seedance is allowed only when the client or user explicitly selected it.
3. Any submit-stage failure that returns no task id may authorize the next configured model. This includes structured route exhaustion, plain 429/5xx responses, disconnects, malformed or non-JSON replies, and successful HTTP responses without a task id. The script returns `pending=false`, `state=failed`, and `fallback_allowed=true` when a fallback exists. An explicit terminal task failure may also authorize the next model.
4. Preserve the prompt and public references, apply the returned `fallback_adjustments`, create a fresh `--request-id` for every next model, and retain the same `--conversation-id`. Never reuse the failed model's request id for a different payload.
5. Once a task id has been accepted, never start another fallback while that task is queued, pending, processing, or only timed out during polling; report or resume it instead. Before a task id exists, submission ambiguity intentionally advances to the next configured provider even though this may duplicate generation and billing.
6. Respect the selected model's input contract. Do not invent a missing image for an image-only route, and do not omit required image/video references for Buming Grok or Omni V2V.
7. When the client supplies a selected model, screen size, duration, and resolution, preserve the selected model family. The script's `--exact-model` mode disables the ordinary cross-model chain. Video Expert invokes selected AIHubCC `grok-imagine-video-1.5` with `--exact-model --provider-fallback-only`; when an image exists, this may expose only Buming `aihubcc/grok-video-3.5` after safe resubmission is authorized. It never advances to Omni or Seedance in that selected-model path.
8. Prompt rewriting is conditional. Inspect only the user's literal creative request, excluding attachment metadata and internal routing text. If it already contains a concrete subject and action plus at least two useful production dimensions such as setting, camera/composition, lighting/color, style, timing, or constraints, pass it to the script exactly unchanged: do not translate, reorder, polish, shorten, or rewrite it. Only improve a very brief or underspecified request, preserving its intent and adding only useful generation details.
9. Do not call provider endpoints directly. Never use a provider API key from this skill.
10. After the eligible three-model chain is exhausted, stop and report the script JSON's user-actionable `error_class` and detail. Never expose a provider model name or task id in the user-facing reply; keep both only in the script JSON and recovery journal. Do not fall back to code-composed animation.
11. Reuse public attachment URLs directly. Do not call `view_image` on a full-resolution reference merely to inspect its composition or aspect ratio. Read lightweight image metadata when dimensions are required; if visual analysis is essential, create and inspect a bounded thumbnail (longest edge at most 1024 px and file size at most 1 MB) instead of embedding the original image in the model turn.
12. When the user says only "继续", "继续生成", "恢复", "恢复任务", "continue", or "resume" after an interrupted video task, run the script with `--resume-latest --conversation-id <current-thread-id>`. Do not pass a prompt, do not optimize the continuation text, and do not submit a new model task. If the 24-hour cache has expired, report that instead of charging again.

## Command template

For an ordinary text-only request, use Grok 1.5 directly:

```powershell
python "$env:CODEX_HOME\skills\.system\videogen\scripts\generate_seedance_video.py" `
  --prompt "ENHANCED_PROMPT_HERE" `
  --model "grok-imagine-video-1.5" `
  --input-mode "text-to-video" `
  --aspect-ratio "16:9" `
  --resolution "720p" `
  --duration "6" `
  --output-dir ".\outputs\videogen" `
  --basename "video" `
  --request-id "CURRENT_INTERACTION_ID" `
  --conversation-id "CURRENT_THREAD_ID" `
  --job-dir ".\.media-jobs\videogen" `
  --timeout 900
```

For an image-to-video request with one public reference image, use Grok first:

```powershell
python "$env:CODEX_HOME\skills\.system\videogen\scripts\generate_seedance_video.py" `
  --prompt "ENHANCED_PROMPT_HERE" `
  --image-url "https://example.com/first-frame.png" `
  --model "grok-imagine-video-1.5" `
  --aspect-ratio "9:16" `
  --resolution "720p" `
  --duration "6" `
  --output-dir ".\outputs\videogen" `
  --basename "video" `
  --request-id "CURRENT_INTERACTION_ID" `
  --conversation-id "CURRENT_THREAD_ID" `
  --job-dir ".\.media-jobs\videogen" `
  --timeout 900
```

If the first Grok request returns `fallback_model=aihubcc/grok-video-3.5`, create a fresh request ID and retry with the Buming Grok contract:

```powershell
python "$env:CODEX_HOME\skills\.system\videogen\scripts\generate_seedance_video.py" `
  --prompt "ENHANCED_PROMPT_HERE" `
  --image-url "https://example.com/first-frame.png" `
  --model "aihubcc/grok-video-3.5" `
  --input-mode "image-to-video" `
  --aspect-ratio "9:16" `
  --resolution "720p" `
  --duration "6" `
  --output-dir ".\outputs\videogen" `
  --basename "video" `
  --request-id "FRESH_FALLBACK_INTERACTION_ID" `
  --conversation-id "CURRENT_THREAD_ID" `
  --job-dir ".\.media-jobs\videogen" `
  --timeout 900
```

If Buming Grok then returns `fallback_model=omni-fast-no-water`, create another fresh request ID and run the final Omni attempt:

```powershell
python "$env:CODEX_HOME\skills\.system\videogen\scripts\generate_seedance_video.py" `
  --prompt "ENHANCED_PROMPT_HERE" `
  --image-url "https://example.com/first-frame.png" `
  --model "omni-fast-no-water" `
  --input-mode "text-or-image-to-video" `
  --aspect-ratio "9:16" `
  --resolution "720p" `
  --duration "10" `
  --output-dir ".\outputs\videogen" `
  --basename "video" `
  --request-id "FRESH_FINAL_INTERACTION_ID" `
  --conversation-id "CURRENT_THREAD_ID" `
  --job-dir ".\.media-jobs\videogen" `
  --timeout 900
```

Do not run either fallback after the current route has returned a task id and is pending, processing, or only timed out during polling. If submission ended without a task id and the script returns `fallback_allowed=true`, continue immediately with the reported fallback.

Use `--dry-run` to inspect the submit URL, status URL template, selected model, request payload, and credential source without making a network call.

To recover an interrupted task without a second submission:

```powershell
python "$env:CODEX_HOME\skills\.system\videogen\scripts\generate_seedance_video.py" `
  --resume-latest `
  --conversation-id "CURRENT_THREAD_ID" `
  --job-dir ".\.media-jobs\videogen" `
  --output-dir ".\outputs\videogen" `
  --basename "video-recovered" `
  --timeout 900
```

The recovery command first uses the local journal, then the authenticated relay's per-user job index. A cached relay result is downloaded through the authenticated media-cache endpoint. It never issues a new submit request.

## Endpoint reference

- Base: `https://haolo.pro/v1` by default. `LLMHUB_BASE_URL`, `SUB2API_BASE_URL`, or `--base-url` may override it for local testing. Do not use ambient `OPENAI_BASE_URL` for routing because Codex sessions may set it to a non-subapi backend.
- Auth: `Authorization: Bearer <LLMHUB_API_KEY>`. The script checks `LLMHUB_API_KEY`, then `SUB2API_API_KEY`, then `OPENAI_API_KEY`, which haolo_desktop injects after login.
- Grok 1.5 submit: `POST {base}/videos`.
- Grok 1.5 poll: use the submit response's `polling_url` when present; otherwise use `GET {base}/videos/{task_id}` and complete only on `status=completed`.
- Older compatibility models keep the relay's legacy media-task routes.
- Success condition for Grok 1.5: exactly `status=completed` with a downloadable `video_url`. Other compatibility routes retain their documented completed/success normalization.
- Failure condition: `is_final == true` with non-success state, or an explicit failed/error state.

Request payload:

```json
{
  "model": "grok-imagine-video-1.5",
  "prompt": "...",
  "image": "https://example.com/first-frame.png",
  "seconds": "6",
  "aspect_ratio": "9:16",
  "resolution": "720p"
}
```

Buming Grok uses a distinct nested contract:

```json
{
  "model": "aihubcc/grok-video-3.5",
  "prompt": "...",
  "params": {
    "images": ["https://example.com/first-frame.png"],
    "aspect_ratio": "9:16",
    "resolution": "720p",
    "duration": "6"
  }
}
```

Supported parameters:
- Reference media fields vary by model and are built by the script from repeated `--image-url`, `--video-url`, or `--audio-url` options.
- `--model`: one business model ID returned by the capability API. The script sends it unchanged so the gateway selects the matching provider account pool.
- `aspect_ratio`, `size`, `resolution`, and `duration`: use the exact combination returned for that model.
- Seedance: prompt at most 5000 characters; duration 4-15 seconds; ratios `16:9`, `9:16`, `1:1`, `21:9`, `3:4`, `4:3`; use `reference_image_urls` for reference images, or the paired `first_image_url` and `last_image_url` fields for first/last-frame mode.
- Seedance reference prompts should address attached images as `@image1`, `@image2`, and so on. The script automatically prepends missing image bindings and treats `@image1` as the primary subject reference; prompts that already contain every binding token are preserved unchanged.
- Grok 1.5: `image` is optional and accepts a public URL or JPG/PNG/WebP data URI; duration is an integer string from `1` through `15`; ratios are `16:9`, `9:16`, `1:1`, `4:3`, `3:4`, `2:3`, or `3:2`; resolution is lowercase `480p` or `720p`; send `image`, `seconds`, `aspect_ratio`, and `resolution` as top-level fields.
- Buming Grok: one public image URL; duration 1-15 seconds; ratios `16:9`, `9:16`, `1:1`, `3:2`, or `2:3`; resolution `720p` or `480p`; send these fields inside `params`.
- Omni Fast: ratios `16:9` or `9:16`; current duration is fixed at 10 seconds. `omni-fast-no-water` uses `images`; `omni-fast-v2v-no-water` uses `videos`.

## Workflow

1. Obtain any public image or video URLs required by the selected model and pass them directly to the script. Start ordinary text/image generation with AIHubCC Grok 1.5; only image-to-video can use the Buming-Grok compatibility fallback. Do not download and inspect a full-resolution reference unless the task truly requires visual analysis.
2. Apply the conditional prompt policy before submission. Preserve a detailed literal prompt byte-for-byte as the Director prompt. Only for a very brief or underspecified request, build a concise generation-ready prompt with useful subject, action, setting, camera movement, lighting, and style details while preserving the user's intent.
3. Advance only one step at a time and only when the script returns fallback metadata. A submit-stage response without a task id advances immediately, accepting the possible duplicate-generation and billing risk. After a task id exists, do not submit another provider while that task is pending, processing, or only timed out during polling.
4. Report the saved video path and final prompt. Never show the selected or actual model name, provider name, or task id in a user-facing completion; keep that metadata internal for recovery and diagnostics. Keep project-bound clips in `outputs/videogen/` or the user-named destination.
5. If a fallback succeeds, say only that automatic fallback recovered and the video completed; do not name the failed or successful routes. If the chain cannot advance or all eligible routes fail, relay only the last script JSON's user-actionable `error`, `error_class`, and `detail` fields, without the model or task id.

## When not to use

- The user explicitly asks for a code-based animation, CSS/JS/canvas output, or a slideshow assembled from existing images.
- The user wants to edit an existing video file, trim footage, add subtitles, or convert formats. That is local ffmpeg work, not generation.
- The user wants an image, not a video. Use the `imagegen` skill.

## Prompt tips

- Use one clear action beat; avoid multiple scene changes in one short clip.
- Specify camera explicitly: "static camera", "slow zoom in", "handheld follow shot".
- Name the style: "photorealistic", "3D render", "anime", "stop motion".
- For product clips, specify the product, surface, lighting, and movement.
- Avoid watermark requests, copyrighted characters, and real-person likenesses.

## Network note

The generation script bypasses system HTTP proxies by default because local proxies can kill long-held connections. On networks where direct outbound traffic is blocked and a proxy is mandatory, set `HAOLO_GEN_USE_PROXY=1`.
