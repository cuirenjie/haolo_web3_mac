import { spawn } from "node:child_process";
import fs from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]+/g,
  /sess-[A-Za-z0-9_-]+/g,
  /(Authorization:\s*Bearer\s+)[^\s]+/gi,
  /(YOULE_DESKTOP_API_KEY=)[^\s]+/g,
];

export function buildExecArgs({ workspacePath, sandboxMode, approvalPolicy, finalMessagePath, profile, model } = {}) {
  const args = [
    "exec",
    "--json",
    "--skip-git-repo-check",
    "--cd",
    workspacePath,
    "--sandbox",
    sandboxMode || "read-only",
    "-c",
    `approval_policy="${approvalPolicy || "never"}"`,
    "--output-last-message",
    finalMessagePath,
  ];
  if (profile) args.push("--profile", profile);
  if (model) args.push("--model", model);
  args.push("-");
  return args;
}

export async function probeYouleAiEnvironment({ youleAiBin, gitCommand = "git" } = {}) {
  const version = await runCommand(youleAiBin, ["--version"]);
  const help = await runCommand(youleAiBin, ["exec", "--help"]);
  const git = await runCommand(gitCommand, ["--version"]);
  const helpText = help.stdout || "";
  return {
    youleAiBin,
    youleAi: {
      ok: version.code === 0,
      version: version.stdout.trim(),
      error: version.code === 0 ? null : version.stderr || `exit ${version.code}`,
    },
    capabilities: {
      supportsExecJson: help.code === 0 && /--json/.test(helpText),
      supportsOutputLastMessage: help.code === 0 && /--output-last-message/.test(helpText),
      supportsSandboxFlag: help.code === 0 && /--sandbox/.test(helpText),
      supportsCdFlag: help.code === 0 && /--cd|-C/.test(helpText),
      supportsApprovalPolicyConfig: help.code === 0 && /(^|\s)-c(,|\s|$)|--config/.test(helpText),
      supportsAskForApprovalExecFlag: help.code === 0 && /--ask-for-approval/.test(helpText),
    },
    git: {
      ok: git.code === 0,
      version: git.stdout.trim(),
      error: git.code === 0 ? null : git.stderr || `exit ${git.code}`,
    },
  };
}

