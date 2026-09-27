(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SalaryFormula = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const cache = new Map();
  const fail = message => { throw new Error(message); };
  const gcd = (a, b) => { a = a < 0n ? -a : a; while (b) [a, b] = [b, a % b]; return a || 1n; };
  function fraction(a, b = 1n) {
    if (!b) fail('公式不能除以 0');
    if (b < 0n) { a = -a; b = -b; }
    const divisor = gcd(a, b);
    return [a / divisor, b / divisor];
  }
  const add = (a, b) => fraction(a[0] * b[1] + b[0] * a[1], a[1] * b[1]);
  const mul = (a, b) => fraction(a[0] * b[0], a[1] * b[1]);
  const neg = a => [-a[0], a[1]];
  const div = (a, b) => fraction(a[0] * b[1], a[1] * b[0]);
  function decimal(value) {
    const parts = String(value).split('.');
    return fraction(BigInt((parts[0] || '0') + (parts[1] || '')), 10n ** BigInt((parts[1] || '').length));
  }
  function compile(value, { allowN = true } = {}) {
    const source = String(value ?? '').trim();
    if (!source || source.length > 240) fail('薪资公式必填，且不得超过 240 字符');
    if (!/^[\d.nNkK+*/()\s-]+$/.test(source)) fail('公式只允许数字、n、K、加减乘除和括号');
    const raw = source.match(/(?:\d+(?:\.\d+)?|\.\d+)|[nNkK+*/()-]/g) || [];
    if (raw.join('') !== source.replace(/\s/g, '')) fail('公式中的数字或符号无效');
    const tokens = [];
    for (let token of raw) {
      if (/^[nNkK]$/.test(token)) token = token.toLowerCase() === 'n' ? 'n' : 'K';
      const previous = tokens[tokens.length - 1];
      if (previous && /^(?:[nK)]|[\d.]+)$/.test(previous) && /^(?:[nK(]|[\d.]+)$/.test(token)) {
        if (/^[\d.]+$/.test(previous) && /^[\d.]+$/.test(token)) fail('数字之间缺少运算符');
        tokens.push('*');
      }
      tokens.push(token);
    }
    if (tokens.length > 160) fail('公式过于复杂');
    const normalized = tokens.join('');
    if (!allowN && tokens.includes('n')) fail('1V1、1V2、1V3 的公式不能包含 n');
    if (cache.has(normalized)) return cache.get(normalized);
    let index = 0;
    function primary(depth) {
      if (depth > 24) fail('公式括号嵌套过深');
      const token = tokens[index++];
      if (token === '+' || token === '-') { const child = primary(depth + 1); return { op: token === '-' ? 'neg' : 'pos', child, hasK: child.hasK }; }
      if (token === '(') { const result = expression(depth + 1); if (tokens[index++] !== ')') fail('公式括号不匹配'); return result; }
      if (token === 'n' || token === 'K') return { op: token, hasK: token === 'K' };
      if (token && /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(token)) {
        if (token.length > 16 || (token.split('.')[1] || '').length > 6) fail('公式数值过大或小数位超过 6 位');
        return { op: 'number', value: decimal(token), hasK: false };
      }
      fail('公式缺少数字、变量或括号');
    }
    function binary(op, left, right) {
      if (op === '*' && left.hasK && right.hasK) fail('K 必须为一次项，不能相乘');
      if (op === '/' && right.hasK) fail('K 不能出现在分母');
      return { op, left, right, hasK: left.hasK || right.hasK };
    }
    function product(depth) {
      let node = primary(depth);
      while (tokens[index] === '*' || tokens[index] === '/') { const op = tokens[index++]; node = binary(op, node, primary(depth)); }
      return node;
    }
    function expression(depth) {
      let node = product(depth);
      while (tokens[index] === '+' || tokens[index] === '-') { const op = tokens[index++]; node = binary(op, node, product(depth)); }
      return node;
    }
    const ast = expression(0);
    if (index !== tokens.length) fail('公式括号或运算符不匹配');
    const result = { normalized, ast, usesN: tokens.includes('n'), usesK: tokens.includes('K') };
    if (cache.size >= 500) cache.delete(cache.keys().next().value);
    cache.set(normalized, result);
    return result;
  }
  function pair(node, n) {
    const zero = [0n, 1n], one = [1n, 1n];
    if (node.op === 'number') return [node.value, zero];
    if (node.op === 'n') return [[BigInt(n), 1n], zero];
    if (node.op === 'K') return [zero, one];
    if (node.child) { const result = pair(node.child, n); return node.op === 'neg' ? result.map(neg) : result; }
    const a = pair(node.left, n), b = pair(node.right, n);
    if (node.op === '+') return [add(a[0], b[0]), add(a[1], b[1])];
    if (node.op === '-') return [add(a[0], neg(b[0])), add(a[1], neg(b[1]))];
    if (node.op === '*') return [mul(a[0], b[0]), add(mul(a[0], b[1]), mul(a[1], b[0]))];
    return [div(a[0], b[0]), div(a[1], b[0])];
  }
  function rounded(value) {
    const sign = value[0] < 0n ? -1n : 1n, magnitude = value[0] * sign;
    const result = sign * ((magnitude * 2n + value[1]) / (2n * value[1]));
    const number = Number(result);
    if (!Number.isSafeInteger(number)) fail('薪资金额超出安全范围');
    return number;
  }
  function evaluate(value, n = 6, minutes = 120, options = {}) {
    if (!Number.isSafeInteger(n) || n < 1) fail('学生人数必须为正整数');
    if (!Number.isSafeInteger(minutes) || minutes <= 0 || minutes > 1440) fail('课程时长无效');
    const compiled = compile(value, options), result = pair(compiled.ast, n);
    if (result.some(item => item[0] < 0n)) fail('基础课薪和绩效基数不能为负数');
    const factor = fraction(BigInt(minutes) * 100n, 120n);
    const [base_cents, performance_cents] = result.map(item => rounded(mul(item, factor)));
    if (base_cents > 10000000 || performance_cents > 10000000) fail('单节基础课薪或绩效基数不得超过 100000 元');
    return { base_cents, performance_cents, normalized: compiled.normalized };
  }
  function validate(value, options = {}) {
    const compiled = compile(value, options);
    // Check common class sizes at save time; every actual lesson is checked again.
    for (let n = 1; n <= (compiled.usesN ? 200 : 1); n++) evaluate(value, n, 120, options);
    return compiled.normalized;
  }
  function cents(value) {
    const raw = String(value ?? '').trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) fail('金额必须为非负数，最多两位小数');
    return rounded(mul(decimal(raw), [100n, 1n]));
  }
  function total(baseCents, performanceCents, coefficient, travelCents = 0) {
    if (performanceCents && coefficient == null) return null;
    const k = coefficient == null ? 0 : cents(coefficient);
    if (k < 0 || k > 100) fail('绩效系数必须在 0.00～1.00 之间');
    return baseCents + rounded(fraction(BigInt(performanceCents) * BigInt(k), 100n)) + travelCents;
  }
  function format(result) {
    const amount = value => (value / 100).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
    return amount(result.base_cents) + (result.performance_cents ? `+${amount(result.performance_cents)}K` : '');
  }
  return { compile, evaluate, validate, cents, total, format };
});
