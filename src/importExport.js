import { addTopic, createDocument, normalizeDocument, updateTopic } from "./model.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function serializeMk4(doc) {
  const bytes = encoder.encode(JSON.stringify(doc, null, 2));
  if (!("CompressionStream" in window)) return new Blob([bytes], { type: "application/json" });
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(stream).blob();
}

export async function parseMk4(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const isGzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
  let text;
  if (isGzip && "DecompressionStream" in window) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    text = await new Response(stream).text();
  } else {
    text = decoder.decode(bytes);
  }
  return normalizeDocument(JSON.parse(text));
}

export async function importAny(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".mk4map") || name.endsWith(".json")) return parseMk4(file);
  const textTypes = [".md", ".txt", ".csv", ".opml", ".xml", ".mm"];
  if (textTypes.some((ext) => name.endsWith(ext))) {
    const text = await file.text();
    if (name.endsWith(".md")) return importMarkdown(text);
    if (name.endsWith(".csv")) return importCsv(text);
    if (name.endsWith(".opml")) return importOpml(text);
    if (name.endsWith(".mm")) return importFreemind(text);
    if (name.endsWith(".xml")) return importSimpleXml(text);
    return importIndentedText(text);
  }
  if (name.endsWith(".xmind")) return importXMind(file);
  throw new Error(`Unsupported file type: ${file.name}`);
}

export function exportMarkdown(doc) {
  return walkLines(doc, ({ topic, depth }) => `${"#".repeat(Math.min(depth + 1, 6))} ${topic.title}${topic.notes ? `\n\n${topic.notes}` : ""}`).join("\n\n");
}

export function exportIndentedText(doc) {
  return walkLines(doc, ({ topic, depth }) => `${"  ".repeat(depth)}- ${topic.title}`).join("\n");
}

export function exportCsv(doc) {
  const rows = [["id", "parentId", "depth", "title", "notes", "labels", "tags"]];
  walkLines(doc, ({ topic, depth }) => {
    rows.push([
      topic.id,
      topic.parentId || "",
      depth,
      topic.title,
      topic.notes || "",
      topic.labels.join("|"),
      topic.tags.join("|")
    ]);
  });
  return rows.map((row) => row.map(csvEscape).join(",")).join("\n");
}

export function exportOpml(doc) {
  const root = doc.topics[doc.rootId];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n<head><title>${xml(root.title)}</title></head>\n<body>\n${opmlNode(doc, doc.rootId, 1)}\n</body>\n</opml>`;
}

export function exportFreemind(doc) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<map version="1.0.1">\n${freemindNode(doc, doc.rootId, 1)}\n</map>`;
}

export function exportSimpleXml(doc) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<mk4map title="${xml(doc.metadata.title || "Untitled")}">\n${simpleXmlNode(doc, doc.rootId, 1)}\n</mk4map>`;
}

export function exportHtml(doc) {
  const markdown = exportMarkdown(doc)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/^# (.*)$/gm, "<h1>$1</h1>")
    .replace(/^## (.*)$/gm, "<h2>$1</h2>")
    .replace(/^### (.*)$/gm, "<h3>$1</h3>")
    .replace(/\n\n/g, "\n");
  return `<!doctype html><meta charset="utf-8"><title>${xml(doc.metadata.title || "MK4 Mind Map")}</title><style>body{font-family:Segoe UI,sans-serif;max-width:900px;margin:40px auto;line-height:1.55;color:#0f172a}</style>${markdown}`;
}

export async function exportXMind(doc) {
  const sheet = {
    id: "sheet-1",
    class: "sheet",
    title: doc.metadata.title || doc.topics[doc.rootId].title,
    rootTopic: topicToXMind(doc, doc.rootId),
    topicPositioning: "fixed"
  };
  const files = [
    { name: "content.json", data: encoder.encode(JSON.stringify([sheet], null, 2)) },
    { name: "metadata.json", data: encoder.encode(JSON.stringify({ creator: { name: "MK4 MindMapper", version: "0.1.0" } }, null, 2)) },
    { name: "manifest.json", data: encoder.encode(JSON.stringify({ "file-entries": { "content.json": {}, "metadata.json": {} } }, null, 2)) }
  ];
  return new Blob([createZip(files)], { type: "application/xmind" });
}

export async function importXMind(file) {
  const entries = await readZip(await file.arrayBuffer());
  const content = entries.get("content.json");
  if (content) {
    const sheets = JSON.parse(decoder.decode(content));
    const rootTopic = sheets[0]?.rootTopic;
    if (!rootTopic) throw new Error("XMind content.json does not contain a root topic.");
    return xmindTopicToDoc(rootTopic, sheets[0]?.title || "Imported XMind");
  }
  const contentXml = entries.get("content.xml");
  if (contentXml) return importSimpleXml(decoder.decode(contentXml));
  throw new Error("Only modern XMind packages with content.json, or XML packages with content.xml, are supported.");
}