export async function runYouleAiExec(opts) {
  await mkdir(opts.runDir, { recursive: true });
  const finalMessagePath = path.join(opts.runDir, "final.md");
  const jsonlPath = path.join(opts.runDir, "events.jsonl");
  const stderrPath = path.join(opts.runDir, "stderr.log");
  const args = buildExecArgs({ ...opts, finalMessagePath });
  const events = [];
  const stderrLines = [];
  let timedOut = false;
  let timeoutReason = null;
  let cancelled = false;
  let stdoutBuffer = "";
  let stderrBuffer = "";

  let child;
  let maxTimeout;
  let startupTimeout;
  let noOutputTimeout;
  try {
    const command = spawnCommand(opts.youleAiBin);
    child = spawn(command.command, [...command.prefixArgs, ...args], {
      cwd: opts.workspacePath,
      env: { ...process.env, ...opts.env, NO_COLOR: "1" },
      windowsHide: true,
      shell: needsShell(command.command),
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (error) {
    return missingCliResult({ error, finalMessagePath, jsonlPath, stderrPath, runDir: opts.runDir });
  }
  opts.onChild?.(child);
  const clearWatchdogs = () => {
    clearTimeout(maxTimeout);
    clearTimeout(startupTimeout);
    clearTimeout(noOutputTimeout);
  };
  const timeoutChild = (reason) => {
    if (timedOut || cancelled) return;
    timedOut = true;
    timeoutReason = reason;
    killChild(child, opts.cleanupGraceMs);
  };
  const armNoOutputTimeout = () => {
    if (!opts.noOutputTimeoutMs) return;
    clearTimeout(noOutputTimeout);
    noOutputTimeout = setTimeout(() => timeoutChild("no_output_timeout"), opts.noOutputTimeoutMs);
  };
  const markOutput = () => {
    clearTimeout(startupTimeout);
    armNoOutputTimeout();
  };
  const cancelChild = () => {
    cancelled = true;
    clearWatchdogs();
    killChild(child, opts.cleanupGraceMs);
  };
  if (opts.signal?.aborted) {
    cancelChild();
  } else {
    opts.signal?.addEventListener("abort", cancelChild, { once: true });
  }

  maxTimeout = setTimeout(() => timeoutChild("timeout"), opts.timeoutMs || 30_000);
  if (opts.startupTimeoutMs) {
    startupTimeout = setTimeout(() => timeoutChild("startup_timeout"), opts.startupTimeoutMs);
  }

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    markOutput();
    fs.appendFileSync(jsonlPath, chunk);
    stdoutBuffer += chunk;
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) emitStdoutLine(line, events, opts.onEvent);
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    markOutput();
    const redacted = redactSecrets(chunk);
    fs.appendFileSync(stderrPath, redacted);
    stderrBuffer += redacted;
    const lines = stderrBuffer.split(/\r?\n/);
    stderrBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      stderrLines.push(line);
      opts.onStderr?.(line);
    }
  });

  child.stdin.on("error", (error) => {
    if (isIgnorableStdinError(error, { cancelled, timedOut })) return;
    stderrLines.push(error.message);
  });
  try {
    if (cancelled || timedOut) {
      child.stdin.destroy();
    } else {
      child.stdin.write(opts.prompt || "");
      child.stdin.end();
    }
  } catch (error) {
    if (!isIgnorableStdinError(error, { cancelled, timedOut })) {
      throw error;
    }
  }

  const exitCode = await new Promise((resolve) => {
    child.on("error", (error) => {
      clearWatchdogs();
      stderrLines.push(error.message);
      fs.appendFileSync(stderrPath, redactSecrets(error.message));
      resolve(127);
    });
    child.on("close", (code) => {
      clearWatchdogs();
      if (stdoutBuffer.trim()) emitStdoutLine(stdoutBuffer, events, opts.onEvent);
      if (stderrBuffer.trim()) stderrLines.push(stderrBuffer.trim());
      resolve(code);
    });
  });

  const finalMessage = await readOptional(finalMessagePath);
  const patchPath = await collectPatch(opts.workspacePath, opts.runDir);
  const hasPatch = Boolean(patchPath);
  const failedEvent = findFailedEvent(events, { exitCode, finalMessage });
  const status = classifyRun({ timedOut, cancelled, exitCode, finalMessage, failedEvent, stderrLines });
  const summary = finalMessage.trim() || failedEvent?.error || failedEvent?.message || stderrLines.at(-1) || "";
  const errorClass = classifyError({ status, cancelled, timedOut, timeoutReason, failedEvent, exitCode, summary, stderrLines });
  const usage = extractUsage(events);
  const artifacts = [
    await artifact("final_message", finalMessagePath),
    await artifact("jsonl", jsonlPath),
    await artifact("stderr", stderrPath),
    patchPath ? await artifact("patch", patchPath) : null,
  ].filter(Boolean);

  return {
    exitCode,
    status,
    summary,
    finalMessagePath,
    jsonlPath,
    stderrPath,
    patchPath,
    hasPatch,
    hasFindings: status !== "no_findings" && Boolean(summary || hasPatch),
    events,
    artifacts,
    ...usage,
    errorClass,
    errorMessage: ["failed", "timed_out", "needs_attention"].includes(status) ? summary || `Exited with ${exitCode}` : null,
  };
}

export function redactSecrets(value) {
  let output = String(value || "");
  for (const pattern of SECRET_PATTERNS) {
    output = output.replace(pattern, (match, prefix) => `${prefix || ""}[redacted]`);
  }
  return output;
}

