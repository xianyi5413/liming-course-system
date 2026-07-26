const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { test } = require("node:test");
const { createWorkbook, parseWorkbook } = require("../src/excel/xlsx_codec");
const { createTemplateBuffer, templateToFullBuffer } = require("../src/excel/import_service");
const { verifyFullData } = require("../src/excel/full_backup");
const { freePort, launchChrome } = require("./helpers/chrome_cdp");

const root = path.resolve(__dirname, "..");
const serverScript = path.join(root, "src", "server.js");

function initialize(tempRoot, database) {
  const environment = { ...process.env, DATA_DIR: tempRoot, DB_PATH: database, SESSION_COOKIE_SECURE: "false" };
  const result = spawnSync(process.execPath, [serverScript, "--init-db"], { cwd: root, env: environment, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return { environment, result };
}

test("legacy student status migration is idempotent and changes no other student domain data", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "liming-student-migration-"));
  const database = path.join(tempRoot, "data.sqlite");
  try {
    const { environment } = initialize(tempRoot, database);
    const db = new DatabaseSync(database);
    db.exec(`
      INSERT INTO students(id,name,grade,status,guardian,phone,joined_at,left_at,notes)
      VALUES (98101,'迁移学生','高二','离校','迁移家长','13800000000','2024-09-01','2026-06-30','迁移备注');
      INSERT INTO student_grade_stages(student_name,stage,start_date,end_date)
      VALUES ('迁移学生','高二','2025-09-01','2026-08-31');
      INSERT INTO student_opening_balances(student_name,grade,opening_actual_balance,opening_gift_balance,notes)
      VALUES ('迁移学生','高二',1000,100,'余额不变');
      INSERT INTO recharge_records(student_name,grade,cur_recharge,cur_gift,recharge_date,notes,month_key)
      VALUES ('迁移学生','高二',500,50,'2026-07-01','充值不变','2026-07-01');
      INSERT INTO lessons(teacher_name,date,grade,subject,student_names,notes,month_key)
      VALUES ('迁移老师','2026-07-02','高二','数学','迁移学生','课程不变','2026-07-01');
    `);
    const before = {
      student: db.prepare("SELECT id,name,grade,guardian,phone,joined_at,left_at,notes FROM students WHERE id=98101").get(),
      stage: db.prepare("SELECT * FROM student_grade_stages WHERE student_name='迁移学生'").get(),
      balance: db.prepare("SELECT * FROM student_opening_balances WHERE student_name='迁移学生'").get(),
      recharge: db.prepare("SELECT * FROM recharge_records WHERE student_name='迁移学生'").get(),
      lesson: db.prepare("SELECT teacher_name,date,grade,subject,student_names,notes,status,course_status FROM lessons WHERE student_names='迁移学生'").get(),
    };
    db.close();
    const first = spawnSync(process.execPath, [serverScript, "--init-db"], { cwd: root, env: environment, encoding: "utf8" });
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /\[student status migration\] \{"updated":1\}/);
    const checked = new DatabaseSync(database, { readOnly: true });
    assert.equal(checked.prepare("SELECT status FROM students WHERE id=98101").get().status, "已流出");
    assert.deepEqual(checked.prepare("SELECT id,name,grade,guardian,phone,joined_at,left_at,notes FROM students WHERE id=98101").get(), before.student);
    assert.deepEqual(checked.prepare("SELECT * FROM student_grade_stages WHERE student_name='迁移学生'").get(), before.stage);
    assert.deepEqual(checked.prepare("SELECT * FROM student_opening_balances WHERE student_name='迁移学生'").get(), before.balance);
    assert.deepEqual(checked.prepare("SELECT * FROM recharge_records WHERE student_name='迁移学生'").get(), before.recharge);
    assert.deepEqual(checked.prepare("SELECT teacher_name,date,grade,subject,student_names,notes,status,course_status FROM lessons WHERE student_names='迁移学生'").get(), before.lesson);
    checked.close();
    const second = spawnSync(process.execPath, [serverScript, "--init-db"], { cwd: root, env: environment, encoding: "utf8" });
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /\[student status migration\] \{"updated":0\}/);
  } finally {
    try { fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch {}
  }
});