export function importMarkdown(text) {
  const doc = createDocument();
  clearToRoot(doc, "Imported Markdown");
  const stack = [{ level: 0, id: doc.rootId }];
  text.split(/\r?\n/).forEach((line) => {
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (!heading) return;
    const level = heading[1].length;
    const title = heading[2].trim();
    if (level === 1) {
      updateTopic(doc, doc.rootId, { title });
      stack.length = 1;
      stack[0] = { level, id: doc.rootId };
      return;
    }
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    const parentId = stack[stack.length - 1]?.id || doc.rootId;
    const topic = addTopic(doc, parentId, title);
    stack.push({ level, id: topic.id });
  });
  return doc;
}

export function importIndentedText(text) {
  const doc = createDocument();
  clearToRoot(doc, "Imported Text");
  const stack = [{ depth: -1, id: doc.rootId }];
  text.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    const depth = Math.floor((line.match(/^\s*/)[0].replace(/\t/g, "  ").length) / 2);
    const title = line.replace(/^\s*[-*]?\s*/, "").trim();
    if (index === 0 && depth === 0) {
      updateTopic(doc, doc.rootId, { title });
      stack.length = 1;
      stack[0] = { depth, id: doc.rootId };
      return;
    }
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    const topic = addTopic(doc, stack[stack.length - 1]?.id || doc.rootId, title);
    stack.push({ depth, id: topic.id });
  });
  return doc;
}

export function importCsv(text) {
  const doc = createDocument();
  clearToRoot(doc, "Imported CSV");
  const rows = parseCsv(text);
  const map = new Map([["", doc.rootId]]);
  rows.slice(1).forEach((row) => {
    const [id, parentId, , title, notes = "", labels = "", tags = ""] = row;
    const topic = addTopic(doc, map.get(parentId) || doc.rootId, title || "Untitled");
    topic.notes = notes;
    topic.labels = labels ? labels.split("|") : [];
    topic.tags = tags ? tags.split("|") : [];
    map.set(id, topic.id);
  });
  return doc;
}

export function importOpml(text) {
  const doc = createDocument();
  const xmlDoc = new DOMParser().parseFromString(text, "text/xml");
  const first = xmlDoc.querySelector("body > outline");
  clearToRoot(doc, first?.getAttribute("text") || "Imported OPML");
  if (!first) return doc;
  importOutlineChildren(doc, doc.rootId, first.children);
  return doc;
}

export function importFreemind(text) {
  const doc = createDocument();
  const xmlDoc = new DOMParser().parseFromString(text, "text/xml");
  const first = xmlDoc.querySelector("map > node");
  clearToRoot(doc, first?.getAttribute("TEXT") || "Imported FreeMind");
  if (!first) return doc;
  importNodeChildren(doc, doc.rootId, first.children);
  return doc;
}

export function importSimpleXml(text) {
  const xmlDoc = new DOMParser().parseFromString(text, "text/xml");
  const first =
    xmlDoc.querySelector("topic") ||
    xmlDoc.querySelector("node") ||
    xmlDoc.querySelector("outline");
  if (!first) throw new Error("No topic-like nodes found in XML.");
  const doc = createDocument();
  clearToRoot(doc, first.getAttribute("title") || first.getAttribute("TEXT") || first.getAttribute("text") || "Imported XML");
  importGenericChildren(doc, doc.rootId, first.children);
  return doc;
}

function clearToRoot(doc, title) {
  const root = doc.topics[doc.rootId];
  root.title = title;
  root.children = [];
  root.notes = "";
  Object.keys(doc.topics).forEach((id) => {
    if (id !== doc.rootId) delete doc.topics[id];
  });
  doc.relationships = [];
  doc.boundaries = [];
  doc.summaries = [];
}

function walkLines(doc, mapper) {
  const result = [];
  const visit = (id, depth) => {
    const topic = doc.topics[id];
    if (!topic) return;
    result.push(mapper({ topic, depth }));
    topic.children.forEach((childId) => visit(childId, depth + 1));
  };
  visit(doc.rootId, 0);
  return result;
}

function opmlNode(doc, id, depth) {
  const topic = doc.topics[id];
  const children = topic.children.map((childId) => opmlNode(doc, childId, depth + 1)).join("\n");
  const pad = "  ".repeat(depth);
  return children
    ? `${pad}<outline text="${xml(topic.title)}">\n${children}\n${pad}</outline>`
    : `${pad}<outline text="${xml(topic.title)}" />`;
}

function freemindNode(doc, id, depth) {
  const topic = doc.topics[id];
  const children = topic.children.map((childId) => freemindNode(doc, childId, depth + 1)).join("\n");
  const pad = "  ".repeat(depth);
  return children
    ? `${pad}<node TEXT="${xml(topic.title)}">\n${children}\n${pad}</node>`
    : `${pad}<node TEXT="${xml(topic.title)}" />`;
}

