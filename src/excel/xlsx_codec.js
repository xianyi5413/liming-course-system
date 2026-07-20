const zlib = require("node:zlib");

const MAX_CELL_TEXT_LENGTH = 30000;

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

function sanitizeCellText(value) {
  const input = String(value ?? "");
  let output = "";
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = input.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) { output += input[index] + input[index + 1]; index += 1; }
      else output += "\ufffd";
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) { output += "\ufffd"; continue; }
    if ((code >= 0 && code <= 8) || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 0xfffe || code === 0xffff) output += "\ufffd";
    else output += input[index];
  }
  return output;
}

function hasBrokenSurrogate(value) {
  const input = String(value ?? "");
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = input.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

function xmlEscape(value) {
  return sanitizeCellText(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&apos;").replaceAll("\r", "&#13;");
}

function xmlDecode(value) {
  return String(value || "").replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number(decimal)))
    .replaceAll("&quot;", '"').replaceAll("&apos;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
}

function columnName(index) {
  let value = index + 1;
  let result = "";
  while (value > 0) { const remainder = (value - 1) % 26; result = String.fromCharCode(65 + remainder) + result; value = Math.floor((value - 1) / 26); }
  return result;
}

function safeCellValue(value, sheetName, rowIndex, columnIndex) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const clean = sanitizeCellText(value instanceof Date ? value.toISOString() : value);
  if (clean.length > MAX_CELL_TEXT_LENGTH) {
    const error = new Error(`工作表${sheetName}的${columnName(columnIndex)}${rowIndex + 1}超过${MAX_CELL_TEXT_LENGTH}个UTF-16代码单元`);
    error.code = "XLSX_CELL_TEXT_TOO_LONG";
    error.details = { sheet: sheetName, cell: `${columnName(columnIndex)}${rowIndex + 1}`, length: clean.length };
    throw error;
  }
  return clean;
}

function worksheetXml(sheet) {
  const rows = sheet.rows || [];
  const widths = sheet.columnWidths || [];
  const cols = widths.length ? `<cols>${widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${Math.max(8, Math.min(40, Number(width) || 14))}" customWidth="1"/>`).join("")}</cols>` : "";
  const body = rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((raw, columnIndex) => {
    const value = safeCellValue(raw, sheet.name, rowIndex, columnIndex);
    const ref = `${columnName(columnIndex)}${rowIndex + 1}`;
    if (typeof value === "number") return `<c r="${ref}"${rowIndex === 0 ? ' s="1"' : ""}><v>${value}</v></c>`;
    return `<c r="${ref}" t="inlineStr"${rowIndex === 0 ? ' s="1"' : ""}><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
  }).join("")}</row>`).join("");
  const lastColumn = columnName(Math.max(0, (rows[0] || []).length - 1));
  const filter = sheet.autoFilter === false || !(rows[0] || []).length ? "" : `<autoFilter ref="A1:${lastColumn}${Math.max(1, rows.length)}"/>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols}<sheetData>${body}</sheetData>${filter}</worksheet>`;
}

function safeSheetName(value, fallback) {
  return sanitizeCellText(value).replace(/[\\/?*\[\]:]/g, " ").trim().slice(0, 31) || fallback;
}

function createWorkbook(sheets) {
  const used = new Set();
  const normalized = sheets.map((sheet, index) => {
    const base = safeSheetName(sheet.name, `Sheet${index + 1}`);
    let name = base;
    let suffix = 2;
    while (used.has(name)) { const tail = `_${suffix++}`; name = `${base.slice(0, 31 - tail.length)}${tail}`; }
    used.add(name);
    const state = ["hidden", "veryHidden"].includes(sheet.state) ? sheet.state : sheet.hidden ? "hidden" : "visible";
    return { ...sheet, state, name, rows: Array.isArray(sheet.rows) ? sheet.rows : [] };
  });
  const overrides = normalized.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("");
  const sheetTags = normalized.map((sheet, i) => `<sheet name="${xmlEscape(sheet.name)}" sheetId="${i + 1}"${sheet.state !== "visible" ? ` state="${sheet.state}"` : ""} r:id="rId${i + 1}"/>`).join("");
  const rels = normalized.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("");
  const files = [
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${overrides}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${sheetTags}</sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}<Relationship Id="rId${normalized.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", data: `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Microsoft YaHei"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Microsoft YaHei"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2563EB"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf xfId="0" fontId="0" fillId="0" borderId="0"/><xf xfId="0" fontId="1" fillId="2" borderId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf></cellXfs></styleSheet>` },
  ];
  normalized.forEach((sheet, index) => files.push({ name: `xl/worksheets/sheet${index + 1}.xml`, data: worksheetXml(sheet) }));
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
function relationshipTarget(target) { const value = String(target || "").replaceAll("\\", "/"); return value.startsWith("/") ? value.slice(1) : `xl/${value.replace(/^\.\//, "")}`; }

