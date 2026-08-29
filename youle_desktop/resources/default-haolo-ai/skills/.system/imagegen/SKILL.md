---
name: "imagegen"
description: "Generate or edit raster images through the Haolo subapi AIHubCC gateway with canonical model aihubcc/gpt-image-2. Every live submission must first pass the bundled local prompt-preset resolver; matched presets are merged with the user's literal request, and unmatched requests are explicitly recorded as preset_id=none. Use for 画图 / 生成图片 / 照片 / 海报 / 电商图 / 封面 / banner and other raster deliverables. Never call built-in image_gen/view_image or replace the requested bitmap with HTML/CSS/SVG/canvas/PIL unless the user explicitly requests code or vector output."
---

# Image Generation (Haolo / AIHubCC)

Use the model-specific AIHubCC route selected by the bundled Director:

- Script: `scripts/generate_openai_image.py`
- `aihubcc/gpt-image-2` text generation: `POST /v1/images/generations`
- `aihubcc/gpt-image-2` edit/reference: multipart `POST /v1/images/edits`
- `gpt-image-2-1k`, `gpt-image-2-2k`, and `gpt-image-2-3.5k`: asynchronous relay `POST /v1/videos`, then `GET /v1/videos/{task_id}`. The relay rewrites public `gpt-image-2-1k` to upstream `gpt-image-2-1k-async`.
- Buming / OtuAPI `image2`: synchronous `POST /v1/images/generations`, with reference URLs in the `image` array
- Model: `aihubcc/gpt-image-2`

The names `gpt-image-2`, `image 2`, and “默认生图” mean the canonical live relay model `aihubcc/gpt-image-2`. Bare `gpt-image-2` and legacy `buming/gpt-image-2` or `lingke/gpt-image-2` inputs are always normalized to that canonical ID, including with `--exact-model`.
The ordinary-chat automatic fallback order is exactly `aihubcc/gpt-image-2` → `gpt-image-2-1k` → `gpt-image-2-2k` → `gpt-image-2-3.5k`. The bare ID `image2` is a distinct compatibility contract and is not part of this automatic chain.

When Haolo Image Generation mode supplies a model selected from its live relay catalog, that selection overrides the default. For selected base `aihubcc/gpt-image-2`, pass `--model "aihubcc/gpt-image-2" --exact-model --provider-fallback-only`: Director tries the synchronous Images API first and authorizes only `gpt-image-2-1k` as a safe pre-acceptance fallback. That one retry uses a fresh preset check, `--exact-model`, the asynchronous task API, and the same references; it must never visit 2K, 3.5K, or Buming `image2`. For every other selected catalog model, pass `--model "SELECTED_MODEL" --exact-model` and do not switch models.

When Image Generation mode also supplies a client-selected output size, preserve it exactly: use `--size` for the base and Buming pixel-size models and `--aspect-ratio` for the asynchronous 1K/2K/3.5K models. The base `gpt-image-2` supports `auto`; Buming `image2` defaults to `1024x1024`, while 1K/2K/3.5K default to `1:1`.

When the Haolo turn reminder supplies billing correlation values, pass all of them unchanged: `--interaction-id`, `--conversation-id`, and `--source-type`. They allow the gateway's fixed image charge (`gpt-image-2` starts at 1 point per generation) to be merged into the exact visible canvas phase or node. Never omit, replace, or invent these values. Outside a correlated Haolo task, leave the optional flags unset.

## Non-negotiable routing

1. Any requested bitmap deliverable uses this skill immediately.
2. Never call built-in `image_gen`, `imagegen`, or `view_image` tools. They bypass the Haolo gateway.
3. Never substitute HTML/CSS, canvas, SVG, PIL, matplotlib, or another code-drawn artifact unless the user explicitly requested code, HTML, SVG, or vector output.
4. Do not hand-roll HTTP probes. Use the bundled resolver and Director scripts for normal work and diagnostics.
5. Do not ask for endpoint URLs or API keys during normal use. The scripts discover the installed Haolo configuration and injected credential.