function emitStdoutLine(line, events, onEvent) {
  const trimmed = line.trim();
  if (!trimmed) return;
  let event;
  try {
    event = JSON.parse(trimmed);
  } catch {
    event = { type: "unparsed_stdout", text: trimmed };
  }
  events.push(event);
  onEvent?.(event);
}

function classifyRun({ timedOut, cancelled, exitCode, finalMessage, failedEvent, stderrLines = [] }) {
  if (cancelled) return "cancelled";
  if (timedOut) return "timed_out";
  const diagnosticText = `${finalMessage || ""}\n${stderrLines.join("\n")}`;
  if (isMissingCli(diagnosticText, exitCode)) return "needs_attention";
  if ((exitCode || !String(finalMessage || "").trim()) && isAuthExpired(diagnosticText)) return "needs_attention";
  if (exitCode && exitCode !== 0) return "failed";
  if (failedEvent) return "failed";
  if (isNoFindingsFinal(finalMessage)) return "no_findings";
  return "success";
}

function findFailedEvent(events, { exitCode, finalMessage } = {}) {
  const hasSuccessfulFinalMessage = !exitCode && Boolean(String(finalMessage || "").trim());
  return (
    events.find((event) => {
      if (!isFailureEvent(event)) return false;
      return !(hasSuccessfulFinalMessage && isRetryableFailureEvent(event));
    }) || null
  );
}

function isFailureEvent(event) {
  return event?.type === "turn.failed" || event?.type === "error" || event?.event_type === "error";
}

function isRetryableFailureEvent(event) {
  if (hasRetryFlag(event)) return true;
  const text = JSON.stringify(event || {});
  return /Reconnecting\.\.\.|responseStreamDisconnected|stream disconnected|please retry later/i.test(text);
}

function hasRetryFlag(value) {
  if (!value || typeof value !== "object") return false;
  if (value.willRetry === true || value.will_retry === true) return true;
  return hasRetryFlag(value.error) || hasRetryFlag(value.codexErrorInfo) || hasRetryFlag(value.params);
}

function classifyError({ status, cancelled, timedOut, timeoutReason, failedEvent, exitCode, summary, stderrLines = [] }) {
  if (status === "success" || status === "no_findings") return null;
  const text = `${summary || ""}\n${stderrLines.join("\n")}`;
  if (cancelled) return "cancelled";
  if (timedOut) return timeoutReason || "timeout";
  if (isMissingCli(text, exitCode)) return "youle_ai_cli_missing";
  if (isAuthExpired(text)) return "youle_ai_auth_expired";
  if (failedEvent) return "youle_ai_turn_failed";
  if (exitCode) return "youle_ai_exit_code";
  return status === "needs_attention" ? "needs_attention" : null;
}

function isIgnorableStdinError(error, { cancelled, timedOut }) {
  return (cancelled || timedOut) && ["EPIPE", "ERR_STREAM_DESTROYED"].includes(error?.code);
}

