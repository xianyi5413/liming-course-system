"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { validateSnapshot } = require("../p1a/sqlite_snapshot");
const {
  ERROR_CODES,
  P1BError,
  assertExistingPathNoSymlink,
  classifyError,
  compareText,
  normalizeArchivePath,
  sha256Buffer,
  sha256File,
} = require("./common");
const { EXCLUDED_COMPONENTS, MANIFEST_VERSION } = require("./backup_package");
const { readZipEntryBuffer, readZipIndex, streamZipEntry } = require("./zip_store");

const REQUIRED_MANIFEST_KEYS = Object.freeze([
  "app_git_commit",
  "app_version",
  "architecture",
  "backup_id",
  "backup_type",
  "components",
  "created_at_asia_shanghai",
  "created_at_utc",
  "database_foreign_key_violation_count",
  "database_integrity_check",
  "excluded_components",
  "manifest_version",
  "node_version",
  "platform",
  "scheduled_for",
  "scheduled_for_asia_shanghai",
  "schema_version",
  "schema_version_source",
  "snapshot_strategy",
  "sqlite_version",
  "task_id",
  "trigger",
  "warnings",
]);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseSidecar(text, zipName) {
  const match = /^([0-9a-f]{64})  ([^\r\n]+)\r?\n$/i.exec(text);
  if (!match || match[2] !== zipName) {
    throw new P1BError(ERROR_CODES.HASH_MISMATCH, "Backup SHA-256 sidecar is invalid");
  }
  return match[1].toLowerCase();
}

function assertNoAbsoluteStrings(value) {
  if (typeof value === "string") {
    if (value.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("\\\\")) {
      throw new P1BError(ERROR_CODES.MANIFEST_INVALID, "Manifest contains an absolute path");
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertNoAbsoluteStrings(item);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) assertNoAbsoluteStrings(item);
  }
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new P1BError(ERROR_CODES.MANIFEST_INVALID, "Manifest must be an object");
  }
  const keys = Object.keys(manifest).sort(compareText);
  if (JSON.stringify(keys) !== JSON.stringify(REQUIRED_MANIFEST_KEYS.slice().sort(compareText))) {
    throw new P1BError(ERROR_CODES.MANIFEST_INVALID, "Manifest fields do not match version 1.0");
  }
  if (manifest.manifest_version !== MANIFEST_VERSION || manifest.backup_type !== "system_full") {
    throw new P1BError(ERROR_CODES.MANIFEST_INVALID, "Unsupported backup manifest version or type");
  }
  if (!UUID_V4.test(manifest.backup_id)) throw new P1BError(ERROR_CODES.MANIFEST_INVALID, "Manifest backup ID is invalid");
  if (!UUID_V4.test(manifest.task_id) || manifest.task_id === manifest.backup_id) {
    throw new P1BError(ERROR_CODES.MANIFEST_INVALID, "Manifest task ID is invalid");
  }
  if (!/^\d{4}-\d{2}-\d{2}T.*Z$/.test(manifest.created_at_utc)) throw new P1BError(ERROR_CODES.MANIFEST_INVALID, "Manifest UTC timestamp is invalid");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/.test(manifest.created_at_asia_shanghai)) {
    throw new P1BError(ERROR_CODES.MANIFEST_INVALID, "Manifest Asia/Shanghai timestamp is invalid");
  }
  if (manifest.scheduled_for !== null && !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(manifest.scheduled_for)) {
    throw new P1BError(ERROR_CODES.MANIFEST_INVALID, "Manifest scheduled-for timestamp is invalid");
  }
  if (
    (manifest.scheduled_for === null && manifest.scheduled_for_asia_shanghai !== null)
    || (manifest.scheduled_for !== null && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/.test(manifest.scheduled_for_asia_shanghai))
  ) {
    throw new P1BError(ERROR_CODES.MANIFEST_INVALID, "Manifest Asia/Shanghai scheduled-for timestamp is invalid");
  }
  if (manifest.database_integrity_check !== "ok" || manifest.database_foreign_key_violation_count !== 0) {
    throw new P1BError(ERROR_CODES.DATABASE_INVALID, "Manifest reports an invalid database snapshot");
  }
  if (manifest.schema_version_source !== "pragma_user_version" || !Number.isInteger(manifest.schema_version)) {
    throw new P1BError(ERROR_CODES.MANIFEST_INVALID, "Manifest schema version is invalid");
  }
  if (!Array.isArray(manifest.components) || !Array.isArray(manifest.excluded_components) || !Array.isArray(manifest.warnings)) {
    throw new P1BError(ERROR_CODES.MANIFEST_INVALID, "Manifest collections are invalid");
  }
  if (JSON.stringify(manifest.excluded_components) !== JSON.stringify(EXCLUDED_COMPONENTS)) {
    throw new P1BError(ERROR_CODES.MANIFEST_INVALID, "Manifest excluded component policy is invalid");
  }
  const seen = new Set();
  for (const component of manifest.components) {
    if (!component || typeof component !== "object") throw new P1BError(ERROR_CODES.MANIFEST_INVALID, "Manifest component is invalid");
    const directory = component.type === "directory";
    if (!directory && component.type !== "file") throw new P1BError(ERROR_CODES.MANIFEST_INVALID, "Manifest component type is invalid");
    const normalized = normalizeArchivePath(component.path, { directory });
    if (normalized !== component.path || seen.has(normalized)) throw new P1BError(ERROR_CODES.MANIFEST_INVALID, "Manifest component path is invalid or duplicated");
    seen.add(normalized);
    if (typeof component.exists !== "boolean" || !Number.isSafeInteger(component.size) || component.size < 0) {
      throw new P1BError(ERROR_CODES.MANIFEST_INVALID, "Manifest component metadata is invalid");
    }
    if (component.exists && !/^[0-9a-f]{64}$/.test(component.sha256)) {
      throw new P1BError(ERROR_CODES.MANIFEST_INVALID, "Manifest component SHA-256 is invalid");
    }
    if (!component.exists && component.sha256 !== null) {
      throw new P1BError(ERROR_CODES.MANIFEST_INVALID, "Absent component must not have a SHA-256");
    }
  }
  assertNoAbsoluteStrings(manifest);
  return manifest;
}

