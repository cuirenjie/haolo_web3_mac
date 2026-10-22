---
name: videogen
description: Generate image-to-video clips using the selected live Haolo video catalog model.
---

# Video generation

Supported model contracts: `bytedance/seedance-2.0` and `omni_flash-10s`. Use a model only when it is present in the live catalog. Preserve an explicit selection; never switch providers automatically. If no compatible model is available, explain that video generation is unavailable.

Both contracts require reference images and a prompt. Seedance supports 720p, 4–15 seconds and the ratios advertised by the catalog. Omni Flash requires one image, 720p, 10 seconds, and 9:16 or 16:9. Do not invoke text-only or source-video modes.

Invoke `scripts/generate_seedance_video.py --prompt "PROMPT" --model "SELECTED MODEL" --exact-model --input-mode image-to-video --image-url "HTTPS IMAGE" --aspect-ratio "SELECTED RATIO" --resolution 720p --duration "SELECTED DURATION" --request-id "STABLE REQUEST ID" --conversation-id "CURRENT CONVERSATION" --output-dir "outputs/videos"`.

The script uses the existing Haolo model credential. It submits once, persists the accepted task ID, polls it, then saves the video. For continuation use `--resume-latest --conversation-id "CURRENT CONVERSATION" --job-dir "SAME JOB DIRECTORY"`. This never creates a new task. Reuse the original request ID for retries of delivery.

If submission returns no task ID, acceptance is unknown: report the failure without resubmitting. A polling timeout is pending; continue polling the same task. Old tasks from removed routes cannot be resumed. Only claim completion after a local video file has been saved.

## Prompt and delivery

If it already contains a concrete subject and action plus at least two useful production dimensions (setting, camera/composition, lighting/color, style, timing or constraints), pass it to the script exactly unchanged. Only improve a very brief or underspecified request, preserving the user's language and intent.

Never show the selected or actual model name, provider name, or task id in routine user-facing completion messages; keep that metadata internal for recovery and diagnostics. Show the saved video and concise delivery status. Explain technical routing when the user explicitly requests technical details.
