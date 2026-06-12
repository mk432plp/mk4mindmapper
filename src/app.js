import {
  addSibling,
  addTopic,
  createDocument,
  duplicateBranch,
  listTopics,
  moveTopic,
  promoteTopic,
  removeTopic,
  updateTopic
} from "./model.js";
import { HistoryStack } from "./history.js";
import { branchPath, computeLayout, getBounds, visibleTopicIds } from "./layout.js";
import {
  downloadBlob,
  exportCsv,
  exportFreemind,
  exportHtml,
  exportIndentedText,
  exportMarkdown,
  exportOpml,
  exportSimpleXml,
  exportXMind,
  importAny,
  serializeMk4
} from "./importExport.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const AUTOSAVE_KEY = "mk4mindmapper.autosave";

class MK4MindMapperApp {
  constructor() {
    this.doc = createDocument();
    this.history = new HistoryStack();
    this.selection = this.doc.rootId;
    this.clipboard = null;
    this.relationshipSource = null;
    this.scale = 1;
    this.pan = { x: 0, y: 0 };
    this.drag = null;
    this.search = "";
    this.layout = computeLayout(this.doc);
    this.$ = (id) => document.getElementById(id);
    this.canvas = this.$("canvas");
    this.viewport = this.$("mapViewport");
    this.bind();
    this.installPluginApi();
    this.checkRecovery();
    this.render();
    this.fit();
    this.autosaveTimer = setInterval(() => this.autosave(), this.doc.preferences.autosaveIntervalMs);
    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
      navigator.serviceWorker.register("./service-worker.js").catch(() => {});
    }
  }

  bind() {
    // ... [KEEP ALL EXISTING BINDINGS UP TO zoomRange] ...
    
    // Replace the old [data-menu] binding with this:
    document.querySelectorAll("[data-menu]").forEach((button) => {
      button.addEventListener("click", (e) => {
        e.stopPropagation();
        this.toggleMenu(button.dataset.menu);
      });
    });

    // Bind dropdown and context menu actions
    document.querySelectorAll(".dropdown-menu button, .context-menu button").forEach((button) => {
      button.addEventListener("click", (e) => {
        e.stopPropagation();
        this.handleMenuAction(button.dataset.action);
        this.closeAllMenus();
      });
    });

    // Close menus on outside click
    document.addEventListener("click", () => this.closeAllMenus());

    // Context Menu Binding
    this.canvas.addEventListener("contextmenu", (e) => this.showContextMenu(e));

    // Keep existing inline editor bindings
    this.$("inlineEditorInput").addEventListener("keydown", (event) => {
      if (event.key === "Enter") this.commitInlineEdit();
      if (event.key === "Escape") this.hideInlineEdit();
    });
    this.$("inlineEditorInput").addEventListener("blur", () => this.commitInlineEdit());
  }

  // --- NEW MENU LOGIC ---

  toggleMenu(menuName) {
    this.closeAllMenus();
    const menu = this.$(`${menuName}Menu`);
    if (menu) menu.hidden = false;
  }

  closeAllMenus() {
    document.querySelectorAll(".dropdown-menu, .context-menu").forEach(menu => {
      menu.hidden = true;
    });
  }

  showContextMenu(event) {
    event.preventDefault();
    const node = event.target.closest?.(".topic-node");
    
    // Only show context menu if clicking on a topic
    if (node) {
      this.select(node.dataset.topicId);
      const menu = this.$("contextMenu");
      menu.hidden = false;
      
      // Position menu at cursor
      let x = event.clientX;
      let y = event.clientY;
      
      // Keep menu within viewport
      if (x + menu.offsetWidth > window.innerWidth) x -= menu.offsetWidth;
      if (y + menu.offsetHeight > window.innerHeight) y -= menu.offsetHeight;
      
      menu.style.left = `${x}px`;
      menu.style.top = `${y}px`;
    }
  }

  handleMenuAction(action) {
    // Map standard actions
    switch(action) {
      case "new": this.newDocument(); break;
      case "open": this.$("fileInput").click(); break;
      case "save": this.saveMk4(); break;
      
      case "undo": this.undo(); break;
      case "redo": this.redo(); break;
      case "duplicate": this.withHistory(() => this.select(duplicateBranch(this.doc, this.selection).id)); break;
      case "delete": this.deleteSelected(); break;
      case "edit": this.showInlineEditor(this.selection); break;
      
      case "fit": this.fit(); break;
      case "theme": this.toggleTheme(); break;
      case "focus": document.body.classList.toggle("focus-mode"); break;
      
      case "child": this.withHistory(() => this.select(addTopic(this.doc, this.selection).id)); break;
      case "sibling": this.withHistory(() => this.select(addSibling(this.doc, this.selection).id)); break;
      case "floating": this.$("floatingBtn").click(); break;
      case "relationship": this.$("relationshipBtn").click(); break;
      case "boundary": this.$("boundaryBtn").click(); break;
      case "summary": this.$("summaryBtn").click(); break;
      case "image": this.$("imageInput").click(); break;
    }

    // Map export actions
    if (action.startsWith("export-")) {
      const format = action.split("-")[1];
      this.exportFormat(format);
    }
  }

  // NOTE: You can safely delete the old async menu(name) { ... } method as it is no longer used.

  withHistory(mutator) {
    this.history.snapshot(this.doc);
    mutator();
    this.layout = computeLayout(this.doc);
    this.render();
    this.autosave();
  }

  render() {
    this.layout = computeLayout(this.doc);
    this.renderCanvas();
    this.renderTree();
    this.renderInspector();
    this.renderMinimap();
    this.$("zoomText").textContent = `${Math.round(this.scale * 100)}%`;
    this.$("zoomRange").value = Math.round(this.scale * 100);
    this.$("selectionText").textContent = this.doc.topics[this.selection]?.title || "No selection";
  }

  renderCanvas(renderAll = false) {
    const rect = this.canvas.getBoundingClientRect();
    const viewport = {
      x: -this.pan.x / this.scale,
      y: -this.pan.y / this.scale,
      width: rect.width / this.scale,
      height: rect.height / this.scale
    };
    const visible = renderAll ? new Set(this.layout.keys()) : visibleTopicIds(this.layout, viewport);
    this.viewport.setAttribute("transform", `translate(${this.pan.x} ${this.pan.y}) scale(${this.scale})`);
    this.viewport.replaceChildren();
    this.renderBoundaries(visible);
    this.renderBranches(visible);
    this.renderRelationships(visible);
    this.renderSummaries(visible);
    for (const id of visible) this.viewport.append(this.topicElement(id));
  }

  renderBranches(visible) {
    const group = svg("g", { class: "branches" });
    Object.values(this.doc.topics).forEach((topic) => {
      const to = this.layout.get(topic.id);
      const parent = topic.parentId ? this.layout.get(topic.parentId) : null;
      if (!to || !parent || !visible.has(topic.id) || !visible.has(topic.parentId)) return;
      group.append(svg("path", {
        class: "branch-line",
        d: branchPath(parent, to, topic.style.branch)
      }));
    });
    this.viewport.append(group);
  }

  renderBoundaries(visible) {
    const group = svg("g", { class: "boundaries" });
    this.doc.boundaries.forEach((boundary) => {
      const ids = subtreeIds(this.doc, boundary.topicId).filter((id) => visible.has(id));
      if (!ids.length) return;
      const boxes = ids.map((id) => this.layout.get(id)).filter(Boolean);
      const minX = Math.min(...boxes.map((box) => box.x - box.width / 2)) - boundary.padding;
      const maxX = Math.max(...boxes.map((box) => box.x + box.width / 2)) + boundary.padding;
      const minY = Math.min(...boxes.map((box) => box.y - box.height / 2)) - boundary.padding;
      const maxY = Math.max(...boxes.map((box) => box.y + box.height / 2)) + boundary.padding;
      group.append(svg("rect", {
        class: "boundary-box",
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
        rx: 26,
        style: `stroke:${boundary.color};`
      }));
      group.append(svg("text", {
        x: minX + 14,
        y: minY - 9,
        fill: boundary.color,
        "font-size": 13,
        "font-weight": 700
      }, boundary.title));
    });
    this.viewport.append(group);
  }

  renderSummaries(visible) {
    const group = svg("g", { class: "summaries" });
    this.doc.summaries.forEach((summary) => {
      const topic = this.doc.topics[summary.topicId];
      if (!topic?.children.length) return;
      const boxes = topic.children.map((id) => this.layout.get(id)).filter(Boolean).filter((box) => visible.has(box.id));
      if (!boxes.length) return;
      const side = boxes[0].side || 1;
      const x = side > 0 ? Math.max(...boxes.map((box) => box.x + box.width / 2)) + 34 : Math.min(...boxes.map((box) => box.x - box.width / 2)) - 34;
      const minY = Math.min(...boxes.map((box) => box.y - box.height / 2));
      const maxY = Math.max(...boxes.map((box) => box.y + box.height / 2));
      const q = 28 * side;
      group.append(svg("path", {
        class: "summary-brace",
        d: `M ${x} ${minY} C ${x + q} ${minY}, ${x + q} ${(minY + maxY) / 2}, ${x} ${(minY + maxY) / 2} C ${x + q} ${(minY + maxY) / 2}, ${x + q} ${maxY}, ${x} ${maxY}`,
        style: `stroke:${summary.color};`
      }));
      group.append(svg("text", {
        x: x + 34 * side,
        y: (minY + maxY) / 2,
        fill: summary.color,
        "font-size": 13,
        "font-weight": 700,
        "text-anchor": side > 0 ? "start" : "end"
      }, summary.title));
    });
    this.viewport.append(group);
  }

  renderRelationships(visible) {
    const group = svg("g", { class: "relationships" });
    this.doc.relationships.forEach((rel) => {
      const from = this.layout.get(rel.from);
      const to = this.layout.get(rel.to);
      if (!from || !to || !visible.has(rel.from) || !visible.has(rel.to)) return;
      const path = `M ${from.x} ${from.y - from.height / 2 - 12} C ${(from.x + to.x) / 2} ${from.y - 130}, ${(from.x + to.x) / 2} ${to.y - 130}, ${to.x} ${to.y - to.height / 2 - 12}`;
      group.append(svg("path", { class: "relationship-line", d: path, style: `stroke:${rel.color || "#ef4444"}; color:${rel.color || "#ef4444"};` }));
      if (rel.label) group.append(svg("text", { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - 124, fill: rel.color || "#ef4444", "font-size": 12, "font-weight": 700, "text-anchor": "middle" }, rel.label));
    });
    this.viewport.append(group);
  }

  topicElement(id) {
    const topic = this.doc.topics[id];
    const box = this.layout.get(id);
    const group = svg("g", {
      class: `topic-node${id === this.selection ? " selected" : ""}${this.isSearchHit(topic) ? " search-hit" : ""}`,
      "data-topic-id": id,
      transform: `translate(${box.x} ${box.y})`
    });
    group.append(shapeElement(topic, box));
    if (topic.images?.[0]) {
      group.append(svg("image", {
        class: "node-image",
        href: topic.images[0].dataUrl,
        x: -34,
        y: -box.height / 2 + 8,
        width: 68,
        height: 58,
        preserveAspectRatio: "xMidYMid meet"
      }));
    }
    const textY = topic.images?.[0] ? 32 : 0;
    const text = svg("text", {
      x: 0,
      y: textY,
      "text-anchor": "middle",
      fill: topic.style.color,
      "font-size": topic.style.fontSize,
      "font-weight": topic.style.bold ? 760 : 500,
      "font-style": topic.style.italic ? "italic" : "normal"
    }, ellipsize(topic.title, 28));
    group.append(text);
    const meta = [...topic.labels, ...topic.tags].slice(0, 2).join("  ");
    if (meta) group.append(svg("text", { class: "topic-label", x: 0, y: box.height / 2 - 11, "text-anchor": "middle" }, meta));
    if (topic.collapsed && topic.children.length) group.append(svg("text", { x: box.width / 2 - 16, y: 5, fill: "#64748b", "font-size": 18, "font-weight": 800 }, "+"));
    return group;
  }

  renderTree() {
    const panel = this.$("treePanel");
    panel.replaceChildren();
    listTopics(this.doc).forEach(({ topic, depth }) => {
      const row = document.createElement("div");
      row.className = `tree-node${topic.id === this.selection ? " selected" : ""}`;
      row.style.paddingLeft = `${6 + depth * 13}px`;
      row.dataset.topicId = topic.id;
      const expander = document.createElement("span");
      expander.className = "tree-expander";
      expander.textContent = topic.children.length ? (topic.collapsed ? "+" : "-") : "";
      const title = document.createElement("span");
      title.textContent = topic.title;
      row.append(expander, title);
      row.addEventListener("click", () => this.select(topic.id));
      expander.addEventListener("click", (event) => {
        event.stopPropagation();
        this.withHistory(() => updateTopic(this.doc, topic.id, { collapsed: !topic.collapsed }));
      });
      panel.append(row);
    });
  }

  renderInspector() {
    const topic = this.doc.topics[this.selection];
    if (!topic) return;
    this.$("titleInput").value = topic.title;
    this.$("notesInput").value = topic.notes || "";
    this.$("labelsInput").value = topic.labels.join(", ");
    this.$("tagsInput").value = topic.tags.join(", ");
    this.$("shapeInput").value = topic.style.shape;
    this.$("fontSizeInput").value = topic.style.fontSize;
    this.$("fillInput").value = toColor(topic.style.fill);
    this.$("textColorInput").value = toColor(topic.style.color);
    this.$("borderInput").value = toColor(topic.style.border);
    this.$("layoutInput").value = this.doc.preferences.layout || "balanced";
  }

  renderMinimap() {
    const bounds = getBounds(this.layout, 80);
    const scale = Math.min(160 / bounds.width, 96 / bounds.height);
    const topics = [...this.layout.values()].map((box) => `<rect x="${(box.x - bounds.x) * scale + 5}" y="${(box.y - bounds.y) * scale + 5}" width="${Math.max(2, box.width * scale)}" height="${Math.max(2, box.height * scale)}" rx="2" fill="${box.id === this.selection ? "#2563eb" : "#94a3b8"}"/>`).join("");
    this.$("minimap").innerHTML = `<svg width="170" height="110" viewBox="0 0 170 110" xmlns="${SVG_NS}">${topics}</svg>`;
  }

  applyInspector() {
    this.withHistory(() => {
      updateTopic(this.doc, this.selection, {
        title: this.$("titleInput").value || "Untitled",
        notes: this.$("notesInput").value,
        labels: splitList(this.$("labelsInput").value),
        tags: splitList(this.$("tagsInput").value),
        style: {
          shape: this.$("shapeInput").value,
          fontSize: Number(this.$("fontSizeInput").value) || 16,
          fill: this.$("fillInput").value,
          color: this.$("textColorInput").value,
          border: this.$("borderInput").value
        }
      });
    });
  }

  canvasClick(event) {
    const node = event.target.closest?.(".topic-node");
    if (!node) return;
    const id = node.dataset.topicId;
    if (this.relationshipSource && this.relationshipSource !== id) {
      this.withHistory(() => {
        this.doc.relationships.push({ id: crypto.randomUUID(), from: this.relationshipSource, to: id, label: "related", color: "#ef4444" });
        this.relationshipSource = null;
      });
      return;
    }
    this.select(id);
  }

  pointerDown(event) {
    this.canvas.setPointerCapture(event.pointerId);
    const world = this.eventToWorld(event);
    const node = event.target.closest?.(".topic-node");
    if (node) {
      const id = node.dataset.topicId;
      this.select(id);
      const topic = this.doc.topics[id];
      this.history.snapshot(this.doc);
      this.drag = { type: "node", id, dx: topic.x - world.x, dy: topic.y - world.y, started: false };
    } else {
      this.drag = { type: "pan", x: event.clientX, y: event.clientY, pan: { ...this.pan } };
      this.canvas.classList.add("dragging");
    }
  }

  pointerMove(event) {
    if (!this.drag) return;
    if (this.drag.type === "pan") {
      this.pan.x = this.drag.pan.x + event.clientX - this.drag.x;
      this.pan.y = this.drag.pan.y + event.clientY - this.drag.y;
      this.renderCanvas();
      return;
    }
    const topic = this.doc.topics[this.drag.id];
    const world = this.eventToWorld(event);
    topic.manual = true;
    topic.x = world.x + this.drag.dx;
    topic.y = world.y + this.drag.dy;
    this.drag.started = true;
    this.layout = computeLayout(this.doc);
    this.renderCanvas();
  }

  pointerUp() {
    if (this.drag?.type === "node" && this.drag.started) this.autosave();
    if (this.drag?.type === "node" && !this.drag.started) this.history.undoStack.pop();
    this.drag = null;
    this.canvas.classList.remove("dragging");
  }

  wheelZoom(event) {
    event.preventDefault();
    const before = this.eventToWorld(event);
    const factor = event.deltaY > 0 ? 0.9 : 1.1;
    this.scale = clamp(this.scale * factor, 0.05, 10);
    const rect = this.canvas.getBoundingClientRect();
    this.pan.x = event.clientX - rect.left - before.x * this.scale;
    this.pan.y = event.clientY - rect.top - before.y * this.scale;
    this.render();
  }

  keyDown(event) {
    const editing = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName);
    if (editing && !event.ctrlKey && !event.metaKey) return;
    const ctrl = event.ctrlKey || event.metaKey;
    if (ctrl && event.key.toLowerCase() === "s") {
      event.preventDefault();
      this.saveMk4();
    } else if (ctrl && event.key.toLowerCase() === "o") {
      event.preventDefault();
      this.$("fileInput").click();
    } else if (ctrl && event.key.toLowerCase() === "z") {
      event.preventDefault();
      this.undo();
    } else if (ctrl && event.key.toLowerCase() === "y") {
      event.preventDefault();
      this.redo();
    } else if (ctrl && event.key.toLowerCase() === "c") {
      this.clipboard = structuredClone(this.doc.topics[this.selection]);
      this.status("Branch copied.");
    } else if (ctrl && event.key.toLowerCase() === "v" && this.clipboard) {
      this.withHistory(() => {
        const topic = duplicateBranch(this.doc, this.clipboard.id) || addTopic(this.doc, this.selection, this.clipboard.title);
        this.select(topic.id);
      });
    } else if (event.key === "Enter") {
      event.preventDefault();
      this.withHistory(() => this.select(addSibling(this.doc, this.selection).id));
    } else if (event.key === "Tab") {
      event.preventDefault();
      this.withHistory(() => {
        if (event.shiftKey) promoteTopic(this.doc, this.selection);
        else this.select(addTopic(this.doc, this.selection).id);
      });
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      this.deleteSelected();
    } else if (event.key === "F2") {
      this.showInlineEditor(this.selection);
    }
  }

  beginInlineEdit(event) {
    const node = event.target.closest?.(".topic-node");
    if (node) this.showInlineEditor(node.dataset.topicId);
  }

  showInlineEditor(id) {
    const topic = this.doc.topics[id];
    const box = this.layout.get(id);
    if (!topic || !box) return;
    this.select(id);
    const pos = this.worldToScreen(box.x - box.width / 2, box.y - box.height / 2);
    const editor = this.$("inlineEditor");
    const input = this.$("inlineEditorInput");
    editor.hidden = false;
    editor.style.left = `${pos.x}px`;
    editor.style.top = `${pos.y}px`;
    editor.style.width = `${Math.max(190, box.width * this.scale)}px`;
    input.value = topic.title;
    input.focus();
    input.select();
  }

  commitInlineEdit() {
    const editor = this.$("inlineEditor");
    if (editor.hidden) return;
    const value = this.$("inlineEditorInput").value.trim();
    this.withHistory(() => updateTopic(this.doc, this.selection, { title: value || "Untitled" }));
    this.hideInlineEdit();
  }

  hideInlineEdit() {
    this.$("inlineEditor").hidden = true;
  }

  select(id) {
    if (!this.doc.topics[id]) return;
    this.selection = id;
    this.render();
  }

  deleteSelected() {
    if (this.selection === this.doc.rootId) return;
    const parent = this.doc.topics[this.selection].parentId || this.doc.rootId;
    this.withHistory(() => {
      removeTopic(this.doc, this.selection);
      this.selection = parent;
    });
  }

  undo() {
    const doc = this.history.undo(this.doc);
    if (!doc) return;
    this.doc = doc;
    if (!this.doc.topics[this.selection]) this.selection = this.doc.rootId;
    this.render();
    this.status("Undo");
  }

  redo() {
    const doc = this.history.redo(this.doc);
    if (!doc) return;
    this.doc = doc;
    if (!this.doc.topics[this.selection]) this.selection = this.doc.rootId;
    this.render();
    this.status("Redo");
  }

  fit() {
    const bounds = getBounds(this.layout, 90);
    const rect = this.canvas.getBoundingClientRect();
    this.scale = clamp(Math.min(rect.width / bounds.width, rect.height / bounds.height), 0.05, 2);
    this.pan.x = rect.width / 2 - (bounds.x + bounds.width / 2) * this.scale;
    this.pan.y = rect.height / 2 - (bounds.y + bounds.height / 2) * this.scale;
    this.render();
  }

  setZoom(value) {
    this.scale = clamp(value, 0.05, 10);
    this.render();
  }

  eventToWorld(event) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left - this.pan.x) / this.scale,
      y: (event.clientY - rect.top - this.pan.y) / this.scale
    };
  }

  worldToScreen(x, y) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: rect.left + this.pan.x + x * this.scale,
      y: rect.top + this.pan.y + y * this.scale
    };
  }

  toggleTheme() {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next === "dark" ? "dark" : "";
    this.doc.preferences.theme = next;
    this.status(`${next[0].toUpperCase()}${next.slice(1)} mode`);
  }

  newDocument() {
    if (!confirm("Create a new mind map? Unsaved changes can still be recovered from autosave.")) return;
    this.doc = createDocument();
    this.history = new HistoryStack();
    this.selection = this.doc.rootId;
    this.scale = 1;
    this.pan = { x: 0, y: 0 };
    this.render();
    this.fit();
  }

  async openFile(file) {
    if (!file) return;
    try {
      this.doc = await importAny(file);
      this.history = new HistoryStack();
      this.selection = this.doc.rootId;
      this.render();
      this.fit();
      this.status(`Opened ${file.name}`);
    } catch (error) {
      this.status(error.message, true);
      alert(error.message);
    } finally {
      this.$("fileInput").value = "";
    }
  }

  async saveMk4() {
    const blob = await serializeMk4(this.doc);
    downloadBlob(blob, `${safeName(this.doc.metadata.title || this.doc.topics[this.doc.rootId].title)}.mk4map`);
    this.status("Saved .mk4map");
  }


  async exportFormat(format) {
    const base = safeName(this.doc.metadata.title || this.doc.topics[this.doc.rootId].title);
    const saveText = (text, ext, type = "text/plain") => downloadBlob(new Blob([text], { type }), `${base}.${ext}`);
    if (format === "mk4") return this.saveMk4();
    if (format === "xmind") return downloadBlob(await exportXMind(this.doc), `${base}.xmind`);
    if (format === "json") return saveText(JSON.stringify(this.doc, null, 2), "json", "application/json");
    if (format === "md") return saveText(exportMarkdown(this.doc), "md", "text/markdown");
    if (format === "txt") return saveText(exportIndentedText(this.doc), "txt");
    if (format === "csv") return saveText(exportCsv(this.doc), "csv", "text/csv");
    if (format === "opml") return saveText(exportOpml(this.doc), "opml", "text/xml");
    if (format === "mm") return saveText(exportFreemind(this.doc), "mm", "text/xml");
    if (format === "xml") return saveText(exportSimpleXml(this.doc), "xml", "text/xml");
    if (format === "html") return saveText(exportHtml(this.doc), "html", "text/html");
    if (format === "svg") return saveText(this.buildSvgMarkup(), "svg", "image/svg+xml");
    if (format === "png") return this.exportPng(base);
    this.status("Export cancelled.");
  }

  async exportPng(base) {
    const svgText = this.buildSvgMarkup();
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svgText], { type: "image/svg+xml" }));
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });
    const bounds = getBounds(this.layout, 120);
    const canvas = document.createElement("canvas");
    canvas.width = Math.min(8192, Math.ceil(bounds.width));
    canvas.height = Math.min(8192, Math.ceil(bounds.height));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--canvas") || "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    canvas.toBlob((blob) => downloadBlob(blob, `${base}.png`), "image/png");
  }

  buildSvgMarkup() {
    const bounds = getBounds(this.layout, 120);
    this.renderCanvas(true);
    const clone = this.viewport.cloneNode(true);
    clone.setAttribute("transform", `translate(${-bounds.x} ${-bounds.y})`);
    const markup = `<svg xmlns="${SVG_NS}" width="${Math.ceil(bounds.width)}" height="${Math.ceil(bounds.height)}" viewBox="0 0 ${Math.ceil(bounds.width)} ${Math.ceil(bounds.height)}"><style>.topic-body{filter:none}.branch-line{fill:none;stroke:#8aa0b6;stroke-width:2.2;stroke-linecap:round}.relationship-line{fill:none;stroke:#ef4444;stroke-width:2;stroke-dasharray:7 6}.boundary-box{fill:rgba(15,118,110,.08);stroke:#0f766e;stroke-width:2;stroke-dasharray:8 6}.summary-brace{fill:none;stroke:#2563eb;stroke-width:3}.topic-label{font-size:11px;fill:#64748b}</style><rect width="100%" height="100%" fill="#fff"/>${clone.outerHTML}</svg>`;
    this.renderCanvas();
    return markup;
  }

  async attachImage(file) {
    if (!file) return;
    const dataUrl = await readAsDataUrl(file);
    this.withHistory(() => {
      const topic = this.doc.topics[this.selection];
      topic.images = [{ name: file.name, dataUrl }];
    });
    this.$("imageInput").value = "";
  }

  autosave() {
    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ savedAt: new Date().toISOString(), doc: this.doc }));
    } catch {
      this.status("Autosave skipped: browser storage quota reached.", true);
    }
  }

  checkRecovery() {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (raw) this.$("recoveryBanner").hidden = false;
  }

  recover() {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return;
    try {
      this.doc = JSON.parse(raw).doc;
      this.selection = this.doc.rootId;
      this.render();
      this.fit();
      this.$("recoveryBanner").hidden = true;
      this.status("Autosaved map recovered.");
    } catch {
      this.status("Recovery data could not be read.", true);
    }
  }

  installPluginApi() {
    window.MK4MindMapper = {
      getDocument: () => structuredClone(this.doc),
      setDocument: (doc) => {
        this.withHistory(() => {
          this.doc = doc;
          this.selection = doc.rootId;
        });
      },
      addCommand: (name, handler) => {
        window.MK4MindMapper.commands[name] = handler;
      },
      commands: {},
      events: new EventTarget()
    };
  }

  isSearchHit(topic) {
    if (!this.search) return false;
    return [topic.title, topic.notes, topic.labels.join(" "), topic.tags.join(" ")].join(" ").toLowerCase().includes(this.search);
  }

  status(message, error = false) {
    const status = this.$("statusText");
    status.textContent = message;
    status.style.color = error ? "var(--danger)" : "var(--muted)";
  }
}