## Fast preset gate (mandatory, automated)

Every live AIHubCC POST must be preceded by the bundled local preset resolver. This is a fail-closed code gate, not an optional reasoning step.

Run one local resolver call with the user's literal request:

```powershell
python "$env:CODEX_HOME\skills\.system\imagegen\scripts\resolve_prompt_preset.py" `
  --request "USER_REQUEST_VERBATIM" `
  --output-dir ".\outputs"
```

The resolver reads `references/prompt-presets/index.md` locally and returns:

- `preset_checked=true`
- a stable `request_id` and `request_sha256`
- `preset_id`, path, and SHA-256 when matched
- `preset_id=none` when unmatched
- `check_file`
- the selected `preset_text` when matched

Do not manually open the index or preset file on the normal path. The resolver already loads and hashes the most-specific match. For ordinary photo-generation wording such as “生成一张……照片”, it may apply the local `真实照片` fallback only after more-specific presets such as photo collage or old-photo repair have been checked.

Prompt merge rules:

- When matched, merge the returned `preset_text` with the user's literal subject, exact visible text, facts, identity constraints, dimensions, and avoid items.
- User requirements always override incompatible preset details. Remove conflicting preset mood or scene requirements rather than weakening the user's request.
- Use one primary preset. Do not load multiple long presets unless the request truly requires it.
- When unmatched, record `preset_id=none` and use the compact prompt scaffold below.

Director refuses a live submission if the check is missing, belongs to another request, or its local preset hash changed.
Director also ensures the exact validated preset text and literal user request are present in the final AIHubCC prompt. If the enhanced prompt omitted either one, Director adds the missing gated layer before saving or submitting it.

## Default Director command

After building the final enhanced prompt, call Director once. Let Director save the prompt file; do not create it in a separate tool turn.

```powershell
python "$env:CODEX_HOME\skills\.system\imagegen\scripts\generate_openai_image.py" `
  --prompt "ENHANCED_PROMPT" `
  --user-request "USER_REQUEST_VERBATIM" `
  --preset-check-file "CHECK_FILE_FROM_RESOLVER" `
  --prompt-output ".\outputs\image-generation-prompt.txt" `
  --output-dir ".\outputs" `
  --basename "image" `
  --model "aihubcc/gpt-image-2" `
  --quality "auto" `
  --size "auto" `
  --output-format "png" `
  --timeout 600
