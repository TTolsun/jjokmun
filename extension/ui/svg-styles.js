// A blob SVG displayed by the extension inherits its inline-style restriction.
// Resolve the renderer's SVG styling inside the sandbox as presentation attributes.
const diagramPaint = ['alignment-baseline', 'clip-path', 'color', 'display', 'dominant-baseline',
  'fill', 'fill-opacity', 'fill-rule', 'filter', 'font-family', 'font-size', 'font-style', 'font-weight',
  'letter-spacing', 'marker-end', 'marker-mid', 'marker-start', 'mask', 'opacity', 'paint-order', 'stop-color',
  'stop-opacity', 'stroke', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin',
  'stroke-miterlimit', 'stroke-opacity', 'stroke-width', 'text-anchor', 'text-decoration', 'visibility'];

function materializeSvgStyles(source, container) {
  if (source.length > 8 * 1024 * 1024) return source;
  const parsed = new DOMParser().parseFromString(source, 'image/svg+xml');
  if (parsed.documentElement.localName !== 'svg') return source;
  const svg = document.importNode(parsed.documentElement, true);
  // Only style SVG content. Diagram engines may also emit HTML labels.
  svg.querySelectorAll('foreignObject, script, image').forEach(node => node.remove());
  container.replaceChildren(svg);
  const { width, height } = svg.viewBox.baseVal;
  if (width > 0 && height > 0) {
    svg.setAttribute('width', Math.min(width, 4096));
    svg.setAttribute('height', Math.min(width, 4096) * height / width);
  }
  const presentations = new Map();
  for (const node of [svg, ...svg.querySelectorAll('*')]) {
    if (node.localName === 'style') continue;
    const style = getComputedStyle(node);
    const paint = diagramPaint.map(name => {
      const value = style.getPropertyValue(name);
      if (!value.startsWith('url(')) return [name, value];
      const fragment = /#([^"')]+)["']?\)$/.exec(value)?.[1];
      return [name, fragment && parsed.getElementById(fragment) ? 'url(#' + fragment + ')' : 'none'];
    });
    presentations.set(node, paint);
  }
  svg.querySelectorAll('style').forEach(node => node.remove());
  for (const [node, attributes] of presentations) {
    node.removeAttribute('style');
    for (const [name, value] of attributes) {
      if (value) node.setAttribute(name, value);
    }
  }
  return new XMLSerializer().serializeToString(svg);
}
