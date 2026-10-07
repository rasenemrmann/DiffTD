// Tiny DOM helpers shared by the UI modules.

const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set(['svg', 'g', 'rect', 'path', 'text', 'line', 'title', 'defs', 'marker', 'circle']);

export function el(tag, attrs = {}, ...children) {
  const node = SVG_TAGS.has(tag) ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.setAttribute('class', value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child === undefined || child === null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  node.replaceChildren();
}

/** Human-readable parameter value. */
export function formatValue(value) {
  if (value === undefined) return '—';
  if (value !== null && typeof value === 'object') {
    if ('expr' in value) return `= ${value.expr}`;
    if ('bind' in value) return `bind ${value.bind}`;
    if ('export' in value) return `export ${value.export}`;
  }
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}