function sharedStrings(entries) {
  const xml = entries.get("xl/sharedStrings.xml")?.toString("utf8");
  if (!xml) return [];
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(([, item]) => [...item.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((match) => xmlDecode(match[1])).join(""));
}

function parseWorkbook(buffer) {
  const entries = readZip(buffer);
  const workbook = entries.get("xl/workbook.xml")?.toString("utf8");
  const relationships = entries.get("xl/_rels/workbook.xml.rels")?.toString("utf8");
  if (!workbook || !relationships) throw new Error("XLSX_WORKBOOK_INVALID");
  const rels = new Map([...relationships.matchAll(/<Relationship\b([^>]*)\/?\>/g)].map(([, tag]) => [attr(tag, "Id"), relationshipTarget(attr(tag, "Target"))]));
  const strings = sharedStrings(entries);
  const sheets = [];
  for (const [, tag] of workbook.matchAll(/<sheet\b([^>]*)\/?\>/g)) {
    const name = attr(tag, "name"); const xml = entries.get(rels.get(attr(tag, "r:id")))?.toString("utf8");
    if (!xml) throw new Error(`XLSX_SHEET_MISSING:${name}`);
    const rows = [];
    for (const rowMatch of xml.matchAll(/<row\b[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
      const rowNumber = Number(rowMatch[1]); const rowXml = rowMatch[2]; const values = [];
      for (const [, cellTag, cellXml] of rowXml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
        const index = columnIndex(attr(cellTag, "r")); const type = attr(cellTag, "t");
        if (/<f\b/i.test(cellXml)) { const error = new Error(`XLSX_FORMULA_FORBIDDEN:${name}:${attr(cellTag, "r")}`); error.code = "XLSX_FORMULA_FORBIDDEN"; throw error; }
        const inline = [...cellXml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((match) => xmlDecode(match[1])).join("");
        const raw = xmlDecode(cellXml.match(/<v>([\s\S]*?)<\/v>/)?.[1] || "");
        if (type === "inlineStr" || type === "str") values[index] = inline || raw;
        else if (type === "s") {
          const sharedIndex = Number(raw);
          if (!Number.isInteger(sharedIndex) || sharedIndex < 0 || sharedIndex >= strings.length) { const error = new Error("XLSX_SHARED_STRING_INDEX_INVALID"); error.code = "XLSX_SHARED_STRING_INDEX_INVALID"; throw error; }
          values[index] = strings[sharedIndex];
        } else if (type === "b") values[index] = raw === "1" ? 1 : 0;
        else values[index] = raw === "" ? "" : Number(raw);
      }
      while (rows.length < rowNumber - 1) rows.push([]);
      rows.push(values);
    }
    sheets.push({ name, state: attr(tag, "state") || "visible", rows, xml });
  }
  return { entries, sheets, sheetMap: new Map(sheets.map((sheet) => [sheet.name, sheet])) };
}

function assertWellFormedXml(xml, filename) {
  const stack = [];
  const source = String(xml).replace(/<\?xml[\s\S]*?\?>/g, "").replace(/<!--[\s\S]*?-->/g, "").replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
  for (const match of source.matchAll(/<([^>]+)>/g)) {
    const token = match[1].trim();
    if (!token || token.startsWith("!") || token.startsWith("?")) continue;
    if (token.startsWith("/")) {
      const name = token.slice(1).trim().split(/\s/)[0];
      if (stack.pop() !== name) { const error = new Error(`XML结构损坏：${filename}`); error.code = "XLSX_XML_INVALID"; throw error; }
    } else if (!token.endsWith("/")) stack.push(token.split(/\s/)[0]);
  }
  if (stack.length) { const error = new Error(`XML结构损坏：${filename}`); error.code = "XLSX_XML_INVALID"; throw error; }
}

function validateWorkbookStructure(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const workbook = parseWorkbook(buffer);
  let maxCellTextLength = 0;
  let cellCount = 0;
  for (const [filename, bytes] of workbook.entries) {
    if (/\.(xml|rels)$/i.test(filename)) assertWellFormedXml(bytes.toString("utf8"), filename);
    if (/vbaProject|externalLinks|macrosheets|connections\.xml/i.test(filename)) { const error = new Error("工作簿包含不允许的宏或外部链接"); error.code = "XLSX_EXTERNAL_CONTENT_FORBIDDEN"; throw error; }
    if (/\.rels$/i.test(filename) && /TargetMode="External"/i.test(bytes.toString("utf8"))) { const error = new Error("工作簿包含外部链接"); error.code = "XLSX_EXTERNAL_CONTENT_FORBIDDEN"; throw error; }
  }
  for (const sheet of workbook.sheets) for (const row of sheet.rows) for (const value of row) {
    if (typeof value !== "string") continue;
    cellCount += 1; maxCellTextLength = Math.max(maxCellTextLength, value.length);
    if (value.length > MAX_CELL_TEXT_LENGTH) { const error = new Error(`工作表${sheet.name}存在超长单元格`); error.code = "XLSX_CELL_TEXT_TOO_LONG"; throw error; }
    if (hasBrokenSurrogate(value)) { const error = new Error(`工作表${sheet.name}存在损坏Unicode`); error.code = "XLSX_UNICODE_INVALID"; throw error; }
    if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(value)) { const error = new Error(`工作表${sheet.name}存在非法控制字符`); error.code = "XLSX_CONTROL_CHARACTER_INVALID"; throw error; }
  }
  return { ok: true, workbook, xml_file_count: [...workbook.entries.keys()].filter((name) => /\.(xml|rels)$/i.test(name)).length, cell_count: cellCount, max_cell_text_length: maxCellTextLength, shared_string_count: sharedStrings(workbook.entries).length, formulas: 0, macros: 0, external_links: 0 };
}

module.exports = { MAX_CELL_TEXT_LENGTH, createWorkbook, parseWorkbook, readZip, zipStore, sanitizeCellText, hasBrokenSurrogate, validateWorkbookStructure };
