# Image Director CLI

Run `python scripts/generate_openai_image.py --help` for supported flags. Resolve the local prompt preset first as described in [SKILL.md](../SKILL.md).

Required: `--prompt` or `--prompt-file`. Live requests also need `--user-request` or `--request-file` and `--preset-check-file`.

Model: `--model codex/gpt-image-2 --exact-model`. Output: `--size auto --output-format png`, optional `--quality auto|low|medium|high`, `--background auto|opaque|transparent`, `--output-dir`, `--basename`.

References: repeat `--image` for local files or `--image-url` for HTTPS references. At most four images and 20 MiB total. `--strict-edit` adds a preservation instruction; masks are not supported.

`--dry-run` validates and displays the request without submitting generation. Correlation flags: `--interaction-id`, `--conversation-id`, `--source-type`.

The response includes saved file paths, actual dimensions and hashes. Repeating the exact command with the same preset check resumes local delivery without another generation. Do not change providers or retry ambiguous submissions.
