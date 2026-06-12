export function computeLayout(doc) {
  const layout = new Map();
  const rowGap = 92;
  const colGap = 245;
  const root = doc.topics[doc.rootId];
  if (!root) return layout;

  const measure = (id) => {
    const topic = doc.topics[id];
    if (!topic || topic.collapsed || topic.children.length === 0) return 1;
    return Math.max(1, topic.children.reduce((sum, childId) => sum + measure(childId), 0));
  };

  const nodeSize = (topic) => {
    const width = Math.max(132, Math.min(270, 72 + topic.title.length * 8));
    const imageBoost = topic.images?.length ? 80 : 0;
    return { width, height: Math.max(48, 52 + imageBoost) };
  };

  const place = (id, depth, top, side = 1) => {
    const topic = doc.topics[id];
    if (!topic) return top;
    const span = measure(id);
    const size = nodeSize(topic);
    const autoX = depth * colGap * side;
    const autoY = top + (span * rowGap) / 2;
    const x = topic.manual ? topic.x : autoX;
    const y = topic.manual ? topic.y : autoY;
    layout.set(id, { id, x, y, ...size, depth, side, visible: true });
    if (topic.collapsed) return top + rowGap;
    let childTop = top;
    topic.children.forEach((childId) => {
      childTop = place(childId, depth + 1, childTop, side);
    });
    return top + span * rowGap;
  };

  const children = root.children;
  const rootSize = nodeSize(root);
  layout.set(root.id, { id: root.id, x: 0, y: 0, ...rootSize, depth: 0, side: 1, visible: true });

  if (doc.preferences?.layout === "left") {
    placeChildren(children, -1, 0);
  } else if (doc.preferences?.layout === "right" || doc.preferences?.layout === "tree") {
    placeChildren(children, 1, 0);
  } else {
    const left = children.filter((_, index) => index % 2 === 1);
    const right = children.filter((_, index) => index % 2 === 0);
    placeChildren(right, 1, 0);
    placeChildren(left, -1, 0);
  }

  function placeChildren(ids, side, startTop) {
    const totalSpan = ids.reduce((sum, id) => sum + measure(id), 0);
    let top = startTop - (totalSpan * rowGap) / 2;
    ids.forEach((id) => {
      top = place(id, 1, top, side);
    });
  }

  return layout;
}

export function getBounds(layout, padding = 160) {
  const values = [...layout.values()];
  if (!values.length) return { x: -padding, y: -padding, width: padding * 2, height: padding * 2 };
  const minX = Math.min(...values.map((item) => item.x - item.width / 2)) - padding;
  const maxX = Math.max(...values.map((item) => item.x + item.width / 2)) + padding;
  const minY = Math.min(...values.map((item) => item.y - item.height / 2)) - padding;
  const maxY = Math.max(...values.map((item) => item.y + item.height / 2)) + padding;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function visibleTopicIds(layout, viewport, margin = 420) {
  const minX = viewport.x - margin;
  const maxX = viewport.x + viewport.width + margin;
  const minY = viewport.y - margin;
  const maxY = viewport.y + viewport.height + margin;
  const ids = new Set();
  for (const item of layout.values()) {
    if (
      item.x + item.width / 2 >= minX &&
      item.x - item.width / 2 <= maxX &&
      item.y + item.height / 2 >= minY &&
      item.y - item.height / 2 <= maxY
    ) {
      ids.add(item.id);
    }
  }
  return ids;
}

export function branchPath(from, to, branch = "curved") {
  const startX = from.x + (to.side >= 0 ? from.width / 2 : -from.width / 2);
  const startY = from.y;
  const endX = to.x - (to.side >= 0 ? to.width / 2 : -to.width / 2);
  const endY = to.y;
  if (branch === "straight") return `M ${startX} ${startY} L ${endX} ${endY}`;
  if (branch === "orthogonal") {
    const midX = (startX + endX) / 2;
    return `M ${startX} ${startY} L ${midX} ${startY} L ${midX} ${endY} L ${endX} ${endY}`;
  }
  const curve = Math.max(70, Math.abs(endX - startX) * 0.42);
  return `M ${startX} ${startY} C ${startX + curve * to.side} ${startY}, ${endX - curve * to.side} ${endY}, ${endX} ${endY}`;
}
