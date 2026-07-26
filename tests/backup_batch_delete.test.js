const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { test } = require("node:test");
const { BackupService } = require("../src/backup/backup_service");
const { freePort, launchChrome } = require("./helpers/chrome_cdp");

const root = path.resolve(__dirname, "..");
const serverScript = path.join(root, "src", "server.js");

function initScenario(prefix) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const database = path.join(tempRoot, "data.sqlite");
  const environment = { ...process.env, DATA_DIR: tempRoot, DB_PATH: database, SESSION_COOKIE_SECURE: "false", BAIDU_APP_KEY: "", BAIDU_APP_SECRET: "", BAIDU_REDIRECT_URI: "" };
  const initialized = spawnSync(process.execPath, [serverScript, "--init-db"], { cwd: root, env: environment, encoding: "utf8" });
  assert.equal(initialized.status, 0, initialized.stderr);
  return { tempRoot, database, environment };
}

function insertBackup(db, { filename, status = "failed", pinned = 0, jobStatus = "", remote = false, creator = null }) {
  const relative = `backups/full-excel/${filename}`;
  const result = db.prepare(`
    INSERT INTO backup_records(
      backup_type,filename,status,message,backup_format,format_version,trigger,retention_class,
      managed_relative_path,remote_status,remote_path,remote_checksum_path,pinned,job_status,created_by_user_id
    ) VALUES ('manual',?,'${status}','','full_data_excel',4,'manual','manual',?,
      ?,?,?,?, ?,?)
  `).run(
    filename,
    relative,
    remote ? "success" : "not_configured",
    remote ? `/apps/liming-course-system/${filename}` : "",
    remote ? `/apps/liming-course-system/${filename}.sha256` : "",
    pinned,
    jobStatus,
    creator,
  );
  return { id: Number(result.lastInsertRowid), relative, filename };
}

function createManaged(tempRoot, record, { directory = false, checksum = true } = {}) {
  const target = path.join(tempRoot, ...record.relative.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (directory) {
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, "keep.txt"), "force non-empty directory deletion failure");
  }
  else fs.writeFileSync(target, "synthetic backup");
  if (checksum) fs.writeFileSync(`${target}.sha256`, "synthetic checksum");
  return target;
}

