const zlib = require("node:zlib");

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[i] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStore(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const central = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, central, end]);
}

function xmlEscape(value) {
  return String(value ?? "").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function xmlDecode(value) {
  return String(value || "").replaceAll("&quot;", '"').replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
}

function columnName(index) {
  let value = index + 1;
  let result = "";
  while (value > 0) { const remainder = (value - 1) % 26; result = String.fromCharCode(65 + remainder) + result; value = Math.floor((value - 1) / 26); }
  return result;
}

function worksheetXml(rows, hiddenColumns = []) {
  const hidden = hiddenColumns.length ? `<cols>${hiddenColumns.map((index) => `<col min="${index + 1}" max="${index + 1}" hidden="1"/>`).join("")}</cols>` : "";
  const body = rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => {
    const ref = `${columnName(columnIndex)}${rowIndex + 1}`;
    if (typeof value === "number" && Number.isFinite(value)) return `<c r="${ref}"><v>${value}</v></c>`;
    return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(value instanceof Date ? value.toISOString() : value)}</t></is></c>`;
  }).join("")}</row>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${hidden}<sheetData>${body}</sheetData></worksheet>`;
}

function safeSheetName(value, fallback) {
  return String(value || "").replace(/[\\/?*\[\]:]/g, " ").trim().slice(0, 31) || fallback;
}

function createWorkbook(sheets) {
  const used = new Set();
  const normalized = sheets.map((sheet, index) => {
    const base = safeSheetName(sheet.name, `Sheet${index + 1}`);
    let name = base;
    let suffix = 2;
    while (used.has(name)) { const tail = `_${suffix++}`; name = `${base.slice(0, 31 - tail.length)}${tail}`; }
    used.add(name);
    return { ...sheet, name, rows: Array.isArray(sheet.rows) ? sheet.rows : [] };
  });
  const overrides = normalized.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("");
  const sheetTags = normalized.map((sheet, i) => `<sheet name="${xmlEscape(sheet.name)}" sheetId="${i + 1}"${sheet.hidden ? ' state="hidden"' : ""} r:id="rId${i + 1}"/>`).join("");
  const rels = normalized.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("");
  const files = [
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${overrides}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetTags}</sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}<Relationship Id="rId${normalized.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", data: `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="1"><xf xfId="0"/></cellXfs></styleSheet>` },
  ];
  normalized.forEach((sheet, index) => files.push({ name: `xl/worksheets/sheet${index + 1}.xml`, data: worksheetXml(sheet.rows, sheet.hiddenColumns || []) }));
  return zipStore(files);
}

function readZip(buffer) {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 66000); i -= 1) if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("XLSX_ZIP_INVALID");
  const total = buffer.readUInt16LE(eocd + 10);
  let cursor = buffer.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let i = 0; i < total; i += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error("XLSX_ZIP_INVALID");
    const method = buffer.readUInt16LE(cursor + 10); const size = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28); const extraLength = buffer.readUInt16LE(cursor + 30); const commentLength = buffer.readUInt16LE(cursor + 32); const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8").replaceAll("\\", "/");
    const start = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    const raw = buffer.subarray(start, start + size);
    entries.set(name, method === 0 ? Buffer.from(raw) : method === 8 ? zlib.inflateRawSync(raw) : (() => { throw new Error("XLSX_ZIP_METHOD_UNSUPPORTED"); })());
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function attr(tag, name) { return xmlDecode(String(tag).match(new RegExp(`${name}="([^"]*)"`, "i"))?.[1] || ""); }
function columnIndex(ref) { let n = 0; for (const char of String(ref).match(/[A-Z]+/i)?.[0]?.toUpperCase() || "") n = n * 26 + char.charCodeAt(0) - 64; return n - 1; }

function parseWorkbook(buffer) {
  const entries = readZip(buffer);
  const workbook = entries.get("xl/workbook.xml")?.toString("utf8");
  const relationships = entries.get("xl/_rels/workbook.xml.rels")?.toString("utf8");
  if (!workbook || !relationships) throw new Error("XLSX_WORKBOOK_INVALID");
  const rels = new Map([...relationships.matchAll(/<Relationship\b([^>]*)\/?\>/g)].map(([, tag]) => [attr(tag, "Id"), `xl/${attr(tag, "Target")}`]));
  const sheets = [];
  for (const [, tag] of workbook.matchAll(/<sheet\b([^>]*)\/?\>/g)) {
    const name = attr(tag, "name"); const xml = entries.get(rels.get(attr(tag, "r:id")))?.toString("utf8");
    if (!xml) throw new Error(`XLSX_SHEET_MISSING:${name}`);
    const rows = [];
    for (const [, rowXml] of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const values = [];
      for (const [, cellTag, cellXml] of rowXml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
        const index = columnIndex(attr(cellTag, "r"));
        const inline = [...cellXml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((match) => xmlDecode(match[1])).join("");
        const raw = xmlDecode(cellXml.match(/<v>([\s\S]*?)<\/v>/)?.[1] || "");
        values[index] = attr(cellTag, "t") === "inlineStr" ? inline : raw === "" ? "" : Number(raw);
      }
      rows.push(values);
    }
    sheets.push({ name, state: attr(tag, "state") || "visible", rows, xml });
  }
  return { entries, sheets, sheetMap: new Map(sheets.map((sheet) => [sheet.name, sheet])) };
}

module.exports = { createWorkbook, parseWorkbook, readZip };
