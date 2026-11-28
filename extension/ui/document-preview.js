import { element } from './dom.js';
import { markdown } from './markdown.js';
import { detectFormat, memoFormat } from '../documents.js';
import { readMarkdownImage, resolveMarkdownPath } from './markdown-assets.js';
import { renderMermaid, resetMermaid } from './mermaid.js';
import { renderPlantuml, resetPlantuml } from './plantuml.js';

const formats = new Map([
  ['md', 'markdown'], ['markdown', 'markdown'],
  ['mmd', 'mermaid'], ['mermaid', 'mermaid'],
  ['puml', 'plantuml'], ['plantuml', 'plantuml']
]);
const names = { mermaid: 'Mermaid', plantuml: 'PlantUML' };
const markdownTags = new Set(['p', 'blockquote', 'ul', 'ol', 'li', 'strong', 'em', 's', 'h1', 'h2', 'h3',
  'h4', 'h5', 'h6', 'table', 'tbody', 'thead', 'tr', 'th', 'td']);
const svgTags = new Set(['svg', 'g', 'title', 'desc', 'style', 'defs', 'symbol', 'use', 'path', 'line', 'polyline',
  'polygon', 'rect', 'circle', 'ellipse', 'text', 'tspan', 'textPath', 'marker', 'clipPath', 'mask', 'pattern',
  'linearGradient', 'radialGradient', 'stop', 'filter', 'feFlood', 'feGaussianBlur', 'feOffset', 'feComposite',
  'feMerge', 'feMergeNode', 'feColorMatrix', 'feDropShadow', 'a']);

function codeBlock(source, className) {
  const pre = document.createElement('pre');
  if (className) pre.className = className;
  const code = document.createElement('code');
  code.textContent = source;
  pre.append(code);
  return pre;
}

function diagramImage(svg) {
  if (svg.length > 8 * 1024 * 1024) throw new Error('Diagram output is too large.');
  const tree = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = tree.documentElement;
  if (root.namespaceURI !== 'http://www.w3.org/2000/svg' || root.localName !== 'svg' || tree.querySelector('parsererror')) {
    throw new Error('Invalid SVG output.');
  }
  for (const node of [root, ...root.querySelectorAll('*')]) {
    if (node.namespaceURI !== root.namespaceURI || !svgTags.has(node.localName)) {
      node.remove();
      continue;
    }
    for (const attr of [...node.attributes]) {
      if (attr.localName.toLowerCase().startsWith('on') || attr.localName === 'base'
        || (attr.localName === 'href' && !attr.value.startsWith('#'))) node.removeAttributeNode(attr);
    }
  }
  const clean = new XMLSerializer().serializeToString(root);
  return new Blob([clean], { type: 'image/svg+xml' });
}