function expectedZipEntries(manifest) {
  const expected = new Set(["manifest.json", "database/", "files/", "metadata/"]);
  for (const component of manifest.components) {
    expected.add(component.path);
    const withoutSlash = component.path.replace(/\/$/, "");
    const parts = withoutSlash.split("/");
    for (let index = 1; index < parts.length; index += 1) expected.add(`${parts.slice(0, index).join("/")}/`);
  }
  return expected;
}

async function hashZipEntry(zipPath, entry) {
  const hash = crypto.createHash("sha256");
  let size = 0;
  let maxChunkBytes = 0;
  await streamZipEntry(zipPath, entry, async (chunk) => {
    hash.update(chunk);
    size += chunk.length;
    maxChunkBytes = Math.max(maxChunkBytes, chunk.length);
  });
  return { size, sha256: hash.digest("hex"), maxChunkBytes };
}

function directoryDigestFromManifest(directory, components) {
  const files = components
    .filter((component) => component.type === "file" && component.path.startsWith(directory.path))
    .sort((left, right) => compareText(left.path, right.path));
  const material = files.map((file) => `${file.path}\0${file.size}\0${file.sha256}\n`).join("");
  return sha256Buffer(Buffer.from(material, "utf8"));
}

async function extractDatabaseForValidation(zipPath, entry) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "liming-p1b-verify-"));
  fs.chmodSync(directory, 0o700);
  const output = path.join(directory, "database.sqlite");
  let handle;
  try {
    handle = await fs.promises.open(output, "wx", 0o600);
    let position = 0;
    await streamZipEntry(zipPath, entry, async (chunk) => {
      let offset = 0;
      while (offset < chunk.length) {
        const result = await handle.write(chunk, offset, chunk.length - offset, position + offset);
        if (!result.bytesWritten) throw new P1BError(ERROR_CODES.VERIFY_FAILED, "Database extraction made no progress");
        offset += result.bytesWritten;
      }
      position += chunk.length;
    });
    await handle.sync();
    await handle.close();
    handle = null;
    fs.chmodSync(output, 0o600);
    return { directory, output, validation: validateSnapshot(output) };
  } catch (error) {
    await handle?.close().catch(() => {});
    const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(directory));
    if (
      relative
      && !relative.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relative)
      && path.basename(directory).startsWith("liming-p1b-verify-")
    ) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
    throw error;
  }
}

function cleanupVerificationDirectory(directory) {
  const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(directory));
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !path.basename(directory).startsWith("liming-p1b-verify-")) {
    throw new P1BError(ERROR_CODES.CLEANUP_FAILED, "Refusing to remove an unsafe verification directory");
  }
  fs.rmSync(directory, { recursive: true, force: true });
}

