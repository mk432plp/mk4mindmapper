export const DEFAULT_STYLE = {
  fill: "#ffffff",
  color: "#0f172a",
  border: "#7dd3fc",
  fontSize: 16,
  bold: true,
  italic: false,
  shape: "rounded",
  opacity: 1,
  branch: "curved"
};

export function uid(prefix = "t") {
  const random = Math.random().toString(36).slice(2, 9);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

export function createTopic(title, parentId = null, overrides = {}) {
  const id = overrides.id || uid();
  return {
    id,
    parentId,
    title,
    type: overrides.type || (parentId ? "topic" : "root"),
    children: overrides.children ? [...overrides.children] : [],
    notes: overrides.notes || "",
    labels: overrides.labels ? [...overrides.labels] : [],
    tags: overrides.tags ? [...overrides.tags] : [],
    markers: overrides.markers ? [...overrides.markers] : [],
    hyperlinks: overrides.hyperlinks ? [...overrides.hyperlinks] : [],
    images: overrides.images ? [...overrides.images] : [],
    attachments: overrides.attachments ? [...overrides.attachments] : [],
    collapsed: Boolean(overrides.collapsed),
    manual: Boolean(overrides.manual),
    x: overrides.x ?? 0,
    y: overrides.y ?? 0,
    width: overrides.width ?? 170,
    height: overrides.height ?? 52,
    style: { ...DEFAULT_STYLE, ...(overrides.style || {}) }
  };
}

export function createDocument() {
  const root = createTopic("Root Idea");
  const doc = {
    format: "mk4map",
    version: 1,
    metadata: {
      title: "Untitled Mind Map",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      app: "MK4 MindMapper"
    },
    preferences: {
      layout: "balanced",
      theme: "light",
      autosaveIntervalMs: 10000
    },
    themes: {},
    styles: {},
    topics: { [root.id]: root },
    rootId: root.id,
    relationships: [],
    boundaries: [],
    summaries: [],
    resources: [],
    plugins: []
  };

  const research = addTopic(doc, root.id, "Research", { style: { fill: "#ecfeff", border: "#06b6d4" } });
  addTopic(doc, research.id, "Import XMind files", { labels: ["compatibility"] });
  addTopic(doc, research.id, "Large-map benchmarks", { tags: ["performance"] });
  const plan = addTopic(doc, root.id, "Plan", { style: { fill: "#eff6ff", border: "#3b82f6" } });
  addTopic(doc, plan.id, "Layouts and themes");
  addTopic(doc, plan.id, "Installer and README");
  const build = addTopic(doc, root.id, "Build", { style: { fill: "#f0fdf4", border: "#22c55e" } });
  addTopic(doc, build.id, "Canvas rendering");
  addTopic(doc, build.id, "Import/export engine");
  const review = addTopic(doc, root.id, "Review", { style: { fill: "#fff7ed", border: "#fb923c" } });
  addTopic(doc, review.id, "Automated tests");
  addTopic(doc, review.id, "Browser QA");
  doc.boundaries.push({ id: uid("b"), topicId: plan.id, title: "Milestone", padding: 26, color: "#3b82f6" });
  doc.summaries.push({ id: uid("s"), topicId: build.id, title: "Implementation", color: "#0f766e" });
  doc.relationships.push({ id: uid("r"), from: research.id, to: build.id, label: "feeds", color: "#ef4444" });
  return doc;
}

export function touch(doc) {
  doc.metadata.updatedAt = new Date().toISOString();
}

export function getTopic(doc, id) {
  return doc.topics[id] || null;
}

export function listTopics(doc, rootId = doc.rootId, includeCollapsed = true) {
  const result = [];
  const visit = (id, depth = 0) => {
    const topic = doc.topics[id];
    if (!topic) return;
    result.push({ topic, depth });
    if (!includeCollapsed && topic.collapsed) return;
    topic.children.forEach((childId) => visit(childId, depth + 1));
  };
  visit(rootId);
  return result;
}

export function addTopic(doc, parentId, title = "New Topic", overrides = {}) {
  const parent = doc.topics[parentId];
  if (!parent) throw new Error(`Parent topic not found: ${parentId}`);
  const topic = createTopic(title, parentId, overrides);
  doc.topics[topic.id] = topic;
  parent.children.push(topic.id);
  touch(doc);
  return topic;
}

export function addSibling(doc, topicId, title = "New Topic") {
  const topic = doc.topics[topicId];
  if (!topic || !topic.parentId) return addTopic(doc, doc.rootId, title);
  const sibling = createTopic(title, topic.parentId);
  doc.topics[sibling.id] = sibling;
  const siblings = doc.topics[topic.parentId].children;
  siblings.splice(siblings.indexOf(topicId) + 1, 0, sibling.id);
  touch(doc);
  return sibling;
}

export function removeTopic(doc, topicId) {
  if (topicId === doc.rootId) return false;
  const topic = doc.topics[topicId];
  if (!topic) return false;
  const parent = doc.topics[topic.parentId];
  if (parent) parent.children = parent.children.filter((id) => id !== topicId);
  const removeIds = [];
  const collect = (id) => {
    removeIds.push(id);
    (doc.topics[id]?.children || []).forEach(collect);
  };
  collect(topicId);
  removeIds.forEach((id) => delete doc.topics[id]);
  doc.relationships = doc.relationships.filter((rel) => !removeIds.includes(rel.from) && !removeIds.includes(rel.to));
  doc.boundaries = doc.boundaries.filter((boundary) => !removeIds.includes(boundary.topicId));
  doc.summaries = doc.summaries.filter((summary) => !removeIds.includes(summary.topicId));
  touch(doc);
  return true;
}

export function moveTopic(doc, topicId, newParentId) {
  if (topicId === doc.rootId || topicId === newParentId) return false;
  const topic = doc.topics[topicId];
  const newParent = doc.topics[newParentId];
  if (!topic || !newParent) return false;
  let cursor = newParent;
  while (cursor) {
    if (cursor.id === topicId) return false;
    cursor = cursor.parentId ? doc.topics[cursor.parentId] : null;
  }
  const oldParent = doc.topics[topic.parentId];
  if (oldParent) oldParent.children = oldParent.children.filter((id) => id !== topicId);
  topic.parentId = newParentId;
  newParent.children.push(topicId);
  touch(doc);
  return true;
}

export function promoteTopic(doc, topicId) {
  const topic = doc.topics[topicId];
  if (!topic?.parentId) return false;
  const parent = doc.topics[topic.parentId];
  if (!parent?.parentId) return false;
  const grandParent = doc.topics[parent.parentId];
  parent.children = parent.children.filter((id) => id !== topicId);
  topic.parentId = grandParent.id;
  const insertAt = grandParent.children.indexOf(parent.id) + 1;
  grandParent.children.splice(insertAt, 0, topic.id);
  touch(doc);
  return true;
}

export function updateTopic(doc, topicId, patch) {
  const topic = doc.topics[topicId];
  if (!topic) return null;
  if (patch.style) {
    topic.style = { ...topic.style, ...patch.style };
  }
  Object.entries(patch).forEach(([key, value]) => {
    if (key !== "style") topic[key] = value;
  });
  touch(doc);
  return topic;
}

export function duplicateBranch(doc, topicId) {
  const source = doc.topics[topicId];
  if (!source) return null;
  const cloneRecursive = (id, parentId) => {
    const original = doc.topics[id];
    const clone = structuredClone(original);
    clone.id = uid();
    clone.parentId = parentId;
    clone.title = `${original.title} Copy`;
    clone.children = [];
    doc.topics[clone.id] = clone;
    original.children.forEach((childId) => {
      const child = cloneRecursive(childId, clone.id);
      clone.children.push(child.id);
    });
    return clone;
  };
  const clone = cloneRecursive(topicId, source.parentId);
  doc.topics[source.parentId].children.splice(doc.topics[source.parentId].children.indexOf(topicId) + 1, 0, clone.id);
  touch(doc);
  return clone;
}

export function normalizeDocument(raw) {
  if (!raw || typeof raw !== "object") throw new Error("Invalid map file.");
  if (!raw.topics || !raw.rootId) {
    throw new Error("Map file does not contain MK4 topics.");
  }
  Object.values(raw.topics).forEach((topic) => {
    topic.children ||= [];
    topic.labels ||= [];
    topic.tags ||= [];
    topic.markers ||= [];
    topic.hyperlinks ||= [];
    topic.images ||= [];
    topic.attachments ||= [];
    topic.style = { ...DEFAULT_STYLE, ...(topic.style || {}) };
  });
  raw.relationships ||= [];
  raw.boundaries ||= [];
  raw.summaries ||= [];
  raw.resources ||= [];
  raw.preferences ||= { layout: "balanced", theme: "light" };
  raw.metadata ||= {};
  raw.metadata.updatedAt = new Date().toISOString();
  return raw;
}
