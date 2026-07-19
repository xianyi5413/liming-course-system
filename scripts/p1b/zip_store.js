"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");

const {
  ERROR_CODES,
  P1BError,
  classifyError,
  normalizeArchivePath,
} = require("./common");

const UINT32_MAX = 0xffffffff;
const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  CRC_TABLE[index] = value >>> 0;
}

function crc32Update(state, buffer) {
  let value = state;
  for (const byte of buffer) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return value >>> 0;
}

function crc32Buffer(buffer) {
  return (crc32Update(0xffffffff, buffer) ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, Math.min(2107, date.getUTCFullYear()));
  const dosDate = ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate();
  const dosTime = (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2);
  return { dosDate, dosTime };
}

async function scanFile(filePath) {
  const hash = crypto.createHash("sha256");
  let crcState = 0xffffffff;
  let size = 0;
  let maxChunkBytes = 0;
  for await (const chunk of fs.createReadStream(filePath, { highWaterMark: 64 * 1024 })) {
    hash.update(chunk);
    crcState = crc32Update(crcState, chunk);
    size += chunk.length;
    maxChunkBytes = Math.max(maxChunkBytes, chunk.length);
    if (size > UINT32_MAX) throw new P1BError(ERROR_CODES.ZIP64_UNSUPPORTED, "ZIP64 files are not supported in P1B");
  }
  return { size, sha256: hash.digest("hex"), crc32: (crcState ^ 0xffffffff) >>> 0, maxChunkBytes };
}

function scanBuffer(buffer) {
  if (buffer.length > UINT32_MAX) throw new P1BError(ERROR_CODES.ZIP64_UNSUPPORTED, "ZIP64 entries are not supported in P1B");
  return {
    size: buffer.length,
    sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
    crc32: crc32Buffer(buffer),
    maxChunkBytes: buffer.length,
  };
}

class ZipStoreWriter {
  constructor(zipPath, options = {}) {
    this.zipPath = zipPath;
    this.onProgress = options.onProgress;
    this.entries = [];
    this.offset = 0;
    this.handle = null;
    this.closed = false;
    this.maxChunkBytes = 0;
  }

  async open() {
    this.handle = await fs.promises.open(this.zipPath, "wx", 0o600);
  }

  async write(buffer) {
    if (!this.handle || this.closed) throw new P1BError(ERROR_CODES.ZIP_CREATE_FAILED, "ZIP writer is not open");
    let written = 0;
    while (written < buffer.length) {
      const result = await this.handle.write(buffer, written, buffer.length - written, this.offset + written);
      if (!result.bytesWritten) throw new P1BError(ERROR_CODES.ZIP_CREATE_FAILED, "ZIP write made no progress");
      written += result.bytesWritten;
    }
    this.offset += buffer.length;
    this.maxChunkBytes = Math.max(this.maxChunkBytes, buffer.length);
    this.onProgress?.({ bytesWritten: this.offset, chunkBytes: buffer.length });
  }

  localHeader(entry, nameBuffer) {
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(entry.dosTime, 10);
    header.writeUInt16LE(entry.dosDate, 12);
    header.writeUInt32LE(entry.crc32, 14);
    header.writeUInt32LE(entry.size, 18);
    header.writeUInt32LE(entry.size, 22);
    header.writeUInt16LE(nameBuffer.length, 26);
    header.writeUInt16LE(0, 28);
    return header;
  }

  async addDirectory(archivePath, date) {
    const normalized = normalizeArchivePath(archivePath, { directory: true });
    const metadata = { size: 0, crc32: 0, sha256: crypto.createHash("sha256").digest("hex") };
    await this.addEntry(normalized, metadata, date, async () => {});
  }

  async addBuffer(archivePath, buffer, expected, date) {
    const normalized = normalizeArchivePath(archivePath);
    const actual = scanBuffer(buffer);
    if (expected && (actual.size !== expected.size || actual.sha256 !== expected.sha256)) {
      throw new P1BError(ERROR_CODES.SOURCE_CHANGED, "Generated component changed before ZIP creation");
    }
    await this.addEntry(normalized, actual, date, async () => this.write(buffer));
    return actual;
  }

  async addFile(archivePath, sourcePath, expected, date) {
    const normalized = normalizeArchivePath(archivePath);
    await this.addEntry(normalized, expected, date, async () => {
      const hash = crypto.createHash("sha256");
      let crcState = 0xffffffff;
      let size = 0;
      for await (const chunk of fs.createReadStream(sourcePath, { highWaterMark: 64 * 1024 })) {
        hash.update(chunk);
        crcState = crc32Update(crcState, chunk);
        size += chunk.length;
        await this.write(chunk);
      }
      const streamed = { size, sha256: hash.digest("hex"), crc32: (crcState ^ 0xffffffff) >>> 0 };
      if (streamed.size !== expected.size || streamed.sha256 !== expected.sha256 || streamed.crc32 !== expected.crc32) {
        throw new P1BError(ERROR_CODES.SOURCE_CHANGED, "Source component changed during ZIP creation");
      }
    });
  }

