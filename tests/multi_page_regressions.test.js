const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const {
  beijingParts,
  isBeijingBusinessTimeInRange,
  parseBusinessTimeRange,
} = require("../src/domain/beijing_time");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");
const server = fs.readFileSync(path.join(root, "src/server.js"), "utf8");

test("Beijing business time is start-inclusive, end-exclusive and supports midnight", () => {
  assert.deepEqual(parseBusinessTimeRange(" 23：30 至 00：30 "), { start: 1410, end: 30, crossesMidnight: true });
  assert.equal(isBeijingBusinessTimeInRange({ courseDate: "2026-12-31", timeSlot: "23:30-00:30", now: "2026-12-31T15:30:00Z" }), true);
  assert.equal(isBeijingBusinessTimeInRange({ courseDate: "2026-12-31", timeSlot: "23:30-00:30", now: "2026-12-31T16:29:59Z" }), true);
  assert.equal(isBeijingBusinessTimeInRange({ courseDate: "2026-12-31", timeSlot: "23:30-00:30", now: "2026-12-31T16:30:00Z" }), false);
});

test("Beijing results do not depend on UTC Shanghai or Tokyo host timezone", () => {
  const script = `const h=require(${JSON.stringify(path.join(root, "src/domain/beijing_time.js"))});const cases=['2026-01-31T16:00:00Z','2026-07-24T00:00:00Z','2026-07-24T04:00:00Z','2026-12-31T15:59:00Z'];process.stdout.write(JSON.stringify(cases.map(v=>h.beijingParts(v))))`;
  const outputs = ["UTC", "Asia/Shanghai", "Asia/Tokyo"].map((TZ) => {
    const result = spawnSync(process.execPath, ["-e", script], { env: { ...process.env, TZ }, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  });
  assert.equal(new Set(outputs).size, 1);
  assert.deepEqual(JSON.parse(outputs[0]).map((row) => [row.date, row.time.slice(0, 5)]), [["2026-02-01", "00:00"], ["2026-07-24", "08:00"], ["2026-07-24", "12:00"], ["2026-12-31", "23:59"]]);
  assert.equal(beijingParts("2026-07-23T23:59:00Z").time.slice(0, 5), "07:59");
});

test("dashboard cards allow natural population growth while current lessons scroll internally", () => {
  assert.match(css, /\.dashboard-main-grid[^}]*align-items:\s*stretch/s);
  assert.match(css, /\.dashboard-main-grid\s*>\s*:is\([^}]*height:\s*auto[^}]*overflow:\s*visible/s);
  assert.match(css, /\.dashboard-current-section[^}]*height:\s*360px[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.dashboard-current-list[^}]*overflow-y:\s*auto/s);
});

test("page-scoped visual regressions and overlay cleanup stay explicit", () => {
  assert.match(css, /\.student-query-detail-table[^}]*background:\s*var\(--panel\)/s);
  assert.match(css, /\.student-pricing-table\s+\.student-pricing-value-cell/);
  assert.match(css, /\.class-group-student-set[^}]*white-space:\s*nowrap/s);
  assert.match(css, /\.opening-balance-notes-input[^}]*resize:\s*none/s);
  assert.match(app, /function closeAllFloatingOverlays\(\)/);
  assert.match(app, /function setActiveView[\s\S]*closeAllFloatingOverlays\(\)/);
});

test("summary teacher and pricing scopes are based on raw data and selected month", () => {
  for (const field of ["total_fee", "prev_actual", "prev_gift", "cur_recharge", "cur_gift", "actual_consumption", "gift_consumption", "actual_balance", "gift_balance"]) assert.match(app, new RegExp(`"${field}"`));
  assert.match(server, /SELECT DISTINCT teacher_name FROM lessons WHERE month_key = \?/);
  assert.match(server, /function studentPricingRows[\s\S]*matchesByRule/);
  assert.match(app, /\/api\/student-pricing\/\$\{input\.dataset\.id\}[\s\S]*upsertById/);
  assert.match(server, /PATCH" && url\.pathname === "\/api\/student-pricing\/batch"/);
});

test("recharge modal uses structured accessible channels with legacy unknown display", () => {
  for (const value of ["wechat", "cash", "alipay", "other"]) assert.match(app, new RegExp(`\\["${value}"`));
  assert.match(app, /channel:\s*"wechat"/);
  assert.match(app, /type="radio" name="recharge-channel"/);
  assert.match(app, /channel === "other" && !channelOther/);
  assert.match(app, /return label;[\s\S]*未记录/);
  assert.match(server, /RECHARGE_CHANNELS = new Set\(\["wechat", "cash", "alipay", "other"\]\)/);
});
