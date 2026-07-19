const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");
const { Transform } = require("node:stream");

const MAGIC = Buffer.from("LIMING-AES256GCM1", "ascii");
const TAG_LENGTH = 16;
class EncryptionError extends Error { constructor(code, message) { super(message); this.name = "EncryptionError"; this.code = code; } }
function encryptionKey(value = process.env.BACKUP_ENCRYPTION_KEY || "") {
  const source = String(value).trim(); let key;
  if (/^[0-9a-f]{64}$/i.test(source)) key = Buffer.from(source, "hex"); else { try { key = Buffer.from(source, "base64"); } catch {} }
  if (!key || key.length !== 32) throw new EncryptionError("BACKUP_ENCRYPTION_KEY_INVALID", "备份加密密钥必须是32字节的Base64或64位十六进制值");
  return key;
}
function pathsAreSafe(input, output) { if (path.resolve(input) === path.resolve(output)) throw new EncryptionError("BACKUP_ENCRYPTION_PATH_INVALID", "输入和输出文件不能相同"); if (fs.existsSync(output)) throw new EncryptionError("BACKUP_ENCRYPTION_TARGET_EXISTS", "目标文件已存在"); }

async function encryptFile({ inputPath, outputPath, key: keyValue }) {
  const input = path.resolve(inputPath); const output = path.resolve(outputPath); pathsAreSafe(input, output); const key = encryptionKey(keyValue); const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv("aes-256-gcm", key, iv); const temporary = `${output}.tmp-${process.pid}-${crypto.randomUUID()}`;
  const header = Buffer.concat([MAGIC, Buffer.from([iv.length]), iv]);
  try {
    const writer = fs.createWriteStream(temporary, { flags: "wx", mode: 0o600 }); writer.write(header);
    await pipeline(fs.createReadStream(input), cipher, writer);
    fs.appendFileSync(temporary, cipher.getAuthTag()); fs.chmodSync(temporary, 0o600); fs.renameSync(temporary, output);
    return { output_path: output, algorithm: "AES-256-GCM", encrypted_size: fs.statSync(output).size };
  } catch (error) { try { fs.rmSync(temporary, { force: true }); } catch {} if (error instanceof EncryptionError) throw error; throw new EncryptionError("BACKUP_ENCRYPTION_FAILED", "备份文件加密失败"); }
}

async function decryptFile({ inputPath, outputPath, key: keyValue }) {
  const input = path.resolve(inputPath); const output = path.resolve(outputPath); pathsAreSafe(input, output); const key = encryptionKey(keyValue); const fd = fs.openSync(input, "r"); const size = fs.fstatSync(fd).size; const prefix = Buffer.alloc(MAGIC.length + 1);
  try { fs.readSync(fd, prefix, 0, prefix.length, 0); if (!prefix.subarray(0, MAGIC.length).equals(MAGIC)) throw new EncryptionError("BACKUP_ENCRYPTION_FORMAT_INVALID", "加密文件格式无效"); const ivLength = prefix[MAGIC.length]; if (ivLength !== 12 || size <= prefix.length + ivLength + TAG_LENGTH) throw new EncryptionError("BACKUP_ENCRYPTION_FORMAT_INVALID", "加密文件格式无效"); const iv = Buffer.alloc(ivLength); const tag = Buffer.alloc(TAG_LENGTH); fs.readSync(fd, iv, 0, iv.length, prefix.length); fs.readSync(fd, tag, 0, tag.length, size - TAG_LENGTH); const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv); decipher.setAuthTag(tag); const temporary = `${output}.tmp-${process.pid}-${crypto.randomUUID()}`; try { await pipeline(fs.createReadStream(input, { start: prefix.length + ivLength, end: size - TAG_LENGTH - 1 }), decipher, fs.createWriteStream(temporary, { flags: "wx", mode: 0o600 })); fs.chmodSync(temporary, 0o600); fs.renameSync(temporary, output); return { output_path: output, verified: true }; } catch { try { fs.rmSync(temporary, { force: true }); } catch {} throw new EncryptionError("BACKUP_ENCRYPTION_AUTH_FAILED", "加密文件认证失败，密钥错误或文件已损坏"); } }
  finally { fs.closeSync(fd); }
}

async function verifyEncryptedFile(options) {
  const temporary = path.join(path.dirname(path.resolve(options.inputPath)), `.verify-${process.pid}-${crypto.randomUUID()}.xlsx`);
  try { await decryptFile({ ...options, outputPath: temporary }); return { ok: true, algorithm: "AES-256-GCM" }; }
  finally { try { fs.rmSync(temporary, { force: true }); } catch {} }
}

module.exports = { MAGIC, TAG_LENGTH, EncryptionError, encryptionKey, encryptFile, decryptFile, verifyEncryptedFile };