  async addEntry(name, metadata, date, streamBody) {
    if (this.entries.some((entry) => entry.name === name)) {
      throw new P1BError(ERROR_CODES.ZIP_CREATE_FAILED, "Duplicate ZIP entry");
    }
    if (metadata.size > UINT32_MAX || this.offset > UINT32_MAX) {
      throw new P1BError(ERROR_CODES.ZIP64_UNSUPPORTED, "ZIP64 archives are not supported in P1B");
    }
    const nameBuffer = Buffer.from(name, "utf8");
    const time = dosDateTime(date);
    const entry = { name, ...metadata, ...time, localOffset: this.offset };
    await this.write(this.localHeader(entry, nameBuffer));
    await this.write(nameBuffer);
    await streamBody();
    this.entries.push(entry);
  }

  centralHeader(entry) {
    const nameBuffer = Buffer.from(entry.name, "utf8");
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE((3 << 8) | 20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(entry.dosTime, 12);
    header.writeUInt16LE(entry.dosDate, 14);
    header.writeUInt32LE(entry.crc32, 16);
    header.writeUInt32LE(entry.size, 20);
    header.writeUInt32LE(entry.size, 24);
    header.writeUInt16LE(nameBuffer.length, 28);
    header.writeUInt16LE(0, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    const mode = entry.name.endsWith("/") ? 0o40700 : 0o100600;
    header.writeUInt32LE(((mode << 16) | (entry.name.endsWith("/") ? 0x10 : 0)) >>> 0, 38);
    header.writeUInt32LE(entry.localOffset, 42);
    return { header, nameBuffer };
  }

  async finalize() {
    if (this.entries.length > 0xffff) throw new P1BError(ERROR_CODES.ZIP64_UNSUPPORTED, "Too many ZIP entries");
    const centralOffset = this.offset;
    for (const entry of this.entries) {
      const central = this.centralHeader(entry);
      await this.write(central.header);
      await this.write(central.nameBuffer);
    }
    const centralSize = this.offset - centralOffset;
    if (centralOffset > UINT32_MAX || centralSize > UINT32_MAX) {
      throw new P1BError(ERROR_CODES.ZIP64_UNSUPPORTED, "ZIP64 archives are not supported in P1B");
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(centralSize, 12);
    end.writeUInt32LE(centralOffset, 16);
    end.writeUInt16LE(0, 20);
    await this.write(end);
    await this.handle.sync();
    await this.close();
    fs.chmodSync(this.zipPath, 0o600);
    return { bytes: this.offset, entries: this.entries.map((entry) => entry.name), maxChunkBytes: this.maxChunkBytes };
  }

  async close() {
    if (this.handle && !this.closed) {
      this.closed = true;
      await this.handle.close();
    }
  }

  async abort() {
    try {
      await this.close();
    } finally {
      try {
        fs.unlinkSync(this.zipPath);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
  }
}

async function createStoredZip(zipPath, entries, options = {}) {
  const writer = new ZipStoreWriter(zipPath, options);
  try {
    await writer.open();
    for (const entry of entries) {
      if (entry.kind === "directory") await writer.addDirectory(entry.archivePath, entry.date);
      else if (entry.kind === "buffer") await writer.addBuffer(entry.archivePath, entry.buffer, entry.expected, entry.date);
      else await writer.addFile(entry.archivePath, entry.sourcePath, entry.expected, entry.date);
    }
    return await writer.finalize();
  } catch (error) {
    try {
      await writer.abort();
    } catch {
      // The enclosing staging cleanup remains the final safety net.
    }
    throw classifyError(error, ERROR_CODES.ZIP_CREATE_FAILED, "zip");
  }
}

async function readExact(handle, position, length) {
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const result = await handle.read(buffer, offset, length - offset, position + offset);
    if (!result.bytesRead) throw new P1BError(ERROR_CODES.ZIP_INVALID, "Unexpected end of ZIP file");
    offset += result.bytesRead;
  }
  return buffer;
}

async function readZipIndex(zipPath) {
  const handle = await fs.promises.open(zipPath, "r");
  try {
    const stat = await handle.stat();
    const tailLength = Math.min(stat.size, 65557);
    const tail = await readExact(handle, stat.size - tailLength, tailLength);
    let eocdOffset = -1;
    for (let index = tail.length - 22; index >= 0; index -= 1) {
      if (tail.readUInt32LE(index) === 0x06054b50) {
        eocdOffset = index;
        break;
      }
    }
    if (eocdOffset < 0) throw new P1BError(ERROR_CODES.ZIP_INVALID, "ZIP end record is missing");
    const entryCount = tail.readUInt16LE(eocdOffset + 10);
    const centralSize = tail.readUInt32LE(eocdOffset + 12);
    const centralOffset = tail.readUInt32LE(eocdOffset + 16);
    if (entryCount === 0xffff || centralSize === UINT32_MAX || centralOffset === UINT32_MAX) {
      throw new P1BError(ERROR_CODES.ZIP64_UNSUPPORTED, "ZIP64 archives are not supported in P1B");
    }
    if (centralOffset + centralSize > stat.size) throw new P1BError(ERROR_CODES.ZIP_INVALID, "ZIP central directory is outside the file");
    const entries = [];
    const names = new Set();
    let position = centralOffset;
    for (let index = 0; index < entryCount; index += 1) {
      const header = await readExact(handle, position, 46);
      if (header.readUInt32LE(0) !== 0x02014b50) throw new P1BError(ERROR_CODES.ZIP_INVALID, "Invalid ZIP central entry");
      const method = header.readUInt16LE(10);
      const crc32 = header.readUInt32LE(16);
      const compressedSize = header.readUInt32LE(20);
      const size = header.readUInt32LE(24);
      const nameLength = header.readUInt16LE(28);
      const extraLength = header.readUInt16LE(30);
      const commentLength = header.readUInt16LE(32);
      const externalAttributes = header.readUInt32LE(38);
      const localOffset = header.readUInt32LE(42);
      const nameBuffer = await readExact(handle, position + 46, nameLength);
      const name = nameBuffer.toString("utf8");
      normalizeArchivePath(name, { directory: name.endsWith("/") });
      if (names.has(name)) throw new P1BError(ERROR_CODES.ZIP_INVALID, "Duplicate ZIP entry");
      names.add(name);
      if (method !== 0 || compressedSize !== size) throw new P1BError(ERROR_CODES.ZIP_INVALID, "P1B verification only accepts stored ZIP entries");
      const unixFileType = (externalAttributes >>> 16) & 0o170000;
      if (unixFileType === 0o120000) throw new P1BError(ERROR_CODES.SYMLINK_REJECTED, "Symbolic-link ZIP entries are not allowed");
      const local = await readExact(handle, localOffset, 30);
      if (local.readUInt32LE(0) !== 0x04034b50) throw new P1BError(ERROR_CODES.ZIP_INVALID, "Invalid ZIP local entry");
      if (
        local.readUInt16LE(8) !== method
        || local.readUInt32LE(14) !== crc32
        || local.readUInt32LE(18) !== compressedSize
        || local.readUInt32LE(22) !== size
      ) {
        throw new P1BError(ERROR_CODES.ZIP_INVALID, "ZIP local and central metadata disagree");
      }
      const localNameLength = local.readUInt16LE(26);
      const localExtraLength = local.readUInt16LE(28);
      const localName = (await readExact(handle, localOffset + 30, localNameLength)).toString("utf8");
      if (localName !== name) throw new P1BError(ERROR_CODES.ZIP_INVALID, "ZIP entry names disagree");
      const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
      if (dataOffset + size > stat.size) throw new P1BError(ERROR_CODES.ZIP_INVALID, "ZIP entry data is outside the file");
      entries.push({ name, method, crc32, size, compressedSize, localOffset, dataOffset, externalAttributes });
      position += 46 + nameLength + extraLength + commentLength;
    }
    if (position !== centralOffset + centralSize) throw new P1BError(ERROR_CODES.ZIP_INVALID, "ZIP central directory size mismatch");
    const ranges = entries
      .filter((entry) => !entry.name.endsWith("/"))
      .map((entry) => ({ start: entry.dataOffset, end: entry.dataOffset + entry.size, name: entry.name }))
      .sort((left, right) => left.start - right.start);
    for (let index = 0; index < ranges.length; index += 1) {
      if (ranges[index].end > centralOffset || (index > 0 && ranges[index].start < ranges[index - 1].end)) {
        throw new P1BError(ERROR_CODES.ZIP_INVALID, "ZIP entry ranges overlap or cross the central directory");
      }
    }
    return { fileSize: stat.size, entries };
  } finally {
    await handle.close();
  }
}

async function streamZipEntry(zipPath, entry, onChunk) {
  if (entry.size === 0) return;
  const stream = fs.createReadStream(zipPath, {
    start: entry.dataOffset,
    end: entry.dataOffset + entry.size - 1,
    highWaterMark: 64 * 1024,
  });
  for await (const chunk of stream) await onChunk(chunk);
}

async function readZipEntryBuffer(zipPath, entry, maxBytes = 1024 * 1024) {
  if (entry.size > maxBytes) throw new P1BError(ERROR_CODES.ZIP_INVALID, "ZIP metadata entry exceeds the allowed size");
  const chunks = [];
  await streamZipEntry(zipPath, entry, async (chunk) => chunks.push(chunk));
  return Buffer.concat(chunks);
}

module.exports = {
  ZipStoreWriter,
  createStoredZip,
  crc32Buffer,
  readZipEntryBuffer,
  readZipIndex,
  scanBuffer,
  scanFile,
  streamZipEntry,
};
