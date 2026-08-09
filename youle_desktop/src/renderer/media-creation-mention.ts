export type MediaCreationMentionKind =
  | "image"
  | "video"
  | "audio"
  | "file"
  | "folder";

export type MediaCreationMentionAttachment = {
  id: string;
  name: string;
  mime?: string | null;
  mediaReferenced?: boolean;
};

export type MediaCreationMentionCandidate = {
  attachmentId: string;
  kind: MediaCreationMentionKind;
  ordinal: number;
  label: string;
  name: string;
  selected: boolean;
};

export function mediaCreationMentionKind(
  attachment: Pick<MediaCreationMentionAttachment, "name" | "mime">,
): MediaCreationMentionKind | null {
  const mime = String(attachment.mime || "").trim().toLowerCase();
  const name = String(attachment.name || "").trim();
  if (
    mime.startsWith("image/") ||
    /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)$/i.test(name)
  ) {
    return "image";
  }
  if (
    mime.startsWith("video/") ||
    /\.(?:m4v|mkv|mov|mp4|webm)$/i.test(name)
  ) {
    return "video";
  }
  if (
    mime.startsWith("audio/") ||
    /\.(?:aac|flac|m4a|mp3|ogg|wav)$/i.test(name)
  ) {
    return "audio";
  }
  if (mime === "inode/directory") return "folder";
  return "file";
}

export function mediaCreationMentionCandidates<
  T extends MediaCreationMentionAttachment,
>(attachments: readonly T[], query = ""): MediaCreationMentionCandidate[] {
  const ordinals: Record<MediaCreationMentionKind, number> = {
    image: 0,
    video: 0,
    audio: 0,
    file: 0,
    folder: 0,
  };
  const labels: Record<MediaCreationMentionKind, string> = {
    image: "图片",
    video: "视频",
    audio: "音频",
    file: "文件",
    folder: "文件夹",
  };
  const candidates = attachments.flatMap((attachment) => {
    const kind = mediaCreationMentionKind(attachment);
    if (!kind) return [];
    const ordinal = ++ordinals[kind];
    return [{
      attachmentId: attachment.id,
      kind,
      ordinal,
      label: `${labels[kind]}${ordinal}`,
      name: attachment.name,
      selected: attachment.mediaReferenced === true,
    }];
  });
  const normalizedQuery = normalizeMediaMentionQuery(query);
  if (!normalizedQuery) return candidates;
  return candidates.filter((candidate) =>
    normalizeMediaMentionQuery(
      `${candidate.label} ${candidate.name}`,
    ).includes(normalizedQuery),
  );
}

export function setMediaCreationAttachmentReferenced<
  T extends MediaCreationMentionAttachment,
>(attachments: readonly T[], attachmentId: string, referenced: boolean): T[] {
  return attachments.map((attachment) =>
    attachment.id === attachmentId
      ? { ...attachment, mediaReferenced: referenced }
      : attachment,
  );
}

export function mediaCreationAttachmentsForSubmission<
  T extends MediaCreationMentionAttachment,
>(attachments: readonly T[]): T[] {
  return [...attachments];
}

function normalizeMediaMentionQuery(value: string) {
  return String(value || "").trim().toLowerCase().replace(/^@/, "");
}
