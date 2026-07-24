const BEIJING_TIME_ZONE = "Asia/Shanghai";
const MINUTES_PER_DAY = 24 * 60;

function beijingParts(now = new Date()) {
  const instant = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(instant.getTime())) throw new TypeError("北京时间参数无效");
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: BEIJING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const date = `${values.year}-${values.month}-${values.day}`;
  const time = `${values.hour}:${values.minute}:${values.second}`;
  return {
    date,
    time,
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
    minuteOfDay: Number(values.hour) * 60 + Number(values.minute),
    isoOffset: `${date}T${time}+08:00`,
    timeZone: BEIJING_TIME_ZONE,
  };
}

function beijingDateKey(now = new Date()) {
  return beijingParts(now).date;
}

function addBusinessDays(dateKey, days) {
  const match = String(dateKey || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function timeTokenToMinutes(value) {
  const match = String(value || "").trim().match(/^(\d{1,2})\s*[:：﹕时]\s*(\d{1,2})(?:\s*分)?$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function parseBusinessTimeRange(value) {
  const normalized = String(value || "")
    .replace(/[—–－~～至到]/g, "-")
    .replace(/\s+/g, "")
    .replace(/时(?=\d)/g, ":")
    .replace(/分/g, "");
  if (!/^[^-]+-[^-]+$/.test(normalized)) return null;
  const [startToken, endToken] = normalized.split("-");
  const start = timeTokenToMinutes(startToken);
  const end = timeTokenToMinutes(endToken);
  if (start == null || end == null || start === end) return null;
  return { start, end, crossesMidnight: end < start };
}

// Business intervals are start-inclusive and end-exclusive. A cross-midnight
// interval belongs to the course date and may continue into the following day.
function isBeijingBusinessTimeInRange({ courseDate, timeSlot, now = new Date() } = {}) {
  const range = parseBusinessTimeRange(timeSlot);
  if (!range || !/^\d{4}-\d{2}-\d{2}$/.test(String(courseDate || ""))) return false;
  const current = beijingParts(now);
  if (!range.crossesMidnight) {
    return courseDate === current.date && current.minuteOfDay >= range.start && current.minuteOfDay < range.end;
  }
  return (courseDate === current.date && current.minuteOfDay >= range.start)
    || (addBusinessDays(courseDate, 1) === current.date && current.minuteOfDay < range.end);
}

module.exports = {
  BEIJING_TIME_ZONE,
  MINUTES_PER_DAY,
  addBusinessDays,
  beijingDateKey,
  beijingParts,
  isBeijingBusinessTimeInRange,
  parseBusinessTimeRange,
  timeTokenToMinutes,
};