function simpleXmlNode(doc, id, depth) {
  const topic = doc.topics[id];
  const children = topic.children.map((childId) => simpleXmlNode(doc, childId, depth + 1)).join("\n");
  const pad = "  ".repeat(depth);
  return children
    ? `${pad}<topic title="${xml(topic.title)}">\n${children}\n${pad}</topic>`
    : `${pad}<topic title="${xml(topic.title)}" />`;
}

function topicToXMind(doc, id) {
  const topic = doc.topics[id];
  const node = {
    id: topic.id,
    class: "topic",
    title: topic.title
  };
  if (topic.notes) node.notes = { plain: { content: topic.notes } };
  if (topic.hyperlinks?.[0]) node.href = topic.hyperlinks[0];
  if (topic.children.length) {
    node.children = { attached: topic.children.map((childId) => topicToXMind(doc, childId)) };
  }
  if (topic.labels.length) node.labels = topic.labels;
  return node;
}

function xmindTopicToDoc(rootTopic, title) {
  const doc = createDocument();
  clearToRoot(doc, rootTopic.title || title || "Imported XMind");
  doc.metadata.title = title || rootTopic.title || "Imported XMind";
  const importChildren = (parentId, xTopic) => {
    const children = xTopic.children?.attached || [];
    children.forEach((child) => {
      const topic = addTopic(doc, parentId, child.title || "Untitled");
      topic.notes = child.notes?.plain?.content || "";
      topic.labels = child.labels || [];
      if (child.href) topic.hyperlinks = [child.href];
      importChildren(topic.id, child);
    });
  };
  importChildren(doc.rootId, rootTopic);
  return doc;
}

function importOutlineChildren(doc, parentId, nodes) {
  [...nodes].forEach((node) => {
    if (node.tagName !== "outline") return;
    const topic = addTopic(doc, parentId, node.getAttribute("text") || node.getAttribute("title") || "Untitled");
    importOutlineChildren(doc, topic.id, node.children);
  });
}

function importNodeChildren(doc, parentId, nodes) {
  [...nodes].forEach((node) => {
    if (node.tagName !== "node") return;
    const topic = addTopic(doc, parentId, node.getAttribute("TEXT") || node.getAttribute("text") || "Untitled");
    importNodeChildren(doc, topic.id, node.children);
  });
}

function importGenericChildren(doc, parentId, nodes) {
  [...nodes].forEach((node) => {
    if (!["topic", "node", "outline"].includes(node.tagName)) return;
    const topic = addTopic(doc, parentId, node.getAttribute("title") || node.getAttribute("TEXT") || node.getAttribute("text") || "Untitled");
    importGenericChildren(doc, topic.id, node.children);
  });
}

function xml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") cell += char;
  }
  row.push(cell);
  rows.push(row);
  return rows.filter((item) => item.some(Boolean));
}

function createZip(entries) {
  const fileParts = [];
  const centralParts = [];
  let offset = 0;
  entries.forEach((entry) => {
    const nameBytes = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, 0, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, entry.data.length, true);
    lv.setUint32(22, entry.data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    fileParts.push(local, entry.data);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, entry.data.length, true);
    cv.setUint32(24, entry.data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centralParts.push(central);
    offset += local.length + entry.data.length;
  });

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  return concatBytes([...fileParts, ...centralParts, end]);
}

async function readZip(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 66000); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Invalid ZIP/XMind file.");
  const count = view.getUint16(eocd + 10, true);
  let ptr = view.getUint32(eocd + 16, true);
  const entries = new Map();
  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(ptr, true) !== 0x02014b50) throw new Error("Invalid ZIP central directory.");
    const method = view.getUint16(ptr + 10, true);
    const compressedSize = view.getUint32(ptr + 20, true);
    const uncompressedSize = view.getUint32(ptr + 24, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localOffset = view.getUint32(ptr + 42, true);
    const name = decoder.decode(bytes.slice(ptr + 46, ptr + 46 + nameLen));
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const compressed = bytes.slice(dataStart, dataStart + compressedSize);
    let data;
    if (method === 0) data = compressed;
    else if (method === 8 && "DecompressionStream" in window) {
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      data = new Uint8Array(await new Response(stream).arrayBuffer());
      if (uncompressedSize && data.length !== uncompressedSize) throw new Error(`ZIP entry size mismatch for ${name}.`);
    } else {
      throw new Error(`ZIP compression method ${method} is not supported by this browser.`);
    }
    entries.set(name, data);
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function concatBytes(parts) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  parts.forEach((part) => {
    out.set(part, offset);
    offset += part.length;
  });
  return out;
}

let crcTable;
function crc32(bytes) {
  if (!crcTable) {
    crcTable = Array.from({ length: 256 }, (_, n) => {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      return c >>> 0;
    });
  }
  let crc = 0xffffffff;
  bytes.forEach((byte) => {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  });
  return (crc ^ 0xffffffff) >>> 0;
}