function extractUsage(events) {
  const usage = {};
  for (const event of events) {
    const source = event?.usage || event?.token_usage || event?.metrics?.usage;
    if (!source || typeof source !== "object") continue;
    usage.inputTokens = numberOrNull(source.input_tokens ?? source.inputTokens ?? source.prompt_tokens);
    usage.cachedInputTokens = numberOrNull(source.cached_input_tokens ?? source.cachedInputTokens);
    usage.outputTokens = numberOrNull(source.output_tokens ?? source.outputTokens ?? source.completion_tokens);
    usage.reasoningOutputTokens = numberOrNull(source.reasoning_output_tokens ?? source.reasoningOutputTokens);
  }
  return Object.fromEntries(Object.entries(usage).filter(([, value]) => value != null));
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isNoFindingsFinal(value) {
  const text = String(value || "").trim();
  return /^(?:NO_FINDINGS|无发现|没有发现)[.!。！\s]*$/i.test(text);
}

function isAuthExpired(text) {
  return /\b(401|403|unauthori[sz]ed|auth(?:entication)?\s+(?:expired|required|failed)|not\s+logged\s+in|login\s+again)\b/i.test(text || "");
}

function isMissingCli(text, exitCode) {
  return exitCode === 127 || /\b(ENOENT|not found|no such file|cannot find|spawn .* enoent)\b/i.test(text || "");
}

function needsShell(command) {
  return process.platform === "win32" && /\.(cmd|bat)$/i.test(command || "");
}

function spawnCommand(command) {
  if (process.platform === "win32" && /\.(?:mjs|cjs|js)$/i.test(command || "")) {
    return { command: process.execPath, prefixArgs: [command] };
  }
  return { command, prefixArgs: [] };
}

function killChild(child, cleanupGraceMs = 0) {
  if (process.platform === "win32" && child.pid) {
    if (cleanupGraceMs > 0) {
      child.kill("SIGTERM");
      const forceKill = setTimeout(() => {
        const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
        killer.on("error", () => child.kill("SIGKILL"));
      }, cleanupGraceMs);
      forceKill.unref?.();
      return;
    }
    const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
    killer.on("error", () => child.kill("SIGKILL"));
    return;
  }
  if (cleanupGraceMs > 0) {
    child.kill("SIGTERM");
    const forceKill = setTimeout(() => child.kill("SIGKILL"), cleanupGraceMs);
    forceKill.unref?.();
    return;
  }
  child.kill("SIGKILL");
}

async function readOptional(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

export async function artifact(type, filePath) {
  try {
    const info = await stat(filePath);
    return { type, path: filePath, sizeBytes: info.size };
  } catch {
    return null;
  }
}

async function missingCliResult({ error, finalMessagePath, jsonlPath, stderrPath }) {
  await writeFile(finalMessagePath, "");
  await writeFile(jsonlPath, "");
  await writeFile(stderrPath, redactSecrets(error instanceof Error ? error.message : String(error)));
  return {
    exitCode: 127,
    status: "needs_attention",
    summary: "Youle AI CLI is missing or cannot be launched.",
    finalMessagePath,
    jsonlPath,
    stderrPath,
    patchPath: null,
    hasPatch: false,
    hasFindings: true,
    events: [],
    artifacts: [
      await artifact("final_message", finalMessagePath),
      await artifact("jsonl", jsonlPath),
      await artifact("stderr", stderrPath),
    ].filter(Boolean),
    errorClass: "youle_ai_cli_missing",
    errorMessage: error instanceof Error ? error.message : String(error),
  };
}

export async function collectPatch(workspacePath, runDir) {
  if (!workspacePath) return null;
  const gitDir = path.join(workspacePath, ".git");
  if (!fs.existsSync(gitDir)) return null;
  const patchPath = path.join(runDir, "patch.diff");
  const parts = [];
  const tracked = await runCommand("git", ["-C", workspacePath, "diff", "--binary", "HEAD"]);
  if (tracked.code === 0 && tracked.stdout.trim()) {
    parts.push(tracked.stdout);
  }
  const untracked = await runCommand("git", ["-C", workspacePath, "ls-files", "--others", "--exclude-standard", "-z"]);
  if (untracked.code === 0 && untracked.stdout) {
    for (const relativePath of untracked.stdout.split("\0").filter(Boolean)) {
      const diff = await runCommand("git", ["-C", workspacePath, "diff", "--binary", "--no-index", "--", "/dev/null", relativePath]);
      if ((diff.code === 0 || diff.code === 1) && diff.stdout.trim()) {
        parts.push(diff.stdout);
      }
    }
  }
  const patch = parts.join("\n");
  if (!patch.trim()) return null;
  await writeFile(patchPath, patch);
  return patchPath;
}

function runCommand(command, args) {
  return new Promise((resolve) => {
    const spawnTarget = spawnCommand(command);
    const child = spawn(spawnTarget.command, [...spawnTarget.prefixArgs, ...args], { windowsHide: true, shell: needsShell(spawnTarget.command) });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => resolve({ code: 127, stdout, stderr: error.message }));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}
