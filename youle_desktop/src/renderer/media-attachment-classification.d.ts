export type MediaAttachmentLike = {
  name?: string | null;
  mime?: string | null;
  object_key?: string | null;
  objectKey?: string | null;
  file_key?: string | null;
  fileKey?: string | null;
  image_key?: string | null;
  imageKey?: string | null;
  video_key?: string | null;
  videoKey?: string | null;
};

export function isFeishuImageAttachment(attachment: MediaAttachmentLike): boolean;
export function isFeishuVideoAttachment(attachment: MediaAttachmentLike): boolean;
export function isImageAttachment(attachment: MediaAttachmentLike): boolean;
export function isVideoAttachment(attachment: MediaAttachmentLike): boolean;