```

For reference/edit images, add repeated `--image-url "https://..."` flags or one comma-separated `--images` value. `gpt-image-2` accepts one edit image whose long edge is at most 2048 px. The 1K/2K/3.5K tiers and Buming `image2` accept at most six public reference URLs totaling no more than 5 MB. Reference files must be JPEG, PNG, or WebP.

When the request is to modify an existing image while keeping everything else unchanged, the command must include `--strict-edit`. With the base `aihubcc/gpt-image-2`, Director forces canonical multipart `/v1/images/edits`, prepends a pixel-fidelity invariant, and records source hashes and dimensions. In ordinary execution, an authoritative pre-acceptance failure may advance through the asynchronous 1K/2K/3.5K reference tiers one at a time, always with a fresh preset check, the same source and `--strict-edit`. Those tiers are best-effort reference-guided editing and cannot promise byte-identical unaffected pixels. An explicitly selected asynchronous tier stays locked and has no automatic fallback. Buming `image2` remains unavailable for `--strict-edit`.

In Haolo Image Generation mode with selected base Image2, add both `--exact-model` and `--provider-fallback-only` to the first command. If it safely returns `fallback_model=gpt-image-2-1k`, run the preset resolver again for a fresh check, then invoke Director once with `--model gpt-image-2-1k --exact-model`, the closest supported `--aspect-ratio`, and a fresh request ID. Preserve `--strict-edit` and the source URL for edits. Do not try 2K, 3.5K, or Buming `image2` in this selected-model path.

The shell process's total timeout must cover submit, polling, and download: use at least 720 seconds / `720000` ms. A 10-second tool yield is fine only when it does not terminate the process. If the tool returns a cell/session id, wait on that same execution instead of starting another command.

## Prompt invariants

Preserve exact user text, product facts, identity, count, dimensions, reference roles, and avoid items. If the user's prompt is already detailed, normalize it without inventing new requirements. If it is brief, add only concrete details that materially improve controllability. For base-model `--strict-edit`, explicitly say that the supplied image is the sole source canvas and list only the requested changes. For selected 1K `--strict-edit`, list only the requested changes and require the asynchronous reference model to preserve composition, crop, subject count, identities, positions, poses, background, camera, lighting, texture, and era as closely as it permits. Director adds the correct model-specific invariant in code.

Compact unmatched scaffold:

```text
Use case: <photo/product/poster/illustration/etc.>
Primary request: <user request>
Subject: <main subject>
Scene/backdrop: <environment>
Style/medium: <photo/illustration/3D/etc.>
Composition/framing: <camera/layout>
Lighting/mood: <lighting and mood>
Text (verbatim): "<exact text>"
Constraints: <must keep>
Avoid: <must avoid>
```

## Async completion and retry rules

Once AIHubCC accepts a `task_id`, never POST that request again automatically.

For the asynchronous 1K/2K/3.5K task protocol, only `status=completed` means complete. `progress` is display-only, and `success`, `succeeded`, `done`, or `progress=100` must not end polling. Read the completed image from `video_url`; if the completed response omits it, use `/v1/videos/{task_id}/content`.

- Director anchors `.media-jobs/image-<request_id>.json` beside the resolver-created check, so changing `--output-dir` cannot create a second journal or POST.
- A tool wait timeout, polling timeout, connection reset, 429, or 5xx after acceptance means `pending`, not failed generation.
- If Director returns `pending=true` with a `task_id`, rerun the exact same Director command with the same prompt, parameters, output path, and `preset-check-file`. It resumes the saved task and does not POST again.
- If submit returns a machine-readable relay rejection with `code=UPSTREAM_TEMPORARILY_UNAVAILABLE`, `retryable=true`, and `route_exhausted=true`, Director records `accepted=false`, returns `pending=false`, and may authorize the next fallback model. This structured envelope is authoritative evidence that the current model route was exhausted.
- If submit is rejected before provider acceptance with HTTP 403, `code=PERMISSION_DENIED`, `category=policy`, `retryable=false`, `route_exhausted=false`, `upstream_status=0`, and an exact `model "..." is not enabled for` catalog message, Director retries the same model and request once without the optional media-pool/capability routing hints. This is not a model fallback and does not create a new preset check or request ID.
- If submit is rejected before provider acceptance with HTTP 503, `code=SERVICE_TEMPORARILY_UNAVAILABLE`, `category=transport`, `retryable=true`, `route_exhausted=false`, and `upstream_status=0`, Director likewise retries the same model and request once without optional routing hints. If that retry returns the same authoritative rejection, Director records `accepted=false`, returns `pending=false`, and may authorize the next fallback model; no provider task existed to duplicate.
- When resuming a legacy `reconciling` journal created before this rule existed, Director may upgrade it to the same explicit rejection only if the saved error text still contains that complete machine-readable envelope. Legacy unstructured 502 records remain ambiguous.
- If it returns `pending=true` without a `task_id` for any other submit failure (for example a disconnect, read timeout, malformed response, or unstructured 429/5xx), do not retry automatically: acceptance is ambiguous and the same check is held in `reconciling`. Report it; create a fresh check only after the user explicitly requests a new attempt.
- If it returns `state=active_elsewhere`, wait for the invocation that owns the same check; do not start another command.
- Never rerun the resolver for a pending task; that creates a new request id.
- Never change prompt, model, size, quality, `n`, or images while resuming. Director rejects parameter drift.
- Auth, policy, malformed-request, or non-timeout terminal task failures stop immediately. A fresh request requires explicit user retry.
- If local output appears after a tool timeout, deliver it; do not create a replacement task.

## Automatic availability fallback

For ordinary chat with no client- or user-selected model, Director may advance through the fallback order only when it returns `pending=false`, `state=failed`, and `fallback_allowed=true`. Director sets that flag only for an explicit terminal generation timeout, an authoritative machine-readable relay rejection with `code=UPSTREAM_TEMPORARILY_UNAVAILABLE`, `retryable=true`, and `route_exhausted=true`, or a repeated pre-provider `SERVICE_TEMPORARILY_UNAVAILABLE` rejection with `retryable=true` and `upstream_status=0` after its one same-model retry without optional routing hints.

Strict local edits in ordinary execution use the same four-step order: synchronous base `/images/edits`, then asynchronous 1K, 2K and 3.5K when each prior route proves no provider task was created. A directly selected asynchronous tier returns `fallback_allowed=false` when unavailable. Async tiers may reconstruct parts of the scene, so their results must be described as reference-guided rather than pixel-identical.
The machine-readable block reason for an unavailable selected asynchronous reference task remains `strict_edit_reference_task_unavailable`.

- Create a fresh preset check for the same literal user request, preserve the prompt and references, and submit the reported `fallback_model`.
- Advance one model at a time and stop at the first success. Do not skip ahead or resubmit the failed model.
- Convert size controls to the next model's contract: use a supported pixel size for base/Buming `image2`, or the closest supported aspect ratio for the asynchronous 1K/2K/3.5K models.
- Stop after `gpt-image-2-3.5k`; do not add Buming `image2` or another provider to the ordinary automatic chain.
- Never switch models for `pending`, `reconciling`, `active_elsewhere`, a task that still has a non-terminal status, or a plain client/gateway read timeout. Resume or reconcile that task instead; switching there can duplicate generation and billing.
- Preserve an explicit client or user model selection exactly, except that known legacy Image2 aliases always normalize to `aihubcc/gpt-image-2`. Director is normally invoked with `--exact-model` and returns `fallback_allowed=false`. The sole Media Creation exception is selected base `aihubcc/gpt-image-2` with `--provider-fallback-only`: after a safe pre-acceptance terminal failure it may return only `fallback_model=gpt-image-2-1k`. Create a fresh preset check and request ID for that one asynchronous retry; preserve references and strict-edit intent.

## Output and billing

- Save deliverables under the workspace/project output directory, not temp/cache storage.
- Use versioned filenames unless the user explicitly asked to overwrite.
- Director always requests exactly one output image. For multiple assets or variants, use one separately gated request per output.
- Report the saved bitmap path, prompt path, matched `preset_id` (or `none`), and whether a saved task was resumed. For reference requests, also retain the Director's `reference_delivery` and `reference_images` audit fields; these prove which source bytes were fetched and which request field/endpoint carried them without storing the private URL in the journal.

## Compatibility and exceptional opt-in paths

- `scripts/generate_chat_image.py`: compatibility-only direct Buming `image2` helper. Do not use it for the automatic chain; Director's `--model "image2"` path provides the required preset gate, reference preservation, journal, and duplicate-submit protection.
- `scripts/image_gen.py` / `gpt-image-1.5`: only when the user explicitly requests CLI mode or confirms true native transparency.
- Simple transparent assets default to Director on a flat chroma-key background followed by `scripts/remove_chroma_key.py`. Ask before switching to native-transparency CLI for hair, fur, glass, smoke, liquids, reflections, or similarly complex edges.

Read `references/full-guide.md` only for a complex transparency/edit/diagnostic case or an explicitly requested legacy/CLI path. Supporting prompt principles remain in `references/prompting.md` and `references/sample-prompts.md`.
