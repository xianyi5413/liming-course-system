const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { after, before, test } = require("node:test");
const {
  backfillBlankExitDates,
  resolveStudentExitDate,
  resolveTeacherExitDate,
  validLessonDate,
} = require("../src/domain/exit_dates");

const root = path.resolve(__dirname, "..");
let tempRoot;
let dbPath;
let port;
let server;
let cookie;

async function freePort() {
  return new Promise((resolve) => {
    const socket = net.createServer();
    socket.listen(0, "127.0.0.1", () => {
      const selected = socket.address().port;
      socket.close(() => resolve(selected));
    });
  });
}

async function waitForServer() {
  for (let index = 0; index < 100; index += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/version`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("server did not start");
}

async function patch(route, body) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data));
  return data;
}

before(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "liming-auto-exit-"));
  dbPath = path.join(tempRoot, "auto-exit.sqlite");
  port = await freePort();
  const environment = {
    ...process.env,
    DATA_DIR: tempRoot,
    DB_PATH: dbPath,
    PORT: String(port),
    SESSION_COOKIE_SECURE: "false",
    BAIDU_APP_KEY: "",
    BAIDU_APP_SECRET: "",
    BAIDU_REDIRECT_URI: "",
  };
  const initialized = spawnSync(process.execPath, [path.join(root, "src/server.js"), "--init-db"], {
    cwd: root,
    env: environment,
    encoding: "utf8",
  });
  assert.equal(initialized.status, 0, initialized.stderr);
  const db = new DatabaseSync(dbPath);
  db.exec(`
    INSERT INTO teachers(id,name,phone,notes,status,left_at) VALUES
      (98101,'严格老师','13000000000','教师备注','在职',''),
      (98102,'无课老师','','','在职','');
    INSERT INTO students(id,name,grade,guardian,phone,notes,status,left_at) VALUES
      (98201,'严格学生','初一','监护人','13100000000','学生备注','在读',''),
      (98202,'无课学生','初二','','','','在读','');
    INSERT INTO lessons(id,teacher_name,date,student_names,grade,subject) VALUES
      (98301,'严格老师','2026-07-01','严格学生、另一学生','初一','数学'),
      (98302,' 严格老师 ','2026-07-18','["另一学生","严格学生"]','初一','数学'),
      (98303,'严格老师附加','2026-12-31','严格学生甲','初一','数学'),
      (98304,'严格老师','2026-02-30','严格学生','初一','数学'),
      (98305,'严格老师','not-a-date','严格学生','初一','数学');
  `);
  db.close();
  server = spawn(process.execPath, [path.join(root, "src/server.js")], {
    cwd: root,
    env: environment,
    stdio: "ignore",
    windowsHide: true,
  });
  await waitForServer();
  const login = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "boss", password: "123456" }),
  });
  assert.equal(login.status, 200);
  cookie = login.headers.get("set-cookie").split(";")[0];
});

after(async () => {
  if (server?.exitCode == null) {
    const exited = new Promise((resolve) => server.once("exit", resolve));
    server.kill("SIGTERM");
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
  }
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test("domain resolvers use strict normalized identities, splitStoredStudents and calendar-valid lexical dates", () => {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const originalTimezone = process.env.TZ;
  try {
    assert.deepEqual(resolveTeacherExitDate(db, " 严格老师 "), {
      found: true,
      date: "2026-07-18",
      lesson_id: 98302,
      reason: "latest_valid_lesson",
    });
    assert.deepEqual(resolveStudentExitDate(db, "严格学生"), {
      found: true,
      date: "2026-07-18",
      lesson_id: 98302,
      reason: "latest_valid_lesson",
    });
    assert.equal(resolveStudentExitDate(db, "严格学生甲甲").found, false);
    assert.equal(validLessonDate("2026-02-30"), "");
    const dates = ["UTC", "Asia/Shanghai", "Asia/Tokyo"].map((timezone) => {
      process.env.TZ = timezone;
      return resolveStudentExitDate(db, "严格学生").date;
    });
    assert.deepEqual(dates, ["2026-07-18", "2026-07-18", "2026-07-18"]);
  } finally {
    process.env.TZ = originalTimezone;
    db.close();
  }
});

test("teacher transition ignores a forged date, preserves unrelated fields and returns a safe resolution", async () => {
  const result = await patch("/api/teachers/98101", { status: "离职", left_at: "2099-01-01" });
  assert.equal(result.status, "离职");
  assert.equal(result.left_at, "2026-07-18");
  assert.equal(result.phone, "13000000000");
  assert.equal(result.notes, "教师备注");
  assert.deepEqual(result.exit_date_resolution, {
    found: true,
    date: "2026-07-18",
    lesson_id: 98302,
    reason: "latest_valid_lesson",
  });
});

test("read-only teacher account cannot trigger automatic exit-date writes", async () => {
  const login = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "teacher", password: "123456" }),
  });
  assert.equal(login.status, 200);
  const teacherCookie = login.headers.get("set-cookie").split(";")[0];
  const response = await fetch(`http://127.0.0.1:${port}/api/teachers/98102`, {
    method: "PATCH",
    headers: { cookie: teacherCookie, "content-type": "application/json" },
    body: JSON.stringify({ status: "离职", left_at: "2099-01-01" }),
  });
  assert.equal(response.status, 403);
});

