import { renderToString } from '../vendor/plantuml/plantuml.js';

const caller = window.parent;
const callerOrigin = location.origin;

function reply(message) {
  caller.postMessage(message, callerOrigin);
}

window.addEventListener('message', event => {
  if (event.source !== caller || event.origin !== callerOrigin) return;
  const { type, id, source } = event.data || {};
  if (type !== 'render-plantuml' || typeof source !== 'string' || !Number.isSafeInteger(id)) return;
  const failure = error => reply({ type: 'plantuml-result', id, error: String(error) });
  const success = svg => {
    if (typeof svg !== 'string') return failure('SVG를 만들지 못했습니다.');
    const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
    if (root.namespaceURI !== 'http://www.w3.org/2000/svg' || root.localName !== 'svg') return failure('올바른 SVG가 아닙니다.');
    const labels = Array.from(root.querySelectorAll('text'), label => label.textContent.trim());
    const line = labels.find(label => /^\[From .+ \(line \d+\)\s*\]$/.test(label));
    if (line && labels[0]?.startsWith('PlantUML version ')) {
      // The error image echoes the source up to the failing line, then the parser's verdict.
      return reply({ type: 'plantuml-result', id, error: 'syntax', line: Number(line.match(/\(line (\d+)\)/)[1]),
        code: String(labels.at(-2) ?? '').slice(0, 300), detail: String(labels.at(-1) ?? '').trim().slice(0, 300) });
    }
    const container = document.createElement('div');
    document.body.append(container);
    try {
      reply({ type: 'plantuml-result', id, svg: materializeSvgStyles(svg, container) });
    } catch (error) {
      failure(error.message);
    } finally {
      container.remove();
    }
  };
  try {
    renderToString(source.split(/\r\n?|\n/), success, failure);
  } catch (error) {
    failure(error.message);
  }
});

reply({ type: 'plantuml-ready' });
