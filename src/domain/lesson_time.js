'use strict';
const text = value => String(value ?? '').trim();
function timeTokenToMinutes(value) {
  const raw = text(value).replace(/[：﹕]/g, ":");
  const match = raw.match(/^(\d{1,2})(?::?(\d{2}))?$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function formatTimeMinutes(minutes) {
  const value = Number(minutes);
  if (!Number.isInteger(value) || value < 0 || value >= 24 * 60) return "";
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

// Course time is persisted only in this format. Keep parsing and overlap checks
// on this same canonical representation so equivalent user input cannot diverge.
function normalizeTimeSlot(value) {
  const raw = text(value)
    .replace(/[：﹕]/g, ":")
    .replace(/[—–－~～至到]/g, "-")
    .replace(/\s+/g, "");
  if (!raw) return null;
  if (!/^[^-]+-[^-]+$/.test(raw)) return null;
  const parts = raw.split("-");
  const start = timeTokenToMinutes(parts[0]);
  const end = timeTokenToMinutes(parts[1]);
  if (start == null || end == null || end <= start) return null;
  return `${formatTimeMinutes(start)}-${formatTimeMinutes(end)}`;
}

function parseTimeRange(value) {
  const normalized = normalizeTimeSlot(value);
  if (!normalized) return null;
  const [startToken, endToken] = normalized.split("-");
  const start = timeTokenToMinutes(startToken);
  const end = timeTokenToMinutes(endToken);
  if (start == null || end == null || end <= start) return null;
  return { start, end };
}

module.exports = { timeTokenToMinutes, formatTimeMinutes, normalizeTimeSlot, parseTimeRange };
