export const WINDOWS_UTF8_PIPE_BOOTSTRAP =
  "$env:PYTHONIOENCODING='utf-8'; $env:PYTHONUTF8='1'; $OutputEncoding = [Console]::OutputEncoding = [Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)";

const WINDOWS_UTF8_REMINDER_START = "<haolo_windows_utf8_reminder>";
const WINDOWS_UTF8_REMINDER_END = "</haolo_windows_utf8_reminder>";

export function buildWindowsUtf8ShellReminder(platform = process.platform) {
  if (platform !== "win32") return null;
  return [
    WINDOWS_UTF8_REMINDER_START,
    "Internal execution rule for this turn on Windows:",
    "- Windows PowerShell 5.1 may keep `$OutputEncoding` as US-ASCII even when console output is UTF-8. If you pipe text into native tools, Chinese paths can become literal question marks before Python/Node receives them, for example `D:\\AI???\\Haolo\\????`.",
    `- Before any pipeline into native tools such as \`python -\`, \`node -\`, or stdin-driven scripts, run exactly: \`${WINDOWS_UTF8_PIPE_BOOTSTRAP}\`.`,
    "- Prefer not to pipe non-ASCII source through PowerShell at all. Write a UTF-8 script/input file first, or pass Chinese file and folder paths as command-line arguments, environment variables, or UTF-8 JSON files.",
    "- Do not embed Chinese paths in a PowerShell here-string that is piped directly to Python/Node, such as `@'...中文路径...'@ | python -`, unless the UTF-8 bootstrap above has already been applied in the same command.",
    "- If Python prints a path containing `???` or `????`, treat it as a PowerShell pipeline encoding bug, not as evidence that the user's Chinese-named folder or file is missing. Re-run using argv/env/UTF-8 file input and verify again.",
    "- After creating a DOCX/XLSX/PDF or other file with Chinese content or a Chinese filename, verify the real path exists and the file content/name still contains CJK characters rather than `????` before saying the file is done.",
    WINDOWS_UTF8_REMINDER_END,
  ].join("\n");
}

export function stripWindowsUtf8ShellReminder(text) {
  let cleanText = String(text || "");
  for (let guard = 0; guard < 20; guard += 1) {
    const start = cleanText.indexOf(WINDOWS_UTF8_REMINDER_START);
    if (start < 0) break;
    const end = cleanText.indexOf(WINDOWS_UTF8_REMINDER_END, start + WINDOWS_UTF8_REMINDER_START.length);
    cleanText =
      end >= 0
        ? `${cleanText.slice(0, start)}${cleanText.slice(end + WINDOWS_UTF8_REMINDER_END.length)}`
        : cleanText.slice(0, start);
  }
  return cleanText;
}

export function prependWindowsUtf8ShellReminder(text, platform = process.platform) {
  const cleanText = stripWindowsUtf8ShellReminder(text).trim();
  const reminder = buildWindowsUtf8ShellReminder(platform);
  return [reminder, cleanText].filter(Boolean).join("\n\n").trim();
}

export function windowsUtf8DesktopInstruction() {
  return [
    "- On Windows, preserve Chinese folder names, Chinese filenames, and other non-ASCII paths when invoking Python/Node or generating scripts.",
    `  PowerShell pipeline bootstrap: \`${WINDOWS_UTF8_PIPE_BOOTSTRAP}\`.`,
    "  Prefer UTF-8 files or argv/env/JSON path passing over `@'...中文...'@ | python -`; if a path becomes `???`, redo the command with the bootstrap or non-pipeline input before concluding the path does not exist.",
  ].join("\n");
}
