---
name: imagegen
description: Generate or edit raster images through the Haolo official Codex image route. Run the local prompt-preset resolver before every live submission.
---

# Image generation

- Model: `codex/gpt-image-2`
- Client endpoint: `https://haolo.pro/v1/images/generations`; references use `/v1/images/edits`.
- Authentication: the existing Haolo model credential. The gateway owns official account authentication.
- One PNG per request. Use `--size auto`; report the returned actual dimensions. Shape requests belong in the prompt and are not guaranteed pixel dimensions.
- Never switch models or providers automatically. Only this model is available in this skill.

## Workflow

1. Run `scripts/resolve_prompt_preset.py --request "LITERAL USER REQUEST" --output-dir ".media-jobs/presets"`. For a long request, use `--request-file`. Read the returned preset and check path.
2. Merge the matched local preset with the literal request and the desired visual details. Preserve requested text exactly. Unmatched requests are recorded as `preset_id=none`.
3. Invoke `scripts/generate_openai_image.py --prompt "ENHANCED PROMPT" --user-request "LITERAL USER REQUEST" --preset-check-file "RETURNED CHECK PATH" --model "codex/gpt-image-2" --exact-model --size auto --output-dir "outputs/images"`. Use prompt/request files for long text.
4. For edits, add repeated `--image "LOCAL PATH"` or `--image-url "HTTPS URL"`. Up to four PNG/JPEG/WebP references, 20 MiB total. Add `--strict-edit` when unchanged regions should be preserved; this is a prompt instruction, not a promise of pixel identity.
5. Read the JSON result and show the saved local image. Report failures truthfully; never substitute an unrelated output.

## Interruption and delivery

Reuse the same preset check, prompt, references, output directory and basename to resume. The local journal returns an already delivered image or completes saving a received response. If submission acceptance is unknown, stop and report it; do not create a fresh check to retry automatically. No task polling, tier escalation or provider fallback exists for images.

Use the bundled Director for raster generation. Never use another provider or local drawing as an undisclosed replacement. Creative prompt guidance and local preset assets remain available. See [CLI](references/cli.md), [API contract](references/image-api.md) and [prompting](references/prompting.md).
