// Current-thread messages already travel in native conversation history. The
// same-group background list must not reintroduce their truncated copies into
// the developer prefix on every user turn. Unknown identities stay untouched.
export function excludeCurrentThreadMemory(files, threadId) {
  const id = String(threadId || "").trim().toLowerCase();
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id)) return files;
  return files.filter(file => !String(file).replace(/\\/g, "/").split("/").at(-1)
    .toLowerCase().endsWith(`-${id}.jsonl`));
}