test("single deletion service handles mixed local/remote cleanup and serializes concurrent deletions", async () => {
  const scenario = initScenario("liming-backup-service-batch-");
  try {
    const db = new DatabaseSync(scenario.database);
    const mixed = insertBackup(db, { filename: "mixed.xlsx", remote: true });
    const first = insertBackup(db, { filename: "success-a.xlsx", status: "success" });
    const second = insertBackup(db, { filename: "success-b.xlsx", status: "success" });
    db.close();
    createManaged(scenario.tempRoot, mixed);
    createManaged(scenario.tempRoot, first);
    createManaged(scenario.tempRoot, second);
    const service = new BackupService({ dbPath: scenario.database, dataDir: scenario.tempRoot });
    const removed = await service.deleteBackup(mixed.id, { remoteDeleter: async () => ({ excel: "deleted", checksum: "deleted" }) });
    assert.equal(removed.deleted, true);
    assert.deepEqual(removed.cleanup, { local_excel: "deleted", local_checksum: "deleted", remote_excel: "deleted", remote_checksum: "deleted" });

    const concurrent = await Promise.allSettled([service.deleteBackup(first.id), service.deleteBackup(second.id)]);
    assert.equal(concurrent.filter((item) => item.status === "fulfilled" && item.value.deleted).length, 1);
    assert.equal(concurrent.filter((item) => item.status === "rejected" && ["BACKUP_ALREADY_RUNNING", "BACKUP_LAST_VALID"].includes(item.reason.code)).length, 1);
    const checked = new DatabaseSync(scenario.database, { readOnly: true });
    assert.equal(checked.prepare("SELECT COUNT(*) AS count FROM backup_records WHERE status='success'").get().count, 1);
    checked.close();
  } finally {
    fs.rmSync(scenario.tempRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
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

async function withServerScenario(prefix, seed, action) {
  const scenario = initScenario(prefix);
  const db = new DatabaseSync(scenario.database);
  const records = seed(db, scenario.tempRoot);
  db.close();
  const port = await freePort();
  let stderr = "";
  const server = spawn(process.execPath, [serverScript], { cwd: root, env: { ...scenario.environment, PORT: String(port) }, stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
  server.stderr.on("data", (chunk) => { stderr += String(chunk); });
  try {
    await waitForServer(server, port, () => stderr);
    await action({ ...scenario, records, port, server, stderr: () => stderr });
  } finally {
    if (server.exitCode == null) server.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 200));
    fs.rmSync(scenario.tempRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}

test("batch API deduplicates IDs, continues after failures, enforces protection and writes a safe summary", async () => withServerScenario("liming-backup-api-batch-", (db, tempRoot) => {
  const creator = db.prepare("SELECT id FROM users WHERE username='boss'").get().id;
  const cleanA = insertBackup(db, { filename: "clean-a.xlsx", creator });
  const cleanB = insertBackup(db, { filename: "clean-b.xlsx", creator });
  const partial = insertBackup(db, { filename: "partial.xlsx", creator });
  const pinned = insertBackup(db, { filename: "pinned.xlsx", pinned: 1, creator });
  const running = insertBackup(db, { filename: "running.xlsx", status: "creating", creator });
  const successA = insertBackup(db, { filename: "success-a.xlsx", status: "success", creator });
  const successB = insertBackup(db, { filename: "success-b.xlsx", status: "success", creator });
  [cleanA, cleanB, pinned, running, successA, successB].forEach((record) => createManaged(tempRoot, record));
  createManaged(tempRoot, partial, { directory: true });
  return { cleanA, cleanB, partial, pinned, running, successA, successB };
}, async ({ database, records, port, tempRoot }) => {
  const login = async (username) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password: "123456" }) });
    assert.equal(response.status, 200);
    return response.headers.get("set-cookie").split(";")[0];
  };
  const ownerCookie = await login("boss");
  const readonlyCookie = await login("teacher");
  const call = (body, cookie = ownerCookie) => fetch(`http://127.0.0.1:${port}/api/data-center/backups/batch-delete`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await call({ backup_ids: [] })).status, 400);
  assert.equal((await call({ backup_ids: Array.from({ length: 101 }, (_, index) => index + 1) })).status, 400);
  assert.equal((await call({ backup_ids: [records.cleanA.id] }, readonlyCookie)).status, 403);

  const response = await call({ backup_ids: [records.cleanA.id, records.cleanB.id, records.cleanA.id, records.partial.id, records.pinned.id, records.running.id, records.successA.id, "invalid"] });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(result.selected_count, 7);
  assert.equal(result.deleted_count, 3);
  assert.equal(result.failed_count, 2);
  assert.equal(result.protected_count, 2);
  assert.equal(result.results.filter((item) => item.backup_id === records.cleanA.id).length, 1);
  assert.equal(result.results.find((item) => item.backup_id === records.partial.id).status, "failed");
  assert.equal(result.results.find((item) => item.backup_id === records.pinned.id).code, "BACKUP_PINNED");
  assert.equal(result.results.find((item) => item.backup_id === records.running.id).code, "BACKUP_BUSY");
  assert.equal(result.results.find((item) => item.status === "invalid").code, "INVALID_BACKUP_ID");
  assert.equal(fs.existsSync(path.join(tempRoot, ...records.cleanA.relative.split("/"))), false);
  const checked = new DatabaseSync(database, { readOnly: true });
  for (const id of [records.cleanA.id, records.cleanB.id, records.successA.id]) assert.equal(checked.prepare("SELECT COUNT(*) AS count FROM backup_records WHERE id=?").get(id).count, 0);
  assert.equal(checked.prepare("SELECT COUNT(*) AS count FROM backup_records WHERE id=?").get(records.partial.id).count, 1);
  assert.equal(checked.prepare("SELECT COUNT(*) AS count FROM backup_records WHERE id=?").get(records.successB.id).count, 1);
  const log = checked.prepare("SELECT operation_content,extra_json FROM operation_logs WHERE operation_type='批量删除全量数据备份' ORDER BY id DESC LIMIT 1").get();
  checked.close();
  assert.match(log.operation_content, /选择 7 条，删除 3 条，失败 2 条，受保护 2 条/);
  assert.doesNotMatch(JSON.stringify(log), /access_token|refresh_token|app_secret|dlink|liming-backup-api-batch/i);
}));

