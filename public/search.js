(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("pinyin-pro").pinyin);
  else root.SearchTools = factory(root.pinyinPro.pinyin);
})(typeof globalThis === "object" ? globalThis : this, function (pinyin) {
  const cache = new Map();
  let conversions = 0;
  function normalizeSearchText(value) {
    return String(value ?? "").normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
  }
  function buildSearchTokens(value) {
    const text = normalizeSearchText(value);
    if (cache.has(text)) return cache.get(text);
    const tokens = [text, text.replace(/\s/g, "")];
    if (/\p{Script=Han}/u.test(text)) {
      const syllables = pinyin(text, { toneType: "none", type: "array", nonZh: "consecutive" });
      conversions++;
      tokens.push(syllables.join("").replace(/\s/g, ""), syllables.map(part => part[0] || "").join(""));
    }
    if (cache.size >= 30000) cache.delete(cache.keys().next().value);
    cache.set(text, tokens);
    return tokens;
  }
  function matchesSearchQuery(value, query) {
    const normalized = normalizeSearchText(query);
    if (!normalized) return true;
    const text = normalizeSearchText(value);
    if (text.includes(normalized)) return true;
    const compact = normalized.replace(/\s/g, "");
    return buildSearchTokens(text).some(token => token.includes(compact));
  }
  function prime(values) { for (const value of values) buildSearchTokens(value); }
  function clear() { cache.clear(); }
  function stats() { return { size: cache.size, conversions }; }
  return { normalizeSearchText, buildSearchTokens, matchesSearchQuery, prime, clear, stats };
});