test("student exit transitions recompute, while a person without lessons stays blank with an explicit reason", async () => {
  const first = await patch("/api/students/98201", { status: "已流出", left_at: "2099-01-01" });
  assert.equal(first.left_at, "2026-07-18");
  assert.equal(first.guardian, "监护人");
  const db = new DatabaseSync(dbPath);
  db.prepare("INSERT INTO lessons(id,teacher_name,date,student_names,grade,subject) VALUES (98306,'其他老师','2026-07-26','另一学生；严格学生','初一','物理')").run();
  db.close();
  const recomputed = await patch("/api/students/98201", { status: "已毕业", left_at: "2099-02-02" });
  assert.equal(recomputed.left_at, "2026-07-26");
  assert.equal(recomputed.exit_date_resolution.lesson_id, 98306);

  const teacherWithoutLessons = await patch("/api/teachers/98102", { status: "离职", left_at: "2099-03-03" });
  assert.equal(teacherWithoutLessons.left_at, "");
  assert.deepEqual(teacherWithoutLessons.exit_date_resolution, {
    found: false,
    date: "",
    lesson_id: null,
    reason: "no_matching_lesson",
  });
  const studentWithoutLessons = await patch("/api/students/98202", { status: "已流出" });
  assert.equal(studentWithoutLessons.left_at, "");
  assert.equal(studentWithoutLessons.exit_date_resolution.found, false);
});

test("startup backfill semantics are blank-only and idempotent without timezone conversion", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE teachers(id INTEGER PRIMARY KEY,name TEXT,status TEXT,left_at TEXT);
    CREATE TABLE students(id INTEGER PRIMARY KEY,name TEXT,status TEXT,left_at TEXT);
    CREATE TABLE lessons(id INTEGER PRIMARY KEY,teacher_name TEXT,date TEXT,student_names TEXT);
    INSERT INTO teachers VALUES (1,'历史老师','离职',''),(2,'保留老师','离职','2020-01-01');
    INSERT INTO students VALUES (1,'历史学生','已毕业',''),(2,'保留学生','已流出','2020-02-02');
    INSERT INTO lessons VALUES (1,'历史老师','2026-07-28','历史学生');
  `);
  const originalTimezone = process.env.TZ;
  try {
    process.env.TZ = "UTC";
    assert.deepEqual(backfillBlankExitDates(database), {
      teachers_updated: 1,
      students_updated: 1,
      teachers_without_lesson: 0,
      students_without_lesson: 0,
    });
    process.env.TZ = "America/Los_Angeles";
    assert.deepEqual(backfillBlankExitDates(database), {
      teachers_updated: 0,
      students_updated: 0,
      teachers_without_lesson: 0,
      students_without_lesson: 0,
    });
    assert.deepEqual(database.prepare("SELECT id,left_at FROM teachers ORDER BY id").all().map((row) => ({ ...row })), [
      { id: 1, left_at: "2026-07-28" },
      { id: 2, left_at: "2020-01-01" },
    ]);
  } finally {
    process.env.TZ = originalTimezone;
    database.close();
  }
});

test("status changes write operation logs containing the structured resolution", () => {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const logs = db.prepare("SELECT extra_json FROM operation_logs WHERE target_type IN ('teachers','students') ORDER BY id DESC LIMIT 10").all();
    assert.equal(logs.some((row) => String(row.extra_json).includes("exit_date_resolution")), true);
    assert.doesNotMatch(JSON.stringify(logs), /password_hash|access_token|app_secret/i);
  } finally {
    db.close();
  }
});
