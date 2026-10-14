(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StudentDisplay = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'variant' });
  function parse(value) {
    if (Array.isArray(value)) return value.flatMap(parse);
    const raw = String(value ?? '').trim();
    if (raw.startsWith('[')) {
      try { const parsed = JSON.parse(raw); if (Array.isArray(parsed)) return parse(parsed); } catch {}
    }
    return raw.split(/[、,，;；\n\r]/).map(name => name.replace(/\s+/g, '')).filter(Boolean);
  }
  function names(value) {
    return [...new Set(parse(value))].sort((a, b) => collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0));
  }
  return { names, text: value => names(value).join('、') };
});
