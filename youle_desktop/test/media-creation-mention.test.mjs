import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadMediaCreationMentionModule() {
  const source = await readFile(
    new URL("../src/renderer/media-creation-mention.ts", import.meta.url),
    "utf8",
  );
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: false,
    },
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(transpiled.outputText).toString("base64")}`
  );
}

const mentionModule = loadMediaCreationMentionModule();
const rendererSource = readFile(
  new URL("../src/renderer/main.ts", import.meta.url),
  "utf8",
);
const stylesSource = readFile(
  new URL("../src/renderer/styles.css", import.meta.url),
  "utf8",
);

function attachments() {
  return [
    { id: "image-a", name: "a.png", mime: "image/png" },
    { id: "video-a", name: "a.mp4", mime: "video/mp4" },
    { id: "image-b", name: "b.jpg", mime: "image/jpeg" },
    { id: "audio-a", name: "a.mp3", mime: "audio/mpeg" },
    { id: "video-b", name: "b.mov", mime: "video/quicktime" },
    { id: "file-a", name: "notes.md", mime: "text/markdown" },
    { id: "folder-a", name: "source", mime: "inode/directory" },
  ];
}

test("media mention candidates number images and videos independently", async () => {
  const { mediaCreationMentionCandidates } = await mentionModule;
  const candidates = mediaCreationMentionCandidates(attachments());

  assert.deepEqual(
    candidates.map(({ attachmentId, label }) => ({ attachmentId, label })),
    [
      { attachmentId: "image-a", label: "图片1" },
      { attachmentId: "video-a", label: "视频1" },
      { attachmentId: "image-b", label: "图片2" },
      { attachmentId: "audio-a", label: "音频1" },
      { attachmentId: "video-b", label: "视频2" },
      { attachmentId: "file-a", label: "文件1" },
      { attachmentId: "folder-a", label: "文件夹1" },
    ],
  );
  assert.deepEqual(
    mediaCreationMentionCandidates(attachments(), "图片2").map(
      ({ attachmentId }) => attachmentId,
    ),
    ["image-b"],
  );
});

test("all attachments submit while selected attachments retain an explicit reference relation", async () => {
  const {
    mediaCreationAttachmentsForSubmission,
    setMediaCreationAttachmentReferenced,
  } = await mentionModule;
  let selected = setMediaCreationAttachmentReferenced(
    attachments(),
    "image-b",
    true,
  );
  selected = setMediaCreationAttachmentReferenced(selected, "video-a", true);

  assert.deepEqual(
    mediaCreationAttachmentsForSubmission(selected).map(({ id }) => id),
    attachments().map(({ id }) => id),
  );
  assert.deepEqual(
    mediaCreationAttachmentsForSubmission(attachments()).map(({ id }) => id),
    attachments().map(({ id }) => id),
  );
});

test("renderer exposes media-only attachment mentions, in-input chips, replacement, previews, and real submission metadata", async () => {
  const source = await rendererSource;
  const styles = await stylesSource;

  assert.match(source, /renderComposerMediaMentionPopover\(thread\.id\)/);
  assert.match(
    source,
    /function renderComposerMediaMentionPopover\([^)]*threadId[^)]*\)[\s\S]*if \(!isMediaCreationComposerThread\(threadId\)\) return "";/,
  );
  assert.match(
    source,
    /function syncComposerMediaMentionPopover\([^)]*\)[\s\S]*if \(!isMediaCreationComposerThread\(currentComposerThreadId\(\)\)\)[\s\S]*resetComposerMediaMentionState\(\);/,
  );
  assert.match(source, /renderMediaCreationReferenceChips\(thread\.id\)/);
  assert.match(
    source,
    /<div class="composer-input-wrap[^"]*">[\s\S]*renderMediaCreationReferenceChips\(thread\.id\)[\s\S]*composer-highlight/,
  );
  assert.match(source, /class="composer-media-mention-popover"/);
  assert.match(source, /dismissComposerSkillMentionPopover\(\);/);
  assert.match(
    source,
    /const submissionSnapshotAttachments\s*=\s*mediaCreationSubmissionAttachments\(threadId, snapshotAttachments\);/,
  );
  assert.match(
    source,
    /const imageUrls = inputAttachments[\s\S]*\.filter\(isImageAttachment\)[\s\S]*\.map\(videoExpertFirstFrameUrl\)/,
  );
  assert.match(
    source,
    /const videoUrls = inputAttachments[\s\S]*\.filter\(isVideoAttachment\)[\s\S]*\.map\(videoExpertFirstFrameUrl\)/,
  );
  assert.match(source, /media_reference_label/);
  assert.match(
    styles,
    /\.composer-media-mention-popover\s*\{[^}]*left:\s*20px;/s,
  );
  assert.match(
    styles,
    /\.composer-skill-popover\s*\{[^}]*left:\s*262px;/s,
  );
  assert.match(
    styles,
    /\.composer:not\(\.media-creation-composer\) \.composer-skill-popover\s*\{[^}]*left:\s*15px;/s,
  );
  assert.match(styles, /\.media-reference-chip\s*\{/);
  assert.match(
    source,
    /MEDIA_REFERENCE_INLINE_PADDING = `\$\{"\\u2002"\.repeat\(3\)\}\\u2004`/,
  );
  assert.match(source, /MEDIA_REFERENCE_SIDE_SPACER = "\\u2009"/);
  assert.match(source, /class="media-reference-anchor"/);
  assert.match(
    source,
    /composerMediaReferenceRanges\(state\.composerText\)\.flatMap/,
  );
  assert.match(source, /data-media-reference-occurrence=/);
  assert.match(source, /function composerMediaReferenceKey\(/);
  assert.match(source, /function renderMediaCreationReferenceHoverPreview\(/);
  assert.match(
    source,
    /media-reference-video-hover-preview[^]*?<video[^>]*muted[^>]*loop[^>]*playsinline/,
  );
  assert.match(
    source,
    /bindMediaHoverPreviewEvents\([\s\S]*button\.querySelector<HTMLElement>\("\.media-reference-hover-preview"\)/,
  );
  assert.match(styles, /\.media-reference-hover-preview\s*\{/);
  assert.match(
    styles,
    /\.media-reference-chip:hover \.media-reference-hover-preview/,
  );
  assert.match(
    styles,
    /\.media-reference-chips:has\(\.media-reference-chip:hover\)[\s\S]*z-index:\s*30;/,
  );
  assert.match(source, /function mediaCreationVisibleComposerText/);
  assert.match(source, /附件引用关系（必须严格遵守）/);
  assert.match(source, /material_id:\s*attachment\.material_id/);
  assert.match(source, /function syncComposerMediaReferenceInlineLayout/);
  assert.match(source, /classList\.toggle\(\s*"show-reference-caret"/);
  assert.match(
    styles,
    /\.media-reference-chip\.show-reference-caret::after\s*\{/,
  );
  assert.match(source, /function handleComposerMediaReferenceDeleteKeydown/);
  assert.match(source, /function handleComposerMediaReferenceArrowKeydown/);
  assert.match(
    source,
    /event\.key === "ArrowLeft" \? target\.leadingStart : target\.end/,
  );
  assert.match(
    source,
    /cursor > range\.leadingStart && cursor <= range\.end[\s\S]*cursor >= range\.leadingStart && cursor < range\.end/,
  );
  assert.match(source, /function composerMediaReferenceTokenRanges\(/);
  assert.match(
    source,
    /function normalizeComposerMediaReferenceLeadingSpacing\(/,
  );
  assert.match(
    source,
    /addEventListener\("input",[\s\S]*if \(!composerComposing\) \{[\s\S]*normalizeComposerMediaReferenceSpacingInInput\(input\);/,
  );
  assert.match(
    source,
    /composerComposing = false;[\s\S]*normalizeComposerMediaReferenceSpacingInInput\(input\);/,
  );
  assert.match(
    source,
    /handleComposerMediaReferenceArrowKeydown\(event\)[\s\S]*handleComposerMediaReferenceDeleteKeydown\(event\)/,
  );
  assert.match(
    source,
    /event\.key !== "Backspace" && event\.key !== "Delete"[\s\S]*if \(selectionStart !== selectionEnd\) \{[\s\S]*return false;[\s\S]*composerMediaReferenceRanges\(input\.value\)[\s\S]*removeComposerMediaReference\([\s\S]*target\.attachmentId,[\s\S]*target\.occurrenceIndex/,
  );
  assert.match(
    styles,
    /\.media-reference-chip\s*\{[^}]*position:\s*absolute;/s,
  );
  assert.match(
    source,
    /chip\.style\.top = `\$\{Math\.max\(0, top - 2\)\}px`;/,
  );
  assert.match(styles, /\.pending-file\.pending-media\s*\{/);
  assert.match(source, /if \(mediaLabel && \(isImage \|\| isVideo\)\)/);
  assert.match(source, /if \(isFolder\)[\s\S]*class="pending-file pending-folder"/);
  assert.match(source, /data-replace-media-attachment=/);
  assert.match(source, /function replacePendingMediaAttachment/);
  assert.match(
    source,
    /if \(isImageAttachment\(attachment\)\)[\s\S]*return firstString\(attachment\.previewUrl, attachment\.url\);[\s\S]*return null;/,
  );
  assert.match(styles, /\.pending-media-hover-preview\s*\{/);
  assert.match(
    source,
    /pending-video-hover-preview[^]*?<video[^>]*muted[^>]*loop[^>]*playsinline/,
  );
  assert.match(source, /previewVideo\.play\(\)/);
  assert.match(source, /previewVideo\.currentTime >= 3/);
  assert.match(
    styles,
    /\.pending-file\.pending-media \.pending-media-replace-indicator\s*\{[^}]*display:\s*inline-flex;[^}]*flex-direction:\s*row;[^}]*font-size:\s*calc\(9px \+ var\(--app-font-size-offset\)\);/s,
  );
  assert.match(
    styles,
    /\.pending-file\.pending-media \.pending-media-hover-preview > img\s*\{[^}]*width:\s*100%;[^}]*height:\s*100%;[^}]*object-fit:\s*cover;/s,
  );
  assert.match(source, /composerRect\.left \+ previewHalfWidth \+ 3/);
  assert.match(
    styles,
    /\.pending-file\.pending-media \.pending-media-remove\s*\{[^}]*top:\s*3px;[^}]*right:\s*3px;/s,
  );
});
