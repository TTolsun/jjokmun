const MAX_SOURCE_CHARACTERS = 64 * 1024;
const TIMEOUT = 10000;
const requests = new Map();
let frame;
let ready;
let cancelStart;
let nextId = 0;

function startRenderer() {
  frame = document.createElement('iframe');
  frame.hidden = true;
  frame.src = chrome.runtime.getURL('plantuml-sandbox.html');
  frame.title = 'PlantUML 미리보기';
  return new Promise((resolve, reject) => {
    const wait = setTimeout(() => fail('PlantUML 미리보기를 열지 못했습니다.'), TIMEOUT);
    function cleanup() {
      clearTimeout(wait);
      window.removeEventListener('message', onReady);
      cancelStart = undefined;
    }
    function fail(message) {
      cleanup();
      frame.remove();
      frame = undefined;
      ready = undefined;
      reject(new Error(message));
    }
    function onReady(event) {
      if (event.source !== frame.contentWindow || event.origin !== 'null') return;
      if (event.data?.type !== 'plantuml-ready') return;
      cleanup();
      resolve();
    }
    cancelStart = fail;
    window.addEventListener('message', onReady);
    document.body.append(frame);
  });
}

window.addEventListener('message', event => {
  if (event.source !== frame?.contentWindow || event.origin !== 'null') return;
  const { type, id, svg, error } = event.data || {};
  if (type !== 'plantuml-result' || !requests.has(id)) return;
  requests.get(id)(svg, error);
});

export function resetPlantuml() {
  const message = 'PlantUML 미리보기가 닫혔습니다.';
  cancelStart?.(message);
  frame?.remove();
  frame = undefined;
  ready = undefined;
  for (const done of requests.values()) done(undefined, message);
}

export async function renderPlantuml(source) {
  const input = source.trim();
  if (!input || input.length > MAX_SOURCE_CHARACTERS) throw new Error('PlantUML 코드가 비어 있거나 너무 깁니다.');
  if (/^\s*!include(?:url|_once|_many)?\b/im.test(input)) throw new Error('외부 파일 가져오기는 지원하지 않습니다.');
  // PlantUML supports several @start… diagram families. Bare UML is accepted in Markdown fences.
  const wrapped = /^\s*@start\w+\b/im.test(input) ? input : `@startuml\n${input}\n@enduml`;
  ready ??= startRenderer();
  const pending = ready;
  await pending;
  if (ready !== pending) throw new Error('PlantUML 미리보기가 닫혔습니다.');
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => done(undefined, 'PlantUML 미리보기가 오래 걸립니다.'), TIMEOUT);
    function done(svg, error) {
      requests.delete(id);
      clearTimeout(timer);
      if (error) reject(new Error(error));
      else resolve(svg);
    }
    requests.set(id, done);
    frame.contentWindow.postMessage({ type: 'render-plantuml', id, source: wrapped }, '*');
  });
}