function shapeElement(topic, box) {
  const attrs = {
    class: "topic-body",
    fill: topic.style.fill,
    stroke: topic.style.border,
    "stroke-width": 2,
    opacity: topic.style.opacity
  };
  const x = -box.width / 2;
  const y = -box.height / 2;
  if (topic.style.shape === "ellipse") return svg("ellipse", { ...attrs, cx: 0, cy: 0, rx: box.width / 2, ry: box.height / 2 });
  if (topic.style.shape === "diamond") return svg("polygon", { ...attrs, points: `0,${y} ${box.width / 2},0 0,${box.height / 2} ${x},0` });
  if (topic.style.shape === "hexagon") {
    const w = box.width / 2;
    const h = box.height / 2;
    return svg("polygon", { ...attrs, points: `${-w + 22},${-h} ${w - 22},${-h} ${w},0 ${w - 22},${h} ${-w + 22},${h} ${-w},0` });
  }
  if (topic.style.shape === "capsule") return svg("rect", { ...attrs, x, y, width: box.width, height: box.height, rx: box.height / 2 });
  if (topic.style.shape === "cloud") return svg("rect", { ...attrs, x, y, width: box.width, height: box.height, rx: 24, "stroke-dasharray": "9 5" });
  return svg("rect", { ...attrs, x, y, width: box.width, height: box.height, rx: topic.style.shape === "rectangle" ? 4 : 14 });
}

function svg(name, attrs = {}, text = null) {
  const el = document.createElementNS(SVG_NS, name);
  Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
  if (text !== null) el.textContent = text;
  return el;
}

function subtreeIds(doc, rootId) {
  const ids = [];
  const visit = (id) => {
    ids.push(id);
    doc.topics[id]?.children.forEach(visit);
  };
  visit(rootId);
  return ids;
}

function splitList(value) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function ellipsize(value, limit) {
  return value.length > limit ? `${value.slice(0, limit - 1)}...` : value;
}

function safeName(value) {
  return value.replace(/[\\/:*?"<>|]+/g, "-").slice(0, 80) || "mind-map";
}

function toColor(value) {
  if (/^#[0-9a-f]{6}$/i.test(value)) return value;
  return "#ffffff";
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

window.addEventListener("DOMContentLoaded", () => new MK4MindMapperApp());
