(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PerformanceScore = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function normalize(value) {
    if (value === null || value === '') return null;
    if ((typeof value !== 'number' && typeof value !== 'string') || !/^\d{1,3}$/.test(String(value)) || !Number.isInteger(Number(value)) || Number(value) > 100) throw new Error('绩效分数必须为 0—100 的整数');
    return Number(value);
  }
  function coefficient(value) {
    const score = normalize(value);
    return score === null ? null : score >= 80 ? score / 100 : score >= 60 ? 0.5 : 0;
  }
  return { normalize, coefficient };
});
