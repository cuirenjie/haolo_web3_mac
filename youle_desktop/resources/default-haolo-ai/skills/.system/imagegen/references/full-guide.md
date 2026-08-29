# Extended Imagegen Guidance

This is optional detail for complex transparency, multi-image editing, diagnostics, or an explicitly requested legacy/CLI path. The short `../SKILL.md` is authoritative. If this guide conflicts with it, follow the short skill, especially its automated preset gate and no-resubmit rules.

## Contents

- [Routing hard rules](#routing-hard-rules-read-first)
- [Top-level modes and rules](#top-level-modes-and-rules)
- [Director mode](#director-mode)
- [Decision tree](#decision-tree)
- [Workflow](#workflow)
- [Transparent image requests](#transparent-image-requests)
- [Prompt augmentation](#prompt-augmentation)
- [Examples](#examples)
- [Fallback CLI mode](#fallback-cli-mode-explicit-opt-in-only)
- [Reference map](#reference-map)

# Image Generation Skill (Youle Subapi / AIHubCC)

This is the haolo_desktop fork of the upstream `imagegen` skill, rewritten to use a **single journaled execution path**: the Director Python helper that calls authenticated Haolo image routes at `https://haolo.pro/v1`.

Default public model: `aihubcc/gpt-image-2`, matching the live relay catalog. If a user says "gpt-image-2", "image 2", or "默认生图", treat that as user intent for this catalog model. Normalize bare `gpt-image-2` and legacy `buming/gpt-image-2` or `lingke/gpt-image-2` to `aihubcc/gpt-image-2` before submission, even with `--exact-model`.

Billing is handled by subapi for the single image requested by each Director run. Status polling does not re-bill.

> **Why this skill differs from upstream codex's `imagegen`.**
> The upstream skill defines three modes (Director / built-in `image_gen` tool / CLI fallback) and routes edits, reference-image workflows, and transparent-background requests through the codex binary's built-in `image_gen` tool. That built-in tool bypasses the Haolo gateway and depends on ChatGPT OAuth or an OpenAI-direct API key, neither of which exists in haolo_desktop. The built-in path is therefore unusable here. This rewrite removes every reference to it.

## Routing hard rules (read first)

These rules exist because coding agents have repeatedly mis-routed image requests into code-composed substitutes ("deliver something runnable" bias). Follow them literally.

1. **Any request for an image deliverable fires this skill, immediately.** "画一张图", "做一张 XX 图", "生成图片", "出一张海报 / 电商详情页 / 封面 / banner", "draw / generate / create an image" all mean: run Director (`scripts/generate_openai_image.py`, model `aihubcc/gpt-image-2`). Text-heavy commercial layouts (电商详情页, posters, banners, covers, infographics) are **still image-generation tasks**: pass the exact text in the prompt instead of switching to code.
2. **Fast preset gate before any freeform prompt thinking.** For every image request, immediately run `scripts/resolve_prompt_preset.py` with the user's literal request. Use its returned `preset_text` and `check_file` when matched, or its explicit `preset_id=none` result when unmatched, then go straight to Director with that check file. Do not manually scan the preset index on the normal path, and do not spend turns brainstorming providers, tools, or alternate execution paths.
3. **"No image tool available" is always a false conclusion.** This skill needs no built-in image tool, no MCP server, and no extra setup. The execution entry is a bundled Python script invoked through the shell, present in every session at `$CODEX_HOME/skills/.system/imagegen/scripts/generate_openai_image.py`. If you cannot find an image tool in your tool list, that is expected by design — use the script.
4. **Never substitute code-composed images.** Do not "deliver" an image request by writing HTML/CSS and rendering it, drawing with canvas/SVG, or compositing with PIL/matplotlib — even though you are a coding agent whose default is to ship working artifacts directly. For an image request, the working artifact **is** the Director-generated bitmap. Code-composed output is permitted only when the user explicitly asks for code, HTML, SVG, or vector output, or names an existing repo-native asset to edit.
5. **If Director fails, classify the error first — never silently fall back to code drawing.**
   - **The Director script classifies failures for you: on error it prints a JSON object with an `error_class` field — trust that field, do not re-derive the class from tracebacks.** `"availability"` covers HTTP 429/5xx and every transport-level failure (`RemoteDisconnected`, connection reset/refused/aborted, SSL EOF, timeouts).
   - **If Director reports `pending=true` with a `task_id`, rerun the exact gated command so it resumes the saved job; never create another POST.** If it is pending without a task id, acceptance is ambiguous: do not retry automatically, and create a fresh check only after the user explicitly asks for a new attempt. The exceptions are an authoritative relay rejection carrying `code=UPSTREAM_TEMPORARILY_UNAVAILABLE`, `retryable=true`, and `route_exhausted=true`, or a repeated pre-provider `SERVICE_TEMPORARILY_UNAVAILABLE` rejection with `retryable=true` and `upstream_status=0` after Director's one same-model retry without optional routing hints; Director records either request as unaccepted and may authorize the next model. If it reports `active_elsewhere`, wait for the process that owns the same check.
   - **`error_class: "auth"`, `"policy"`, or `"request"` (401/403, missing subapi credential, moderation rejection, malformed request): stop and report.** These reproduce on the backup path too - switching just wastes a call. Surface the error and the credential sources checked (use `--dry-run` output).
   - In every case, code drawing (HTML/CSS/canvas/SVG/PIL) remains forbidden as a fallback.
6. **Diagnosing a generation failure also goes through the bundled scripts — never hand-roll HTTP probes.** Do not test the gateway with `Invoke-RestMethod`, `Invoke-WebRequest`, ad-hoc `curl` calls, raw `urllib`/`requests` one-liners, or any other hand-built HTTP client, even when the user pastes a raw API example: those clients default to the system proxy, which kills long-held connections (~160s), so tiny test prompts succeed while real generations get cut mid-flight. Any conclusion drawn from such probes ("the connection is unstable", "complex prompts get dropped", "the endpoint can't handle long requests") is an artifact of the proxy, not a property of the API. For connectivity checks use the bundled scripts themselves: `--dry-run` to verify endpoint and credentials offline, then a minimal real prompt through the same script (it bypasses the system proxy by default). If a hand-rolled probe and the bundled script disagree, the script is right.

Terminology mapping: the user may say "image 2", "gpt-image-2", "Director", or "默认生图" - all of these mean the Director path using `aihubcc/gpt-image-2` (rule 1). The bare ID `image2` means the distinct Buming/OtuAPI contract and is the final guarded ordinary-chat fallback. "用代码画" / "code mode" / "CLI" mean the explicit opt-in paths and require the user to say so.

## Top-level modes and rules

This skill has **one main Director path**, a guarded model fallback chain inside that path, and one explicit-opt-in native-transparency CLI fallback. The codex binary's built-in `image_gen` and `view_image` tools are disabled in this product and must not be called.

- **Director mode (default for everything):** `scripts/generate_openai_image.py`. Reads the Haolo runtime config and uses the guarded ordinary-chat order `aihubcc/gpt-image-2 → gpt-image-2-1k → gpt-image-2-2k → gpt-image-2-3.5k`. All four steps use their media-route credentials. Use Director for every ordinary generation, edit-by-prompt, reference-image workflow, and transparent-background request.
- **Fallback CLI mode (explicit opt-in only):** `scripts/image_gen.py`. Use only when the user explicitly types "use CLI", "use gpt-image-1.5", or names `scripts/image_gen.py` directly, OR when the user has confirmed a true-native-transparency fallback. Inherits the Haolo gateway via the `OPENAI_BASE_URL` env that the youle main process injects. Required for `gpt-image-1.5 --background transparent --output-format png` (true model-native transparency).
- **Compatibility-only direct image2 helper:** `scripts/generate_chat_image.py`. The automatic chain does not use it; Director supports `--model image2` directly so the preset gate, references, journal, and duplicate-submit protection remain active.
- **Disabled — built-in `image_gen` and `view_image` tools.** Never call them. They route through codex binary's hardcoded OpenAI / ChatGPT OAuth path, which haolo_desktop does not configure. Treat them as if they do not exist.

Rules:
- Use Director mode by default for **every** request — new images, edits described by prompt, reference-image workflows, and transparent backgrounds.
- For local file edits or reference images, pass the file path to Director through the prompt context, or read the file with normal file tools. **Do not** load images via the built-in `view_image` tool.
- Do not silently switch to fallback CLI for ordinary quality, size, or path control. The Director script supports all those flags.
- Do not ask the user for endpoint URLs or API keys during normal use. For every GPT-Image step, Director auto-discovers the media gateway and model-specific route credential.
- Default Director model is `aihubcc/gpt-image-2`. Do not submit legacy `buming/gpt-image-2` or bare `gpt-image-2`; Director normalizes both before routing.
- For transparent backgrounds, prefer the **Director + chroma-key + local removal** path (`scripts/remove_chroma_key.py` is bundled). Only switch to CLI `gpt-image-1.5 --background transparent` after explaining the difference and getting explicit user confirmation.
- The word "batch" alone does not mean CLI fallback. For many assets or variants, call Director once per requested output.
- If Director fails because runtime credentials are missing, tell the user what credential sources were checked (env vars and config dirs from `--dry-run` output) and that the fallback CLI exists if they want to set `OPENAI_API_KEY` directly.
- If the user explicitly asks for CLI mode, use the bundled `scripts/image_gen.py` workflow. Do not create one-off SDK runners.
- Never modify `scripts/image_gen.py`. If something is missing, ask the user before doing anything else.

Director command template:

Use the gated command in `../SKILL.md`. It requires the literal request, the resolver's `check_file`, a Director-managed prompt output path, and `--timeout 600`. Do not use an ungated Director command for a live submission. Give the shell process at least 720 seconds so the command can submit, poll, and download without being killed by the caller.

Use `--dry-run` to inspect the selected submit endpoint, status URL template, model, payload, and credential source without making a network call.

For reference-image or edit-style generation, pass public image URLs with repeated `--image-url "https://..."` flags or a comma-separated `--images` value. The canonical base edit route accepts one source image; the reference-generation tiers accept at most six. When the user requires a local edit that preserves all unspecified content, also pass `--strict-edit`. Director first forces multipart `/v1/images/edits`, adds the preservation invariant, and journals source-byte hashes and dimensions. In ordinary execution only, authoritative pre-acceptance failures may advance one at a time through 1K, 2K and 3.5K asynchronous reference-edit tasks; preserve the source and `--strict-edit` on each fresh attempt.

Windows launcher note: if `python` resolves to the WindowsApps store stub (it exits silently or prints a Store prompt), invoke the script with `py` instead. Do not spend turns debugging the alias — just switch the launcher.

Network note: the generation scripts bypass system HTTP proxies by default (local proxies kill long-held connections). On networks where direct outbound traffic is blocked and a proxy is mandatory, set `HAOLO_GEN_USE_PROXY=1` to route through the system proxy again.

Save-path policy:
- Write final artifacts directly under a project or workspace output directory such as `output/imagegen/` or the user-named destination.
- Never leave a project-referenced asset only under a temp/cache directory.
- Do not overwrite an existing asset unless the user explicitly asked for replacement; otherwise create a sibling versioned filename such as `hero-v2.png` or `item-icon-edited.png`.

Shared prompt guidance for both Director and CLI paths lives in `references/prompting.md` and `references/sample-prompts.md`.
Haolo-specific reusable Chinese prompt presets live in `references/prompt-presets/index.md`.

Fast preset path:
1. Run `scripts/resolve_prompt_preset.py` with the user's literal request for every image request.
2. Use the resolver's most-specific match, returned `preset_text`, and `check_file`; do not manually open the index or preset on the normal path.
3. If it returns `preset_id=none`, use the compact prompt orchestration below and retain the returned `check_file`.
4. Run Director with the literal request and that same check file. Director validates the request and local preset hash before any live POST.

## Director mode

Use this mode for every ordinary new-image generation, edit-by-prompt, reference-image workflow, and chroma-key transparent flow through `scripts/generate_openai_image.py`. This is the only path that works in haolo_desktop without ChatGPT login or OpenAI-direct API access.

Provider boundary:
- Use the Haolo Desktop runtime's configured OpenAI-compatible Images API by default (`https://haolo.pro/v1`).
- Do not use FAL, Replicate, Venice, Midjourney, Stability, Sora, or other third-party image providers from this skill.
- Do not ask the user for endpoint URLs or API keys during normal use.
- Do not write credentials into files or generated prompts.
- Keep `--api-url` / `--base-url` flags only for explicit local testing, never for normal user flows.

Short prompt orchestration:
1. Classify intent: portrait, lifestyle, product, UI hero, poster, icon, ad creative, diagram, comic grid, abstract visual, or another concrete asset type.
2. Expand only what improves controllability: subject, purpose, audience, setting, composition, lighting, color palette, material texture, camera angle or viewpoint, output format, and quality bar.
3. Translate Chinese prompts into polished English for the image API, but keep required visible Chinese text exactly as provided.
4. Preserve commercial facts such as product name, price, date, offer, legal copy, and CTA.
5. Choose a mature visual direction such as premium editorial, clean commercial, cinematic realistic, minimal product, or coherent brand-system asset.
6. Add concrete negative constraints for common failures: distorted hands, extra limbs, unreadable text, watermark, bad anatomy, clutter, oversaturation, fake logos, or random UI text.
7. For people, make the subject clearly adult, tasteful, and non-explicit unless the user requests a different allowed direction.

Haolo prompt presets:
- For every image request, run `scripts/resolve_prompt_preset.py` before doing open-ended prompt rewriting.
- When the user's request clearly matches a built-in Haolo category, or when the user explicitly names one, use the resolver-selected preset.
- Merge the resolver-returned `preset_text` into the final prompt and pass its `check_file` to Director. Do not manually load a preset on the normal path.
- Treat preset text as a style, structure, and quality guide. Do not let it replace the user's concrete subject, exact visible text, product facts, identity constraints, size/aspect request, or avoid list.
- If preset requirements conflict with explicit user constraints, keep the user's constraints.
- Prefer the most specific preset. For example, use `小红书封面图提示词.txt` for a cover and `小红书卡片提示词.txt` for a card.
- Keep the final API prompt coherent and not excessively long: preserve the preset's important constraints, visual direction, and layout rules, but collapse repetitive wording.

Prompt upgrade rules:
- Start from the user's literal intent, then add only details that improve quality or controllability.
- For commercial posters, specify offer, exact text, visual hierarchy, product close-up, clean background, and print/social layout.
- For technical diagrams, specify left-to-right or top-to-bottom flow, named nodes, arrows, short readable labels, and minimal decoration.
- For comic grids, specify panel count, emotional arc, consistent character design, clear panel borders, and restrained speech bubbles.
- For portraits, specify adult subject, tasteful styling, natural pose, and non-explicit framing.
- For UI/product hero images, reserve clean negative space for copy and avoid fake unreadable UI text.

Default prompt pattern:

```text
Create a high-quality [asset type] for [use case].
User intent to preserve: ...
Subject: ...
Required visible text, if any: ...
Composition: ...
Environment: ...
Lighting: ...
Materials and texture: ...
Color palette: ...
Camera/viewpoint: ...
Mood: ...
Quality bar: crisp edges, coherent geometry, natural proportions, clean background, no visual clutter.
Avoid: extra fingers, distorted text, unreadable typography, watermark, logo artifacts, random UI text, oversaturated colors.
Output should feel: ...
```

Local post-processing helper:
- `$CODEX_HOME/skills/.system/imagegen/scripts/remove_chroma_key.py`: removes a flat chroma-key background from a Director-generated image and writes a PNG/WebP with alpha. Use auto-key sampling, soft matte, and despill for antialiased edges.

## When to use
- Generate a new image (concept art, product shot, cover, website hero).
- Generate a new image using one or more reference images for style, composition, or mood.
- Edit an existing image by describing the change in the prompt (background replacement, lighting/weather change, object swap, transparent cutout).
- Produce many assets or variants for one task.

## When not to use
- Extending or matching an existing SVG/vector icon set, logo system, or illustration library inside the repo.
- Creating shapes, diagrams, wireframes, or icons **only when the user explicitly asked for SVG/HTML/CSS/canvas output**. "This would look cleaner in code" is not a reason to skip generation — that judgment belongs to the user, not the agent.
- Making a small project-local asset edit when the source file already exists in an editable native format.
- Tasks where the user **explicitly** asked for deterministic code-native output instead of a generated bitmap. If the user just said "做一张图" without naming a medium, that is a generation request — see Routing hard rules.

## Decision tree

Think about two separate questions:

1. **Intent:** is this a new image or an edit of an existing image?
2. **Execution strategy:** is this one asset or many assets/variants?

Intent:
- If the user wants to modify an existing image while preserving parts of it, treat the request as **edit**. Pass the source image path (or a reference description) to Director through the prompt.
- If the user provides images only as references for style, composition, mood, or subject guidance, treat the request as **generate**.
- If the user provides no images, treat the request as **generate**.

Execution strategy:
- Produce single or many assets by running `scripts/generate_openai_image.py` once per requested asset or distinct prompt.
- Director is fixed to one output image per request; use separate gated requests for additional variants.
- Use CLI `generate-batch` only when the user explicitly chose CLI mode and needs many prompts/assets.

Assume the user wants a new image unless they clearly ask to change an existing one.

## Workflow
1. Decide intent: `generate` or `edit`.
2. Decide whether the output is preview-only or meant to be consumed by the current project.
3. Decide execution strategy: single Director call, repeated Director calls, or CLI `generate-batch` (only if user explicitly chose CLI).
4. Collect inputs up front: prompt(s), exact text (verbatim), constraints/avoid list, and any input image paths.
5. For every input image, label its role explicitly: reference image, edit target, or supporting compositing input. Pass file paths to Director through the prompt; do not load images via the built-in `view_image` tool.
6. If the user asked for a photo, illustration, sprite, product image, banner, or other explicitly raster-style asset, use Director rather than substituting SVG/HTML/CSS placeholders. If the request is for an icon, logo, or UI graphic that should match existing repo-native SVG/vector/code assets, prefer editing those directly instead.
7. For ordinary new-image generation, apply prompt augmentation per the specificity policy below:
   - If the user's prompt is already specific and detailed, normalize it into a clear production spec without adding creative requirements.
   - If the user's prompt is short or generic, infer a high-quality direction and add tasteful augmentation only when it materially improves output quality.
   - Preserve exact visible text, commercial facts, subject identity constraints, and user-provided avoid items.
   - Prefer concise, concrete prompt specs over keyword piles.
8. Run the local resolver for each distinct user request, then run `scripts/generate_openai_image.py` with the enhanced prompt, literal request, returned check file, and a project-appropriate `--output-dir`. If it returns a pending accepted task, rerun the exact same gated command to resume it; never POST a replacement.
9. For transparent-output requests, follow the transparent image guidance below: generate on a chroma-key background with Director, then run `scripts/remove_chroma_key.py`, then validate the alpha result. If this path looks unsuitable or fails, ask before switching to CLI `gpt-image-1.5`.
10. Inspect outputs and validate: subject, style, composition, text accuracy, and invariants/avoid items.
11. Iterate with a single targeted change, then re-check.
12. For preview-only work, render the image inline; the underlying file can stay at the Director `--output-dir` path.
13. For project-bound work, move or copy the selected artifact into the workspace and update any consuming code or references. Never leave a project-referenced asset only at a temporary `output/imagegen/` location if the project expects it elsewhere.
14. For batches or multi-asset requests, persist every requested deliverable in the workspace unless the user explicitly asked to keep outputs preview-only. Discarded variants do not need to be kept unless requested.
15. If the user explicitly chooses or confirms the CLI fallback, then use the fallback-only docs for model, quality, size, `input_fidelity`, masks, output format, output paths, and network setup.
16. Always report the final saved path(s) for any workspace-bound asset(s), the final prompt or prompt set, and whether Director or CLI fallback mode was used.

## Transparent image requests

Transparent-image requests use Director to generate the subject on a flat chroma-key background, then convert the key color to alpha locally with `scripts/remove_chroma_key.py`.

Default sequence:
1. Run Director with a prompt that puts the subject on a perfectly flat solid chroma-key background. Default key color: `#00ff00`. Use `#ff00ff` for green subjects; avoid `#0000ff` for blue subjects. Output lands at the configured `--output-dir`.
2. Run the installed helper path, not a project-relative script path:
   ```powershell
   python "$env:CODEX_HOME\skills\.system\imagegen\scripts\remove_chroma_key.py" `
     --input <source> `
     --out <final.png> `
     --auto-key border `
     --soft-matte `
     --transparent-threshold 12 `
     --opaque-threshold 220 `
     --despill
   ```
3. Validate that the output has an alpha channel, transparent corners, plausible subject coverage, and no obvious key-color fringe. If a thin fringe remains, retry once with `--edge-contract 1`; use `--edge-feather 0.25` only when the edge is visibly stair-stepped and the subject is not shiny or reflective.
4. Save the final alpha PNG/WebP in the project if the asset is project-bound.

Prompt transparent requests like this:

```text
Create the requested subject on a perfectly flat solid #00ff00 chroma-key background for background removal.
The background must be one uniform color with no shadows, gradients, texture, reflections, floor plane, or lighting variation.
Keep the subject fully separated from the background with crisp edges and generous padding.
Do not use #00ff00 anywhere in the subject.
No cast shadow, no contact shadow, no reflection, no watermark, and no text unless explicitly requested.
```

Do not automatically use CLI `gpt-image-1.5 --background transparent --output-format png` instead of chroma keying. Ask the user first when the user asks for true/native transparency, when local removal fails validation, or when the requested image is complex: hair, fur, feathers, smoke, glass, liquids, translucent materials, reflective objects, soft shadows, realistic product grounding, or subject colors that conflict with all practical key colors.

Use a concise confirmation like:

```text
This likely needs true native transparency. The default Director + chroma-key path can't separate this subject cleanly, and true transparency requires the CLI fallback with gpt-image-1.5 because gpt-image-2 does not support background=transparent. Should I proceed with that CLI fallback?
```

## Prompt augmentation

Reformat user prompts into a structured, production-oriented spec. Make the user's goal clearer and more actionable, but do not blindly add detail.

Treat this as prompt-shaping guidance, not a closed schema. Use only the lines that help, and add a short extra labeled line when it materially improves clarity.

### Specificity policy

Use the user's prompt specificity to decide how much augmentation is appropriate:

- If the prompt is already specific and detailed, preserve that specificity and only normalize/structure it.
- If the prompt is generic, you may add tasteful augmentation when it will materially improve the result.

Allowed augmentations:
- composition or framing hints
- polish level or intended-use hints
- practical layout guidance
- reasonable scene concreteness that supports the stated request

Not allowed augmentations:
- extra characters or objects that are not implied by the request
- brand names, slogans, palettes, or narrative beats that are not implied
- arbitrary side-specific placement unless the surrounding layout supports it

## Use-case taxonomy (exact slugs)

Classify each request into one of these buckets and keep the slug consistent across prompts and references.

Generate:
- photorealistic-natural — candid/editorial lifestyle scenes with real texture and natural lighting.
- product-mockup — product/packaging shots, catalog imagery, merch concepts.
- ui-mockup — app/web interface mockups and wireframes; specify the desired fidelity.
- infographic-diagram — diagrams/infographics with structured layout and text.
- scientific-educational — classroom explainers, scientific diagrams, and learning visuals with required labels and accuracy constraints.
- ads-marketing — campaign concepts and ad creatives with audience, brand position, scene, and exact tagline/copy.
- productivity-visual — slide, chart, workflow, and data-heavy business visuals.
- logo-brand — logo/mark exploration, vector-friendly.
- illustration-story — comics, children’s book art, narrative scenes.
- stylized-concept — style-driven concept art, 3D/stylized renders.
- historical-scene — period-accurate/world-knowledge scenes.

Edit:
- text-localization — translate/replace in-image text, preserve layout.
- identity-preserve — try-on, person-in-scene; lock face/body/pose.
- precise-object-edit — remove/replace a specific element (including interior swaps).
- lighting-weather — time-of-day/season/atmosphere changes only.
- background-extraction — transparent background / clean cutout. Use Director with a chroma-key background plus `remove_chroma_key.py` for simple opaque subjects; ask before using CLI true transparency for complex subjects.
- style-transfer — apply reference style while changing subject/scene.
- compositing — multi-image insert/merge with matched lighting/perspective.
- sketch-to-render — drawing/line art to photoreal render.

## Shared prompt schema

Use the following labeled spec as shared prompt scaffolding for Director and CLI paths:

```text
Use case: <taxonomy slug>
Asset type: <where the asset will be used>
Primary request: <user's main prompt>
Input images: <Image 1: role; Image 2: role> (optional)
Scene/backdrop: <environment>
Subject: <main subject>
Style/medium: <photo/illustration/3D/etc>
Composition/framing: <wide/close/top-down; placement>
Lighting/mood: <lighting + mood>
Color palette: <palette notes>
Materials/textures: <surface details>
Text (verbatim): "<exact text>"
Constraints: <must keep/must avoid>
Avoid: <negative constraints>
```

Notes:
- `Asset type` and `Input images` are prompt scaffolding, not dedicated CLI flags.
- `Scene/backdrop` refers to the visual setting. It is not the same as the fallback CLI `background` parameter, which controls output transparency behavior.
- CLI-only execution notes such as `Quality:`, `Input fidelity:`, masks, output format, and output paths belong in the CLI path only.

Augmentation rules:
- Keep it short.
- Add only the details needed to improve the prompt materially.
- For edits, explicitly list invariants (`change only X; keep Y unchanged`).
- If any critical detail is missing and blocks success, ask a question; otherwise proceed.

## Examples

### Generation example (hero image)
```text
Use case: product-mockup
Asset type: landing page hero
Primary request: a minimal hero image of a ceramic coffee mug
Style/medium: clean product photography
Composition/framing: wide composition with usable negative space for page copy if needed
Lighting/mood: soft studio lighting
Constraints: no logos, no text, no watermark
```

### Edit example (invariants)
```text
Use case: precise-object-edit
Asset type: product photo background replacement
Primary request: replace only the background with a warm sunset gradient
Constraints: change only the background; keep the product and its edges unchanged; no text; no watermark
```

## Prompting best practices
- Structure prompt as scene/backdrop -> subject -> details -> constraints.
- Include intended use (ad, UI mock, infographic) to set the mode and polish level.
- Use camera/composition language for photorealism.
- Only use SVG/vector stand-ins when the user explicitly asked for vector output or a non-image placeholder.
- Quote exact text and specify typography + placement.
- For tricky words, spell them letter-by-letter and require verbatim rendering.
- For multi-image inputs, reference images by index and describe how they should be used.
- For edits, repeat invariants every iteration to reduce drift.
- Iterate with single-change follow-ups.
- If the prompt is generic, add only the extra detail that will materially help.
- If the prompt is already detailed, normalize it instead of expanding it.
- For CLI fallback only, see `references/cli.md` and `references/image-api.md` for model, `quality`, `input_fidelity`, masks, output format, and output-path guidance.
- For transparent images, use the Director + chroma-key workflow unless the request is complex enough to need true CLI transparency; ask before switching to CLI `gpt-image-1.5`.

More principles shared by Director and CLI paths: `references/prompting.md`.
Copy/paste specs shared by Director and CLI paths: `references/sample-prompts.md`.

## Guidance by asset type
Asset-type templates (website assets, game assets, wireframes, logo) are consolidated in `references/sample-prompts.md`.

## AIHubCC image guidance

Director defaults to the public subapi model `aihubcc/gpt-image-2`.

- Use `aihubcc/gpt-image-2` for new generations unless the user explicitly chose a fallback path.
- If the user or an old client supplies bare `gpt-image-2`, `buming/gpt-image-2`, or `lingke/gpt-image-2`, normalize it to `aihubcc/gpt-image-2` before submitting.
- For `gpt-image-2` text-to-image, the script sends the documented top-level `model`, `prompt`, `size`, `quality`, `response_format="url"`, and fixed `n=1` fields. Reference-image editing uses the documented multipart `/images/edits` route. Fidelity-sensitive edits must add `--strict-edit`; ordinary execution may then continue through the asynchronous 1K/2K/3.5K reference tiers only after safe pre-acceptance failures.
- Director has no output-count option. For additional assets or variants, run one separately gated request per output.
- If a transparent request may need CLI fallback, ask before using `gpt-image-1.5` unless the user already explicitly requested `gpt-image-1.5`, `scripts/image_gen.py`, or CLI fallback. Explain that Director + chroma-key is the default, but true transparency requires a separate CLI fallback.

## Buming image2 compatibility helper

The exact Buming/OtuAPI model ID `image2` is retained only for explicit compatibility diagnostics. It is not part of the automatic ordinary-execution fallback chain. Run it through Director so any explicit live submission remains preset-gated and journaled:

```powershell
python "$env:CODEX_HOME\skills\.system\imagegen\scripts\generate_openai_image.py" `
  --prompt "ENHANCED_PROMPT_HERE" `
  --user-request "LITERAL_USER_REQUEST" `
  --preset-check-file ".\output\imagegen\.media-jobs\preset-check-REQUEST_ID.json" `
  --output-dir ".\output\imagegen" `
  --basename "image" `
  --model "image2" `
  --size "1024x1024" `
  --quality "high" `
  --timeout 600
```

Notes:
- Endpoint: `{OPENAI_BASE_URL}/images/generations` (default base `https://haolo.pro/v1`), model `image2`. Credentials come from `OPENAI_API_KEY` (Bearer), the same Haolo credential the main process already injects after login.
- The response is synchronous: `data[].url` and/or `data[].b64_json`. Director downloads URL entries or decodes base64 entries and keeps the result in the same task journal.
- `--size` accepts `1024x1024` / `1536x1024` / `1024x1536`; `--quality` accepts `low` / `medium` / `high`; Director requests one image.
- Repeated `--image-url` values are preserved in the OtuAPI `image` array for reference-image generation.
- Generation can take minutes — keep `--timeout 600`.
- `scripts/generate_chat_image.py` remains only as a compatibility helper for direct diagnostics; do not use it for the automatic fallback chain.

Haolo Image Generation mode uses a bounded base-to-1K path. When the client has selected base `aihubcc/gpt-image-2`, invoke the first Director attempt with `--exact-model --provider-fallback-only`. A safe pre-acceptance terminal failure exposes only `fallback_model=gpt-image-2-1k`; create a fresh preset check and request ID for that one asynchronous retry, preserving references and strict-edit intent. Do not visit 2K/3.5K/Buming `image2`. Any other client-selected image tier stays exact and has no automatic fallback.

## Fallback CLI mode (explicit opt-in only)

This section only applies when the user has explicitly chosen `scripts/image_gen.py` (e.g., "use CLI", "use gpt-image-1.5", or confirmed a true-transparency fallback). Director mode covers everything else.

### Temp and output conventions
- Use `tmp/imagegen/` for intermediate files (for example JSONL batches); delete them when done.
- Write final artifacts under `output/imagegen/`.
- Use `--out` or `--out-dir` to control output paths; keep filenames stable and descriptive.

### Dependencies
Prefer `uv` for dependency management in this repo.

Required Python package:
```bash
uv pip install openai
```

Required for local chroma-key removal and optional downscaling:
```bash
uv pip install pillow
```

Portability note:
- If you are using the installed skill outside this repo, install dependencies into that environment with its package manager.
- In uv-managed environments, `uv pip install ...` remains the preferred path.

### Environment
- Director first checks `LLMHUB_API_KEY`, then `SUB2API_API_KEY`, then Haolo runtime credentials (`config.toml` provider `base_url`, injected `OPENAI_API_KEY`) and then standard OpenAI environment variables. Use `scripts/generate_openai_image.py --dry-run` to see the selected submit endpoint, status endpoint template, model, payload, and credential source without making a network call.
- For CLI fallback live API calls, `OPENAI_API_KEY` must be set. In haolo_desktop the main process injects it after the user logs in to haolo.com, so in normal use no manual export is required.
- Never ask the user to paste the full key in chat. Ask them to set it locally and confirm when ready.

If `OPENAI_API_KEY` is missing (e.g., the user has not logged in to haolo.com, or env injection failed), give the user these steps:
1. Log in to haolo.com from the desktop app — this writes the runtime API key to the bundled `auth.json` and injects it on next launch.
2. If they want to use a self-supplied OpenAI key for CLI fallback instead, have them set `OPENAI_API_KEY` as an environment variable in their system.
3. Offer to guide them through setting the environment variable for their OS/shell if needed.

If installation is not possible in this environment, tell the user which dependency is missing and how to install it into their active environment.

### Script-mode notes
- CLI commands + examples: `references/cli.md`
- API parameter quick reference: `references/image-api.md`
- Network approvals / sandbox settings for CLI mode: `references/codex-network.md`

## Reference map
- `references/prompting.md`: shared prompting principles for Director and CLI paths.
- `references/sample-prompts.md`: shared copy/paste prompt recipes for Director and CLI paths.
- `references/prompt-presets/index.md`: Haolo-specific Chinese prompt preset data source used by `scripts/resolve_prompt_preset.py`. Do not open it manually on the normal path.
- `references/cli.md`: fallback-only CLI usage via `scripts/image_gen.py`.
- `references/image-api.md`: fallback-only API/CLI parameter reference.
- `references/codex-network.md`: fallback-only network/sandbox troubleshooting for CLI mode.
- `scripts/generate_openai_image.py`: Director implementation. The default path for every ordinary request.
- `scripts/generate_chat_image.py`: compatibility-only direct `image2` helper. Automatic fallback uses Director with `--model image2`.
- `scripts/image_gen.py`: fallback-only CLI implementation. Do not load or use it unless the user explicitly chooses CLI mode or explicitly confirms a true-transparency CLI fallback.
- `$CODEX_HOME/skills/.system/imagegen/scripts/remove_chroma_key.py`: local post-processing helper for Director-based transparent-image requests.