test("legacy Excel input normalizes 离校 and new full data exports only 已流出", () => {
  const parsed = parseWorkbook(createTemplateBuffer());
  const sheets = parsed.sheets.map((sheet) => ({ name: sheet.name, state: sheet.state, rows: sheet.rows.map((row) => [...row]) }));
  const students = sheets.find((sheet) => sheet.name === "学生档案");
  const row = Array(students.rows[0].length).fill("");
  const headers = students.rows[0];
  row[headers.indexOf("姓名")] = "旧表学生";
  row[headers.indexOf("当前年级")] = "初三";
  row[headers.indexOf("状态")] = "离校";
  row[headers.indexOf("离校日期")] = "2026-06-30";
  students.rows.push(row);
  const full = verifyFullData(templateToFullBuffer(createWorkbook(sheets)).buffer);
  assert.equal(full.data.students[0].status, "已流出");
  assert.equal(full.data.students[0].left_at, "2026-06-30");
  assert.doesNotMatch(JSON.stringify(full.data.students), /"status":"离校"/);
});

async function waitForServer(server, port, stderr) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (server.exitCode != null) throw new Error(`server exited: ${stderr()}`);
    try { if ((await fetch(`http://127.0.0.1:${port}/api/version`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`server did not start: ${stderr()}`);
}

test("API and student page enforce the four statuses, shared ordering and immediate reorder", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "liming-student-order-"));
  const database = path.join(tempRoot, "data.sqlite");
  const { environment } = initialize(tempRoot, database);
  const db = new DatabaseSync(database);
  const hash = db.prepare("SELECT password_hash FROM users WHERE username='boss'").get().password_hash;
  const readonly = db.prepare("INSERT INTO users(username,display_name,role,password_hash,status,permission_override_enabled,readonly_override) VALUES ('status-readonly','状态只读','teacher',?,'active',1,1)").run(hash);
  db.prepare("INSERT INTO user_page_permissions(user_id,permission_key,enabled) VALUES (?,'studentProfiles',1)").run(readonly.lastInsertRowid);
  db.exec(`
    INSERT INTO students(id,name,grade,status,left_at) VALUES
      (98201,'赵六','初二','在读',''),
      (98202,'安安','初一','在读',''),
      (98203,'张三','初一','在读',''),
      (98204,'暂停甲','高一','暂停',''),
      (98205,'毕业甲','高三','已毕业','2026-06-30'),
      (98206,'流出甲','初三','已流出','2026-06-30'),
      (98207,'空级甲','','在读',''),
      (98208,'未知甲','大学','在读','');
  `);
  db.close();
  const port = await freePort();
  let stderr = "";
  const server = spawn(process.execPath, [serverScript], { cwd: root, env: { ...environment, PORT: String(port) }, stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
  server.stderr.on("data", (chunk) => { stderr += String(chunk); });
  let chrome;
  try {
    await waitForServer(server, port, () => stderr);
    const login = async (username) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password: "123456" }) });
      assert.equal(response.status, 200);
      return response.headers.get("set-cookie").split(";")[0];
    };
    const ownerCookie = await login("boss");
    const readonlyCookie = await login("status-readonly");
    const api = (pathname, { cookie = ownerCookie, method = "GET", body } = {}) => fetch(`http://127.0.0.1:${port}${pathname}`, { method, headers: { cookie, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const rows = (await (await api("/api/students")).json()).students;
    assert.deepEqual(rows.map((row) => row.name), ["安安", "张三", "赵六", "未知甲", "空级甲", "暂停甲", "毕业甲", "流出甲"]);
    const compatible = await api("/api/students/98201", { method: "PATCH", body: { status: "离校" } });
    assert.equal(compatible.status, 200);
    assert.equal((await compatible.json()).status, "已流出");
    const invalid = await api("/api/students/98202", { method: "PATCH", body: { status: "其他" } });
    assert.equal(invalid.status, 400);
    const forbidden = await api("/api/students/98202", { cookie: readonlyCookie, method: "PATCH", body: { status: "暂停" } });
    assert.equal(forbidden.status, 403);

    chrome = await launchChrome(path.join(tempRoot, "chrome-profile"));
    await chrome.session.send("Page.navigate", { url: `http://127.0.0.1:${port}/` });
    await chrome.session.login("boss", "123456");
    await chrome.session.evaluate(`localStorage.setItem("liming:include-inactive","1"); localStorage.setItem("liming:profile-status-filter",JSON.stringify({students:"离校",teachers:""})); location.reload()`);
    await chrome.session.waitFor("Boolean(document.querySelector('.nav-btn[data-nav-group=\"students\"]'))");
    if (!await chrome.session.evaluate("Boolean(document.querySelector('.nav-sub-btn[data-view=\"studentProfiles\"]'))")) await chrome.session.click('.nav-btn[data-nav-group="students"]');
    await chrome.session.waitFor("Boolean(document.querySelector('.nav-sub-btn[data-view=\"studentProfiles\"]'))");
    await chrome.session.click('.nav-sub-btn[data-view="studentProfiles"]');
    await chrome.session.waitFor("document.querySelectorAll('.student-profile-main-row').length > 0");
    assert.equal(await chrome.session.evaluate("profileStatusFilter.students"), "已流出");
    await chrome.session.evaluate(`profileStatusFilter={...profileStatusFilter,students:""}; localStorage.setItem("liming:profile-status-filter",JSON.stringify(profileStatusFilter)); render()`);
    const optionValues = await chrome.session.evaluate("[...document.querySelector('.student-profile-main-row .profile-inline-status').options].map((option)=>option.value)");
    assert.deepEqual(optionValues, ["在读", "暂停", "已毕业", "已流出"]);
    assert.equal(await chrome.session.evaluate("document.body.textContent.includes('显示历史（含已流出）')"), true);
    assert.equal(await chrome.session.evaluate("document.querySelector('.profile-status-filter')?.getAttribute('data-options')?.includes('离校') || [...document.querySelectorAll('.profile-status-filter option')].some((option)=>option.value==='离校')"), false);
    assert.deepEqual(await chrome.session.evaluate("[...document.querySelectorAll('.student-profile-main-row')].map((row)=>row.querySelector('.student-name-cell').textContent.trim())"), ["安安", "张三", "空级甲", "未知甲", "暂停甲", "毕业甲", "赵六", "流出甲"]);

    await chrome.session.evaluate(`(() => { const box=document.querySelector('.student-profile-main-row[data-id="98202"] .student-profile-select-row'); box.click(); const select=document.querySelector('.student-profile-main-row[data-id="98202"] .profile-inline-status'); select.value='已流出'; select.dispatchEvent(new Event('change',{bubbles:true})); })()`);
    await chrome.session.waitFor(`(() => {
      const rows=[...document.querySelectorAll('.student-profile-main-row')];
      const moved=rows.findIndex((row)=>row.dataset.id==='98202');
      const graduated=rows.findIndex((row)=>row.querySelector('.student-name-cell')?.textContent.includes('毕业甲'));
      return state.profile_students.find((row)=>Number(row.id)===98202)?.status==='已流出' && moved>graduated;
    })()`);
    const after = await chrome.session.evaluate(`({names:[...document.querySelectorAll('.student-profile-main-row')].map((row)=>row.querySelector('.student-name-cell').textContent.trim()), selected:[...document.querySelectorAll('.student-profile-select-row:checked')].map((box)=>box.dataset.id), conflicts:Boolean(document.querySelector('.student-stage-conflict-banner'))})`);
    assert.equal(after.names.indexOf("安安") > after.names.indexOf("毕业甲"), true);
    assert.deepEqual(after.selected, ["98202"]);
    assert.equal(after.conflicts, true);

    await chrome.session.evaluate(`profileStatusFilter={...profileStatusFilter,students:"在读"}; render()`);
    const targetId = await chrome.session.evaluate("document.querySelector('.student-profile-main-row')?.dataset.id");
    await chrome.session.evaluate(`(() => { const select=document.querySelector('.student-profile-main-row[data-id="${targetId}"] .profile-inline-status'); select.value='已流出'; select.dispatchEvent(new Event('change',{bubbles:true})); })()`);
    await chrome.session.waitFor(`!document.querySelector('.student-profile-main-row[data-id="${targetId}"]')`);
    assert.deepEqual(chrome.session.exceptions, []);
    assert.deepEqual(chrome.session.consoleErrors, []);
  } finally {
    if (chrome) { await chrome.session.close(); if (chrome.child.exitCode == null) chrome.child.kill("SIGTERM"); }
    if (server.exitCode == null) server.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 200));
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});
