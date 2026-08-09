import { spawn } from "node:child_process";

const MINIMUM_INTERVAL_SECONDS = 300;

export function validateSchedule({ type, expr, timezone = "UTC" } = {}) {
  try {
    if (!["once", "interval", "daily", "weekly", "cron", "manual", "idle"].includes(type)) {
      return { ok: false, error: "Unsupported schedule type." };
    }
    if (type === "manual" || type === "idle") return { ok: true };
    if (!timezone || typeof timezone !== "string") {
      return { ok: false, error: "Timezone is required." };
    }
    assertValidTimezone(timezone);
    if (!expr || typeof expr !== "string") {
      return { ok: false, error: "Schedule expression is required." };
    }
    if (type === "once") {
      const date = new Date(expr);
      if (Number.isNaN(date.getTime())) return { ok: false, error: "Invalid once timestamp." };
      return { ok: true };
    }
    if (type === "interval") {
      const seconds = parseIsoDurationSeconds(expr);
      if (seconds < MINIMUM_INTERVAL_SECONDS) {
        return { ok: false, error: `Interval must be at least ${MINIMUM_INTERVAL_SECONDS} seconds.` };
      }
      return { ok: true };
    }
    if (type === "daily") {
      parseTimeOfDay(expr);
      return { ok: true };
    }
    if (type === "weekly") {
      parseWeeklyExpression(expr);
      return { ok: true };
    }
    parseCron(expr);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function computeNextRunAtUtc({ type, expr, timezone = "UTC", nowUtc, lastRunAtUtc } = {}) {
  const validation = validateSchedule({ type, expr, timezone });
  if (!validation.ok) throw new Error(validation.error);
  const now = nowUtc ? new Date(nowUtc) : new Date();
  if (type === "manual" || type === "idle") return null;
  if (type === "once") {
    return new Date(expr).toISOString();
  }
  if (type === "interval") {
    const anchor = lastRunAtUtc ? new Date(lastRunAtUtc) : now;
    return new Date(anchor.getTime() + parseIsoDurationSeconds(expr) * 1000).toISOString();
  }
  if (type === "daily") {
    const { hour, minute } = parseTimeOfDay(expr);
    return nextCronRunUtc({ expr: `${minute} ${hour} * * *`, timezone, afterUtc: now }).toISOString();
  }
  if (type === "weekly") {
    const { weekday, hour, minute } = parseWeeklyExpression(expr);
    return nextCronRunUtc({ expr: `${minute} ${hour} * * ${weekday}`, timezone, afterUtc: now }).toISOString();
  }
  return nextCronRunUtc({ expr, timezone, afterUtc: now }).toISOString();
}

export function buildLoginTaskCommand({ taskName, workerPath, workerArgs = ["--background"] }) {
  const quotedWorker = `"${String(workerPath).replace(/"/g, '\\"')}" ${workerArgs.join(" ")}`;
  return [
    "schtasks",
    "/Create",
    "/TN",
    taskName,
    "/TR",
    quotedWorker,
    "/SC",
    "ONLOGON",
    "/RL",
    "LIMITED",
    "/F",
  ];
}

export function registerLoginTask({ taskName, workerPath, workerArgs, spawnImpl = spawn } = {}) {
  if (process.platform !== "win32") {
    return Promise.resolve({ ok: false, skipped: true, reason: "Windows Task Scheduler is only available on Windows." });
  }
  const [command, ...args] = buildLoginTaskCommand({ taskName, workerPath, workerArgs });
  return runPlatformCommand(command, args, spawnImpl);
}

export function unregisterLoginTask({ taskName, spawnImpl = spawn } = {}) {
  if (process.platform !== "win32") {
    return Promise.resolve({ ok: false, skipped: true, reason: "Windows Task Scheduler is only available on Windows." });
  }
  return runPlatformCommand("schtasks", ["/Delete", "/TN", taskName, "/F"], spawnImpl);
}

function runPlatformCommand(command, args, spawnImpl) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ ok: code === 0, exitCode: code, stdout, stderr }));
  });
}

function assertValidTimezone(timezone) {
  new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
}

function parseIsoDurationSeconds(expr) {
  const match = String(expr).trim().match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i);
  if (!match) throw new Error("Invalid ISO-8601 duration.");
  const days = Number(match[1] || 0);
  const hours = Number(match[2] || 0);
  const minutes = Number(match[3] || 0);
  const seconds = Number(match[4] || 0);
  const total = days * 86400 + hours * 3600 + minutes * 60 + seconds;
  if (!total) throw new Error("Interval duration must be greater than zero.");
  return total;
}

function parseTimeOfDay(expr) {
  const match = String(expr || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) throw new Error("Time must use HH:mm format.");
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error("Invalid time of day.");
  }
  return { hour, minute };
}

function parseWeeklyExpression(expr) {
  const match = String(expr || "").trim().match(/^([0-6])\s+(\d{1,2}:\d{2})$/);
  if (!match) throw new Error("Weekly expression must use '<weekday> HH:mm'.");
  return {
    weekday: Number(match[1]),
    ...parseTimeOfDay(match[2]),
  };
}

function parseCron(expr) {
  const parts = String(expr).trim().split(/\s+/);
  if (parts.length !== 5) throw new Error("Cron expression must have five fields.");
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  return {
    minute: parseCronField(minute, 0, 59),
    hour: parseCronField(hour, 0, 23),
    dayOfMonth: parseCronField(dayOfMonth, 1, 31),
    month: parseCronField(month, 1, 12),
    dayOfWeek: parseCronField(dayOfWeek, 0, 7).map((value) => (value === 7 ? 0 : value)),
  };
}

function parseCronField(field, min, max) {
  const values = new Set();
  for (const part of field.split(",")) {
    const [rangePart, stepPart] = part.split("/");
    const step = stepPart ? Number(stepPart) : 1;
    if (!Number.isInteger(step) || step <= 0) throw new Error(`Invalid cron step: ${part}`);
    let start;
    let end;
    if (rangePart === "*") {
      start = min;
      end = max;
    } else if (rangePart.includes("-")) {
      const [a, b] = rangePart.split("-").map(Number);
      start = a;
      end = b;
    } else {
      start = Number(rangePart);
      end = start;
    }
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) {
      throw new Error(`Invalid cron field: ${field}`);
    }
    for (let value = start; value <= end; value += step) values.add(value);
  }
  return [...values].sort((a, b) => a - b);
}

function nextCronRunUtc({ expr, timezone, afterUtc }) {
  const cron = parseCron(expr);
  let cursor = new Date(afterUtc.getTime() + 60_000);
  cursor.setUTCSeconds(0, 0);
  const end = afterUtc.getTime() + 366 * 5 * 24 * 60 * 60 * 1000;
  while (cursor.getTime() <= end) {
    const parts = zonedParts(cursor, timezone);
    const matches =
      cron.minute.includes(parts.minute) &&
      cron.hour.includes(parts.hour) &&
      cron.dayOfMonth.includes(parts.day) &&
      cron.month.includes(parts.month) &&
      cron.dayOfWeek.includes(parts.weekday);
    if (matches) return cursor;
    cursor = new Date(cursor.getTime() + 60_000);
  }
  throw new Error("No matching cron time found within five years.");
}

function zonedParts(date, timezone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
    weekday: "short",
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  const weekdays = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    weekday: weekdays[parts.weekday],
  };
}
