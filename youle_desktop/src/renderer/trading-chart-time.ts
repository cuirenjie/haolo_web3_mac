// Numeric UTC-shifted axis labels shared by all chart panes.
export function chartTickLabel(timeValue: number, interval: string) {
  const normalizedInterval = String(interval || "").trim();
  const date = new Date(timeValue * 1000);
  const hour = date.getUTCHours();
  const minute = date.getUTCMinutes();
  const day = date.getUTCDate();
  const month = date.getUTCMonth() + 1;
  const pad = (value: number) => String(value).padStart(2, "0");
  const time = `${pad(hour)}:${pad(minute)}`;
  const monthDay = `${pad(month)}/${pad(day)}`;
  if (normalizedInterval === "1" || normalizedInterval === "5") {
    if (minute !== 0) return null;
    return hour === 0 ? monthDay : time;
  }
  if (normalizedInterval === "15") {
    if (minute !== 0 || hour % 6 !== 0) return null;
    return hour === 0 ? monthDay : time;
  }
  if (normalizedInterval === "60") {
    if (minute !== 0 || hour % 12 !== 0) return null;
    return hour === 0 ? monthDay : time;
  }
  if (normalizedInterval === "240") return minute === 0 && hour === 0 ? monthDay : null;
  if (normalizedInterval === "1D") {
    return day === 1 ? `${date.getUTCFullYear()}/${pad(month)}` : null;
  }
  const monthly = /^(\d+)M$/.exec(normalizedInterval);
  if (monthly) {
    const monthCount = Number(monthly[1]);
    if (monthCount % 12 === 0) return month === 1 && day === 1 ? String(date.getUTCFullYear()) : null;
    return day === 1 ? `${date.getUTCFullYear()}/${pad(month)}` : null;
  }
  return null;
}
