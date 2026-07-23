const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { after, before, test } = require("node:test");
const { findStudentGradeStageConflicts, runDataPreflight } = require("../src/backup/data_preflight");

const root = path.resolve(__dirname, "..");
let tempRoot; let databasePath; let port; let server; let ownerCookie; let readonlyCookie; let deniedCookie;

async function freePort() { return await new Promise((resolve) => { const socket = net.createServer(); socket.listen(0, "127.0.0.1", () => { const value = socket.address().port; socket.close(() => resolve(value)); }); }); }
async function waitForServer() { for (let index = 0; index < 100; index += 1) { try { if ((await fetch(`http://127.0.0.1:${port}/api/version`)).ok) return; } catch {} await new Promise((resolve) => setTimeout(resolve, 50)); } throw new Error("server did not start"); }
async function login(username) { const response = await fetch(`http://127.0.0.1:${port}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password: "123456" }) }); assert.equal(response.status, 200); return response.headers.get("set-cookie").split(";")[0]; }
function api(pathname, { cookie = ownerCookie, method = "GET", body } = {}) { return fetch(`http://127.0.0.1:${port}${pathname}`, { method, headers: { cookie, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }

before(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "liming-stage-conflicts-"));
  databasePath = path.join(tempRoot, "data.sqlite"); port = await freePort();
  const environment = { ...process.env, DATA_DIR: tempRoot, DB_PATH: databasePath, PORT: String(port), SESSION_COOKIE_SECURE: "false" };
  const initialized = spawnSync(process.execPath, [path.join(root, "src/server.js"), "--init-db"], { cwd: root, env: environment, encoding: "utf8" });
  assert.equal(initialized.status, 0, initialized.stderr);
  const db = new DatabaseSync(databasePath);
  const hash = db.prepare("SELECT password_hash FROM users WHERE username='boss'").get().password_hash;
  const insertUser = db.prepare("INSERT INTO users(username,display_name,role,password_hash,status,permission_override_enabled,readonly_override) VALUES (?,?, 'teacher',?,'active',1,?)");
  const readonly = insertUser.run("stage-readonly", "阶段只读", hash, 1); const denied = insertUser.run("stage-denied", "阶段无权限", hash, 0);
  db.prepare("INSERT INTO user_page_permissions(user_id,permission_key,enabled) VALUES (?,'studentProfiles',1)").run(readonly.lastInsertRowid);
  db.exec(`
    INSERT INTO students(id,name,grade,status) VALUES
      (8101,'阶段接口学生','初三','在读'),(8102,'另一学生','初一','在读'),(8103,'待新增冲突学生','初二','在读');
    INSERT INTO student_grade_stages(student_name,stage,start_date,end_date) VALUES
      ('阶段接口学生','初三','2025-09-01','2026-08-31'),
      ('阶段接口学生','高一','2026-08-01','2027-08-31'),
      ('另一学生','初一','2024-09-01','2025-08-31'),
      ('另一学生','初二','2025-09-01','2026-08-31'),
      ('待新增冲突学生','初一','2024-09-01','2025-08-31'),
      ('待新增冲突学生','初二','2025-09-01','2026-08-31');
  `);
  db.close();
  server = spawn(process.execPath, [path.join(root, "src/server.js")], { cwd: root, env: environment, stdio: "ignore", windowsHide: true });
  await waitForServer(); ownerCookie = await login("boss"); readonlyCookie = await login("stage-readonly"); deniedCookie = await login("stage-denied");
});

after(async () => { if (server?.exitCode == null) { const exited = new Promise((resolve) => server.once("exit", resolve)); server.kill("SIGTERM"); await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]); } fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); });

test("shared detector handles empty, partial, contained, inclusive endpoint, graduation and separate students", () => {
  const rows = [
    { id: 1, student_id: 1, student_name: "甲", stage: "初一", start_date: "2024-01-01", end_date: "2024-12-31" },
    { id: 2, student_id: 1, student_name: "甲", stage: "初二", start_date: "2024-06-01", end_date: "2024-06-30" },
    { id: 3, student_id: 1, student_name: "甲", stage: "初三", start_date: "2024-12-31", end_date: "2025-03-01" },
    { id: 4, student_id: 1, student_name: "甲", stage: "已毕业", start_date: "2025-03-01", end_date: "" },
    { id: 5, student_id: 1, student_name: "甲", stage: "高一", start_date: "", end_date: "" },
    { id: 6, student_id: 2, student_name: "乙", stage: "初一", start_date: "2024-01-01", end_date: "2024-12-31" },
  ];
  const conflicts = findStudentGradeStageConflicts(null, { rows });
  assert.equal(conflicts.length, 3);
  assert.deepEqual(conflicts.map((item) => [item.stage_a, item.stage_b, item.overlap_start, item.overlap_end]), [
    ["初一", "初二", "2024-06-01", "2024-06-30"], ["初一", "初三", "2024-12-31", "2024-12-31"], ["初三", "已毕业", "2025-03-01", "2025-03-01"],
  ]);
  assert.equal(conflicts.every((item) => item.student_name === "甲"), true);
});

