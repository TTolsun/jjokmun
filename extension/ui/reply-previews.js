import { bindDocumentPreview } from './document-preview.js';

// A rendering that is one plain paragraph says nothing the raw text does not, so the reply
// keeps its raw text and shows no source toggle.
function plainParagraph(preview) {
  const only = preview.childElementCount === 1 && preview.firstElementChild;
  return only?.localName === 'p' && [...only.childNodes].every(node => node.nodeType === Node.TEXT_NODE);
}

// Each reply owns a preview, so rendering one reply never cancels another's diagrams.
// Replies render once they scroll into view, and a rendered reply is reused across
// refreshes until its text or its memo's file path changes.
export function bindReplyPreviews({ folder, hasDocument, openDocument }) {
  const views = new Map();
  const byBody = new WeakMap();
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      byBody.get(entry.target)?.render();
    }
  });

  function create(reply, path) {
    const body = document.createElement('div');
    body.className = 'reply-body';
    const raw = document.createElement('p');
    raw.className = 'reply-original';
    raw.textContent = reply.text;
    const preview = document.createElement('div');
    preview.className = 'document-preview reply-preview';
    preview.hidden = true;
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'document-action reply-source-toggle';
    toggle.hidden = true;
    toggle.setAttribute('aria-pressed', 'false');
    body.append(raw, preview, toggle);
    const controller = bindDocumentPreview({ folder, hasDocument, openDocument, raw, preview, toggle });
    const view = {
      id: reply.id, text: reply.text, path, body, controller, requested: false,
      render() {
        controller.update({ id: reply.id, text: reply.text, documentPath: path, documentFormat: 'markdown' });
        if (plainParagraph(preview)) controller.reset(false);
      }
    };
    byBody.set(body, view);
    return view;
  }

  function drop(view) {
    observer.unobserve(view.body);
    view.controller.reset(false);
    views.delete(view.id);
  }

  function bodyFor(reply, memo) {
    const path = memo.documentPath;
    let view = views.get(reply.id);
    if (view && (view.text !== reply.text || view.path !== path)) {
      drop(view);
      view = undefined;
    }
    if (!view) {
      view = create(reply, path);
      views.set(reply.id, view);
    }
    if (!view.requested) {
      view.requested = true;
      observer.observe(view.body);
    }
    return view.body;
  }

  function prune(ids) {
    for (const view of [...views.values()]) if (!ids.has(view.id)) drop(view);
  }

  function reset() {
    for (const view of [...views.values()]) drop(view);
  }

  return { bodyFor, prune, reset };
}
