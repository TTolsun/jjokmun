const renderer = globalThis.mermaid;
renderer.initialize({
  startOnLoad: false,
  securityLevel: 'strict',
  htmlLabels: false,
  suppressErrorRendering: true,
  maxTextSize: 30000,
  maxEdges: 500,
  secure: ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'maxEdges', 'htmlLabels',
    'suppressErrorRendering', 'legacyMathML', 'forceLegacyMathML', 'flowchart', 'class', 'state']
});

window.addEventListener('message', async (event) => {
  const { id, source } = event.data ?? {};
  if (event.source !== parent || !Number.isSafeInteger(id) || typeof source !== 'string' || source.length > 30000) return;
  const container = document.createElement('div');
  document.body.append(container);
  try {
    const { svg } = await renderer.render('diagram-' + id, source, container);
    parent.postMessage({ id, svg: materializeSvgStyles(svg, container) }, event.origin);
  } catch (error) {
    parent.postMessage({ id, error: String(error?.message ?? error).slice(0, 1000) }, event.origin);
  } finally {
    container.remove();
  }
});
