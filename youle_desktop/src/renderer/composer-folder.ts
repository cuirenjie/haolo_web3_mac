export const COMPOSER_FOLDER_MIME = "inode/directory";
export const COMPOSER_FOLDER_TYPE_LABEL = "文件夹";

export type ComposerFolderAttachmentLike = {
  mime?: string | null;
  local_path?: string | null;
  localPath?: string | null;
  path?: string | null;
  file_path?: string | null;
  filePath?: string | null;
};

export type ComposerFolderDescriptor = {
  path: string;
  name: string;
};

export function isComposerFolderAttachment(attachment: ComposerFolderAttachmentLike | null | undefined) {
  return attachment?.mime?.trim().toLowerCase() === COMPOSER_FOLDER_MIME;
}

export function composerFolderAttachment(
  folder: ComposerFolderDescriptor,
  id: string,
) {
  const localPath = folder.path.trim();
  return {
    id,
    name: folder.name.trim() || localPath,
    mime: COMPOSER_FOLDER_MIME,
    size: null,
    object_key: null,
    url: null,
    local_path: localPath,
    path: localPath,
    uploadStatus: "uploaded" as const,
    uploadError: null,
    queueFingerprint: `folder:${normalizeComposerFolderPath(localPath)}`,
  };
}

export function composerFolderContextInstruction(folderCount: number) {
  const count = Math.max(1, Math.trunc(folderCount));
  return [
    "文件夹上下文要求（内部执行要求，不要向用户复述）：",
    `本次附加了 ${count} 个本地文件夹。请先递归读取每个文件夹及其所有子文件夹中的全部可读文件内容，把这些内容作为本次任务的上下文，再执行用户要求。`,
    "不要要求用户重新提供文件夹内的文件；如果个别文件确实无法读取，请说明具体文件和原因，并继续处理其余内容。",
  ].join("\n");
}

function normalizeComposerFolderPath(folderPath: string) {
  return folderPath.trim().replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
}
