export const COMPOSER_PASTE_TEXT_FILE_THRESHOLD_CHARS = 10_000;
export const COMPOSER_PASTE_TEXT_FILE_NAME = "用户粘贴内容.txt";
export const COMPOSER_PASTE_TEXT_FILE_NOTICE = "粘贴内容过多，已转为TXT文档";

export function shouldConvertComposerPastedTextToFile(text: string) {
  return text.length >= COMPOSER_PASTE_TEXT_FILE_THRESHOLD_CHARS;
}

export function createComposerPastedTextFile(text: string, lastModified = Date.now()) {
  return new File([text], COMPOSER_PASTE_TEXT_FILE_NAME, {
    type: "text/plain",
    lastModified,
  });
}
