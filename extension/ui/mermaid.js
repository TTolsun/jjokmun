let frame;
let ready;
let serial = 0;
const requests = new Map();

function rendererFrame() {
  if (frame) return ready;
  const iframe = document.createElement('iframe');
  iframe.className = 'document-renderer';
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.tabIndex = -1;
  iframe.src = 'mermaid-sandbox.html';
  ready = new Promise(resolve => iframe.addEventListener('load', () => resolve(iframe), { once: true }));
  frame = iframe;
  document.body.append(iframe);
  return ready;
}

window.addEventListener('message', event => {
  if (!frame || event.source !== frame.contentWindow || event.origin !== 'null') return;
  const request = requests.get(event.data?.id);
  if (request) request(event.data.svg, event.data.error);
});

function parseError(message) {
  const line = /Parse error on line (\d+)/.exec(message)?.[1];
  const error = new Error(line ? `Mermaid ${line}번째 줄을 해석하지 못했습니다.` : 'Mermaid 코드를 해석하지 못했습니다.');
  error.details = message;
  return error;
}

export function renderMermaid(source) {
  return new Promise((resolve, reject) => {
    const id = ++serial;
    const timeout = setTimeout(() => requests.get(id)?.(), 12000);
    requests.set(id, (svg, error) => {
      clearTimeout(timeout);
      requests.delete(id);
      if (typeof svg === 'string') resolve(svg);
      else if (typeof error === 'string' && error) reject(parseError(error));
      else reject(new Error('Mermaid 다이어그램을 렌더링하지 못했습니다.'));
    });
    rendererFrame().then(iframe => {
      if (frame === iframe && requests.has(id)) iframe.contentWindow.postMessage({ id, source }, '*');
    });
  });
}

export function resetMermaid() {
  for (const request of requests.values()) request();
  frame?.remove();
  frame = ready = undefined;
}