export function bindDocumentPreview({ folder, hasDocument, openDocument,
  raw = element('detail-original'), preview = element('detail-preview'), toggle = element('toggle-document-source') }) {
  const urls = new Set();
  let active;

  function reset(disposeRenderers = true) {
    if (disposeRenderers) {
      resetMermaid();
      resetPlantuml();
    }
    active = undefined;
    for (const url of urls) URL.revokeObjectURL(url);
    urls.clear();
    preview.replaceChildren();
    preview.hidden = toggle.hidden = true;
    raw.hidden = false;
  }

  function showSource(source) {
    raw.hidden = !source;
    preview.hidden = source;
    toggle.textContent = source ? '렌더링 보기' : '원문 보기';
    toggle.setAttribute('aria-pressed', String(source));
  }

  function urlFor(blob) {
    const url = URL.createObjectURL(blob);
    urls.add(url);
    return url;
  }

  function appendDiagram(parent, format, source, view) {
    const figure = document.createElement('figure');
    figure.className = 'document-diagram';
    const status = document.createElement('p');
    status.className = 'diagram-status';
    status.setAttribute('role', 'status');
    status.textContent = names[format] + ' 다이어그램을 렌더링하는 중입니다.';
    figure.append(status);
    parent.append(figure);

    function failed(message, details) {
      if (view !== active) return;
      status.textContent = message;
      // The engine's own report names the failing line and what it expected there.
      if (details) figure.append(codeBlock(details, 'diagram-error'));
      figure.append(codeBlock(source, 'diagram-source'));
    }

    if (source.length > 30000) {
      failed('미리보기는 다이어그램당 30,000자까지 표시합니다.');
      return;
    }
    const render = format === 'mermaid' ? renderMermaid : renderPlantuml;
    view.diagramQueue = view.diagramQueue.then(async () => {
      if (view !== active) return;
      const svg = await render(source);
      if (view !== active) return;
      const img = document.createElement('img');
      img.className = 'diagram-image';
      img.alt = names[format] + ' 다이어그램';
      const url = urlFor(diagramImage(svg));
      img.addEventListener('error', () => {
        img.remove();
        URL.revokeObjectURL(url);
        urls.delete(url);
        failed('다이어그램 이미지를 표시하지 못했습니다.');
      }, { once: true });
      img.addEventListener('load', () => { status.hidden = true; }, { once: true });
      img.src = url;
      figure.append(img);
    }).catch(error => failed(error?.message || names[format] + ' 다이어그램을 렌더링하지 못했습니다.', error?.details));
  }

  function appendImage(parent, token, view) {
    const alt = document.createElement('span');
    alt.className = 'markdown-image-alt';
    alt.textContent = token.children?.map(child => child.content).join('') || token.content;
    parent.append(alt);
    if (!view.directory || !view.path) return;
    readMarkdownImage(view.directory, view.path, token.attrGet('src')).then(blob => {
      if (view !== active || !blob) return;
      const image = document.createElement('img');
      image.alt = alt.textContent;
      image.loading = 'lazy';
      image.decoding = 'async';
      const url = urlFor(blob);
      image.addEventListener('error', () => {
        image.replaceWith(alt);
        URL.revokeObjectURL(url);
        urls.delete(url);
      }, { once: true });
      image.src = url;
      alt.replaceWith(image);
    }).catch(() => {});
  }

  function appendTokens(parent, tokens, view) {
    const stack = [parent];
    for (const token of tokens) {
      const node = stack.at(-1);
      if (token.type === 'inline') {
        appendTokens(node, token.children, view);
      } else if (token.type === 'text' || token.type === 'softbreak') {
        node.append(token.type === 'text' ? token.content : '\n');
      } else if (token.type === 'hardbreak' || token.type === 'hr') {
        node.append(document.createElement(token.tag));
      } else if (token.type === 'code_inline') {
        const code = document.createElement('code');
        code.textContent = token.content;
        node.append(code);
      } else if (token.type === 'image') {
        appendImage(node, token, view);
      } else if (token.type === 'fence' || token.type === 'code_block') {
        const format = formats.get(token.info.trim().split(/\s+/, 1)[0].toLowerCase());
        if (names[format]) appendDiagram(node, format, token.content, view);
        else node.append(codeBlock(token.content));
      } else if (token.nesting === 1) {
        let child;
        if (token.type === 'link_open') {
          const href = token.attrGet('href');
          const path = view.path && resolveMarkdownPath(view.path, href);
          if (path && hasDocument(path)) {
            child = document.createElement('button');
            child.type = 'button';
            child.className = 'markdown-link';
            child.addEventListener('click', () => openDocument(path, child));
          } else if (/^https?:\/\//i.test(href)) {
            child = document.createElement('a');
            child.href = href;
            child.target = '_blank';
            child.rel = 'noopener noreferrer';
          }
        } else if (markdownTags.has(token.tag) && !token.hidden) {
          child = document.createElement(token.tag);
          const start = token.attrGet('start');
          if (token.tag === 'ol' && /^\d+$/.test(start ?? '')) child.start = Number(start);
          const alignment = /^text-align:(left|right|center)$/.exec(token.attrGet('style') ?? '');
          if (alignment) child.classList.add('markdown-align-' + alignment[1]);
        }
        if (child) node.append(child);
        stack.push(child || node);
      } else if (token.nesting === -1 && stack.length > 1) {
        stack.pop();
      }
    }
  }

  function update(memo) {
    let format = memo.documentMissing ? undefined : memoFormat(memo);
    // A Markdown memo or .md file that holds only a diagram source renders as that diagram.
    if (format === 'markdown') format = detectFormat(memo.text);
    const directory = folder();
    if (active && active.id === memo.id && active.text === memo.text && active.format === format
      && active.path === memo.documentPath && active.directory === directory) return;
    reset(false);
    if (!names[format] && format !== 'markdown') return;
    const view = { id: memo.id, text: memo.text, format, path: memo.documentPath, directory, diagramQueue: Promise.resolve() };
    active = view;
    if (format === 'markdown') {
      try {
        const tokens = markdown.parse(memo.text, {});
        appendTokens(preview, tokens, view);
      } catch {
        if (view !== active) return;
        const error = document.createElement('p');
        error.className = 'diagram-status';
        error.textContent = 'Markdown 원문을 렌더링하지 못했습니다.';
        preview.replaceChildren(error, codeBlock(memo.text));
      }
    } else {
      appendDiagram(preview, format, memo.text, view);
    }
    toggle.hidden = false;
    showSource(false);
  }

  toggle.addEventListener('click', () => showSource(raw.hidden));
  return { update, reset };
}
