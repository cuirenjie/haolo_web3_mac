# Image generation guide

Follow [SKILL.md](../SKILL.md) for the required local preset gate, official model and delivery workflow. [CLI](cli.md) documents the supported arguments; [API contract](image-api.md) explains authentication and recovery.

Before generation, identify the subject, composition, style, lighting, requested text and constraints. For edits, inspect the source, describe the requested change and specify what should remain unchanged. Preserve the literal user request in the final prompt.

After generation, inspect the output, link the saved file, and report its actual dimensions. Do not claim success from a queued or failed request. A new user-requested variation is a new generation and requires a new preset check.