async function verifyBackupPackage(options = {}) {
  if (!options.zipPath) throw new P1BError(ERROR_CODES.INVALID_ARGUMENT, "ZIP path is required");
  const zipPath = assertExistingPathNoSymlink(options.zipPath, "file").path;
  const sidecarPath = assertExistingPathNoSymlink(options.sidecarPath || `${zipPath}.sha256`, "file").path;
  try {
    const sidecarStat = fs.statSync(sidecarPath);
    if (sidecarStat.size > 1024) throw new P1BError(ERROR_CODES.HASH_MISMATCH, "Backup SHA-256 sidecar is too large");
    const expectedPackageHash = parseSidecar(fs.readFileSync(sidecarPath, "utf8"), path.basename(zipPath));
    const packageHash = await sha256File(zipPath);
    if (packageHash.sha256 !== expectedPackageHash) {
      throw new P1BError(ERROR_CODES.HASH_MISMATCH, "Backup package SHA-256 does not match the sidecar");
    }

    const index = await readZipIndex(zipPath);
    const entryMap = new Map(index.entries.map((entry) => [entry.name, entry]));
    const manifestEntry = entryMap.get("manifest.json");
    if (!manifestEntry) throw new P1BError(ERROR_CODES.MANIFEST_INVALID, "Backup manifest is missing");
    let manifest;
    try {
      manifest = JSON.parse((await readZipEntryBuffer(zipPath, manifestEntry)).toString("utf8"));
    } catch (error) {
      throw new P1BError(ERROR_CODES.MANIFEST_INVALID, "Backup manifest JSON is invalid", { cause: error });
    }
    validateManifest(manifest);

    const expectedEntries = expectedZipEntries(manifest);
    const actualEntries = new Set(index.entries.map((entry) => entry.name));
    if (
      expectedEntries.size !== actualEntries.size
      || [...expectedEntries].some((entry) => !actualEntries.has(entry))
    ) {
      throw new P1BError(ERROR_CODES.ZIP_INVALID, "ZIP entries do not match the manifest");
    }

    let maxChunkBytes = packageHash.maxChunkBytes;
    for (const component of manifest.components) {
      if (component.type === "directory") {
        if (component.exists && directoryDigestFromManifest(component, manifest.components) !== component.sha256) {
          throw new P1BError(ERROR_CODES.HASH_MISMATCH, "Directory component SHA-256 does not match its files");
        }
        continue;
      }
      const entry = entryMap.get(component.path);
      if (!entry) throw new P1BError(ERROR_CODES.ZIP_INVALID, "Manifest component is missing from the ZIP");
      const actual = await hashZipEntry(zipPath, entry);
      maxChunkBytes = Math.max(maxChunkBytes, actual.maxChunkBytes);
      if (actual.size !== component.size || actual.sha256 !== component.sha256) {
        throw new P1BError(ERROR_CODES.HASH_MISMATCH, "Backup component SHA-256 does not match the manifest");
      }
    }

    const databaseEntry = entryMap.get("database/liming-local.sqlite");
    let extracted;
    try {
      extracted = await extractDatabaseForValidation(zipPath, databaseEntry);
      if (extracted.validation.integrityCheck !== "ok" || extracted.validation.foreignKeyViolations !== 0) {
        throw new P1BError(ERROR_CODES.DATABASE_INVALID, "Backup SQLite validation failed");
      }
    } catch (error) {
      if (error instanceof P1BError) throw error;
      throw new P1BError(ERROR_CODES.DATABASE_INVALID, "Backup SQLite validation failed", { cause: error });
    } finally {
      if (extracted?.directory) cleanupVerificationDirectory(extracted.directory);
    }

    return {
      ok: true,
      backupId: manifest.backup_id,
      packageSha256: packageHash.sha256,
      packageBytes: packageHash.bytes,
      manifestVersion: manifest.manifest_version,
      componentCount: manifest.components.length,
      databaseIntegrityCheck: "ok",
      databaseForeignKeyViolationCount: 0,
      maxChunkBytes,
      manifest,
    };
  } catch (error) {
    throw classifyError(error, ERROR_CODES.VERIFY_FAILED, "verify");
  }
}

module.exports = {
  REQUIRED_MANIFEST_KEYS,
  expectedZipEntries,
  parseSidecar,
  validateManifest,
  verifyBackupPackage,
};