test("shared detector returns empty for non-overlapping and empty dates", () => {
  assert.deepEqual(findStudentGradeStageConflicts(null, { rows: [
    { student_name: "甲", stage: "初一", start_date: "", end_date: "" },
    { student_name: "甲", stage: "初二", start_date: "2025-01-01", end_date: "2025-06-01" },
    { student_name: "甲", stage: "初三", start_date: "2025-06-02", end_date: "2025-12-31" },
  ] }), []);
});

test("preflight and conflict query expose the same conflict", async () => {
  const db = new DatabaseSync(databasePath, { readOnly: true }); const preflight = runDataPreflight(db, { sampleLimit: 1000 }); db.close();
  const apiResult = await (await api("/api/student-grade-stages/conflicts")).json();
  const issue = preflight.issues.find((item) => item.code === "STUDENT_GRADE_STAGE_OVERLAP");
  assert.equal(issue.count, 1); assert.deepEqual(apiResult.conflicts, issue.records); assert.equal(apiResult.student_count, 1);
});

test("saving a newly conflicting stage returns structured 409 and leaves the database unchanged", async () => {
  const response = await api("/api/student-grade-stages", { method: "PUT", body: { student_name: "待新增冲突学生", stages: [{ stage: "初二", start_date: "2025-08-01", end_date: "2026-08-31" }] } });
  const result = await response.json(); assert.equal(response.status, 409); assert.equal(result.code, "STUDENT_GRADE_STAGE_OVERLAP"); assert.equal(result.conflicts[0].overlap_start, "2025-08-01");
  const db = new DatabaseSync(databasePath, { readOnly: true }); assert.equal(db.prepare("SELECT start_date FROM student_grade_stages WHERE student_name='待新增冲突学生' AND stage='初二'").get().start_date, "2025-09-01"); db.close();
  assert.doesNotMatch(JSON.stringify(result), /password_hash|token|cookie|session|SELECT |sqlite/i);
});

test("repairing the legacy conflict succeeds and removes it from the query", async () => {
  const response = await api("/api/student-grade-stages", { method: "PUT", body: { student_name: "阶段接口学生", stages: [{ stage: "高一", start_date: "2026-09-01", end_date: "2027-08-31" }] } });
  assert.equal(response.status, 200, await response.text());
  const conflicts = await (await api("/api/student-grade-stages/conflicts")).json();
  assert.equal(conflicts.conflicts.some((item) => item.student_name === "阶段接口学生"), false);
});

test("owner counts every student status while a teacher only counts bound lesson students", async () => {
  const db = new DatabaseSync(databasePath);
  const teacherUserId = db.prepare("SELECT id FROM users WHERE username='stage-readonly'").get().id;
  db.prepare("INSERT OR IGNORE INTO user_teacher_bindings(user_id,teacher_name) VALUES (?,'阶段只读老师')").run(teacherUserId);
  db.exec(`
    INSERT INTO students(id,name,grade,status,left_at) VALUES
      (8111,'教师范围历史冲突学生','初三','已毕业','2025-08-31'),
      (8112,'老板范围暂停冲突学生','高二','暂停',NULL);
    INSERT INTO lessons(teacher_name,date,student_names,month_key) VALUES
      ('阶段只读老师','2024-01-10','教师范围历史冲突学生','2024-01');
    INSERT INTO student_grade_stages(student_name,stage,start_date,end_date) VALUES
      ('教师范围历史冲突学生','初三','2024-01-01','2025-08-31'),
      ('教师范围历史冲突学生','高一','2025-08-01','2026-08-31'),
      ('老板范围暂停冲突学生','高二','2024-01-01','2025-08-31'),
      ('老板范围暂停冲突学生','高三','2025-08-31','2026-08-31');
  `);
  db.close();
  const ownerResult = await (await api("/api/student-grade-stages/conflicts")).json();
  const teacherResult = await (await api("/api/student-grade-stages/conflicts", { cookie: readonlyCookie })).json();
  assert.deepEqual(new Set(ownerResult.conflicts.map((item) => item.student_name)), new Set(["教师范围历史冲突学生", "老板范围暂停冲突学生"]));
  assert.deepEqual(new Set(teacherResult.conflicts.map((item) => item.student_name)), new Set(["教师范围历史冲突学生"]));
  assert.equal(ownerResult.student_count, 2);
  assert.equal(teacherResult.student_count, 1);
});

test("student-profile permission can read, missing permission is 403, and readonly cannot save", async () => {
  const readable = await api("/api/student-grade-stages/conflicts", { cookie: readonlyCookie }); assert.equal(readable.status, 200);
  const denied = await api("/api/student-grade-stages/conflicts", { cookie: deniedCookie }); assert.equal(denied.status, 403);
  const write = await api("/api/student-grade-stages", { cookie: readonlyCookie, method: "PUT", body: { student_name: "另一学生", stages: [{ stage: "初二", start_date: "2025-09-02", end_date: "2026-08-31" }] } });
  assert.equal(write.status, 403);
});
