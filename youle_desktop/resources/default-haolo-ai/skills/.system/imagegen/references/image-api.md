# Haolo official image contract

Public model: `codex/gpt-image-2`. Submit one non-streaming PNG using `POST /v1/images/generations` or `POST /v1/images/edits` with reference images. The gateway uses only explicitly mapped ChatGPT OAuth accounts and a fixed official Codex images endpoint. Upstream tokens are never sent to the desktop.

The desktop uses its Haolo credential, the media_creation pool and image_generation capability. No direct OpenAI API key is required. Do not read or copy the user's Codex account tokens.

The request includes model, prompt, n=1, size=auto, quality and background. Editing references are JSON `images: [{image_url: "data:image/...;base64,..."}]`. The result is an Images API JSON envelope with `data[].b64_json`.

Output dimensions are determined by the official service. Do not advertise fixed 1K/2K sizes. There is no asynchronous image task endpoint and no automatic provider fallback. A connection failure can have unknown acceptance; do not automatically submit again.