test("backup page selection, confirmation, partial result retention and responsive DOM work in Chromium", async () => withServerScenario("liming-backup-page-batch-", (db, tempRoot) => {
  const creator = db.prepare("SELECT id FROM users WHERE username='boss'").get().id;
  const clean = insertBackup(db, { filename: "page-clean.xlsx", creator });
  const another = insertBackup(db, { filename: "page-another.xlsx", creator });
  const partial = insertBackup(db, { filename: "page-partial.xlsx", creator });
  const pinned = insertBackup(db, { filename: "page-pinned.xlsx", pinned: 1, creator });
  const running = insertBackup(db, { filename: "page-running.xlsx", status: "creating", creator });
  const lastValid = insertBackup(db, { filename: "page-last-valid.xlsx", status: "success", creator });
  [clean, another, pinned, running, lastValid].forEach((record) => createManaged(tempRoot, record));
  createManaged(tempRoot, partial, { directory: true });
  return { clean, another, partial, pinned, running, lastValid };
}, async ({ records, port, tempRoot }) => {
  const chrome = await launchChrome(path.join(tempRoot, "chrome-profile"));
  try {
    await chrome.session.send("Page.navigate", { url: `http://127.0.0.1:${port}/` });
    await chrome.session.login("boss", "123456");
    await chrome.session.openDataCenter();
    await chrome.session.waitFor("document.querySelectorAll('.backup-record-select-row').length === 6");
    const disabled = await chrome.session.evaluate("[...document.querySelectorAll('.backup-record-select-row:disabled')].map((box)=>({id:Number(box.dataset.id),title:box.title}))");
    assert.deepEqual(new Set(disabled.map((item) => item.id)), new Set([records.pinned.id, records.running.id, records.lastValid.id]));
    assert.equal(disabled.every((item) => item.title.length > 0), true);

    await chrome.session.click(".backup-record-select-all");
    assert.equal(await chrome.session.evaluate("document.querySelectorAll('.backup-record-select-row:checked').length"), 3);
    assert.match((await chrome.session.evaluate("document.querySelector('.backup-selected-count')?.textContent")).replace(/\s+/g, ""), /已选择3条/);
    await chrome.session.evaluate(`document.querySelector('.backup-record-select-row[data-id="${records.another.id}"]').click()`);
    assert.equal(await chrome.session.evaluate("document.querySelector('.backup-record-select-all').indeterminate"), true);
    await chrome.session.click(".backup-selection-clear");
    assert.equal(await chrome.session.evaluate("document.querySelectorAll('.backup-record-select-row:checked').length"), 0);

    await chrome.session.evaluate(`document.querySelector('.backup-record-select-row[data-id="${records.clean.id}"]').click(); document.querySelector('.backup-record-select-row[data-id="${records.partial.id}"]').click()`);
    await chrome.session.click(".backup-batch-delete-open");
    await chrome.session.waitFor("Boolean(document.querySelector('.backup-batch-delete-modal'))");
    const confirmText = await chrome.session.evaluate("document.querySelector('.backup-batch-delete-modal').textContent");
    for (const text of ["确认批量删除备份", "已选择", "2 条", "成功备份", "失败备份", "本地备份", "百度备份", "确认删除"]) assert.match(confirmText, new RegExp(text));
    assert.equal(await chrome.session.evaluate("Boolean(document.querySelector('.backup-batch-delete-modal input[type=\"password\"]'))"), false);
    assert.doesNotMatch(confirmText, /Token|dlink|access_token/);
    await chrome.session.click(".backup-batch-delete-confirm");
    await chrome.session.waitFor("document.querySelector('.backup-batch-result-summary')?.textContent.includes('删除1条') && document.querySelector('.backup-batch-result-summary')?.textContent.includes('失败1条')");
    assert.equal(await chrome.session.evaluate(`Boolean(document.querySelector('tr[data-backup-id="${records.clean.id}"]'))`), false);
    assert.equal(await chrome.session.evaluate(`document.querySelector('.backup-record-select-row[data-id="${records.partial.id}"]')?.checked`), true);
    await chrome.session.click(".backup-batch-details-toggle");
    await chrome.session.waitFor("Boolean(document.querySelector('.backup-batch-result-table'))");
    assert.match(await chrome.session.evaluate("document.querySelector('.backup-batch-result-table').textContent"), /page-clean\.xlsx|page-partial\.xlsx/);
    assert.doesNotMatch(await chrome.session.evaluate("document.querySelector('.backup-batch-result-table').textContent"), /SELECT |sqlite|access_token|dlink/i);
    await chrome.session.click(".backup-batch-delete-close");
    await chrome.session.click(".backup-refresh");
    await chrome.session.waitFor(`!document.querySelector('tr[data-backup-id="${records.clean.id}"]')`);

    await chrome.session.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await chrome.session.evaluate("window.dispatchEvent(new Event('resize'))");
    assert.equal(await chrome.session.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth"), false);
    assert.equal(await chrome.session.evaluate("Boolean(document.querySelector('.backup-select-col .backup-record-select-row'))"), true);

    await chrome.session.evaluate("setActiveView('dashboard'); render()");
    await chrome.session.waitFor("document.querySelector('#topbar')?.textContent.includes('首页')");
    await chrome.session.openDataCenter();
    await chrome.session.waitFor("Boolean(document.querySelector('.backup-record-select-row'))");
    assert.equal(await chrome.session.evaluate("document.querySelectorAll('.backup-record-select-row:checked').length"), 0);
    assert.deepEqual(chrome.session.exceptions, []);
    assert.deepEqual(chrome.session.consoleErrors, []);
  } finally {
    await chrome.session.close();
    if (chrome.child.exitCode == null) chrome.child.kill("SIGTERM");
  }
}));
