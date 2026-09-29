(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BusinessTime = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const timeZone = 'Asia/Shanghai';
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  function instant(value) {
    if (value instanceof Date || typeof value === 'number') return new Date(value);
    const raw = String(value || '').trim();
    // SQLite CURRENT_TIMESTAMP and strftime timestamps are UTC, despite having
    // no suffix. Pure business dates and time ranges are never converted.
    const normalized = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(raw) && !/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(raw) ? raw.replace(' ', 'T') + 'Z' : raw;
    return new Date(normalized);
  }
  function parts(value = new Date()) {
    const date = instant(value);
    if (!Number.isFinite(date.getTime())) throw new TypeError('北京时间参数无效');
    return Object.fromEntries(formatter.formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  }
  function dateKey(value = new Date()) { const p = parts(value); return `${p.year}-${p.month}-${p.day}`; }
  function formatTimestamp(value) {
    if (value == null || value === '') return '';
    if (typeof value === 'string' && (/^\d{4}-\d{2}-\d{2}$/.test(value) || /^\d{2}:\d{2}(?:-\d{2}:\d{2})?$/.test(value))) return value;
    try { const p = parts(value); return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`; } catch { return String(value); }
  }
  return { timeZone, instant, parts, dateKey, formatTimestamp };
});
