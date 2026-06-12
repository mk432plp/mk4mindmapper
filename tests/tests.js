import { addTopic, createDocument, duplicateBranch, normalizeDocument, removeTopic } from "../src/model.js";
import { computeLayout } from "../src/layout.js";
import { exportCsv, exportMarkdown, exportXMind, importXMind, parseMk4, serializeMk4 } from "../src/importExport.js";

const results = document.getElementById("results");
const summary = document.getElementById("summary");
let failed = 0;

async function test(name, fn) {
  const item = document.createElement("li");
  try {
    await fn();
    item.className = "pass";
    item.textContent = `PASS ${name}`;
  } catch (error) {
    failed += 1;
    item.className = "fail";
    item.textContent = `FAIL ${name}: ${error.message}`;
  }
  results.append(item);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

await test("creates and normalizes MK4 documents", () => {
  const doc = createDocument();
  assert(doc.format === "mk4map", "format marker missing");
  assert(Object.keys(doc.topics).length >= 9, "sample map should contain seeded topics");
  normalizeDocument(doc);
  assert(doc.topics[doc.rootId].style, "root style missing");
});

await test("adds, duplicates, and removes branches", () => {
  const doc = createDocument();
  const child = addTopic(doc, doc.rootId, "Test Branch");
  const grand = addTopic(doc, child.id, "Nested");
  const copy = duplicateBranch(doc, child.id);
  assert(copy && doc.topics[copy.id].children.length === 1, "duplicate branch did not keep descendants");
  removeTopic(doc, child.id);
  assert(!doc.topics[child.id] && !doc.topics[grand.id], "remove should delete subtree");
});

await test("computes stable layout coordinates", () => {
  const doc = createDocument();
  const layout = computeLayout(doc);
  assert(layout.get(doc.rootId).x === 0, "root should be centered");
  assert([...layout.values()].every((item) => Number.isFinite(item.x) && Number.isFinite(item.y)), "layout coordinates must be finite");
});

await test("exports common text formats", () => {
  const doc = createDocument();
  assert(exportMarkdown(doc).includes("# Root Idea"), "markdown root missing");
  assert(exportCsv(doc).includes("parentId"), "csv header missing");
});

await test("round-trips compressed MK4 map", async () => {
  const doc = createDocument();
  const blob = await serializeMk4(doc);
  const file = new File([blob], "roundtrip.mk4map");
  const loaded = await parseMk4(file);
  assert(loaded.rootId && loaded.topics[loaded.rootId].title === "Root Idea", "round-trip root mismatch");
});

await test("exports and imports modern XMind content.json package", async () => {
  const doc = createDocument();
  const blob = await exportXMind(doc);
  const loaded = await importXMind(new File([blob], "roundtrip.xmind"));
  assert(loaded.topics[loaded.rootId].title === "Root Idea", "xmind root mismatch");
  assert(Object.keys(loaded.topics).length >= 3, "xmind children missing");
});

summary.textContent = failed ? `${failed} test(s) failed.` : "All browser module tests passed.";
if (failed) throw new Error(summary.textContent);
