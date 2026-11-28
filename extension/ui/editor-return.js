const EDITORS = '#memo-input, #edit-input, #reply-input, #reply-edit-input';

function revealOffscreenEditor(editor) {
  const viewport = window.visualViewport;
  const top = Math.max(viewport?.offsetTop ?? 0, document.querySelector('.site-header')?.getBoundingClientRect().bottom ?? 0);
  const bottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight);
  function outside(rect) {
    return rect.bottom <= top || rect.top >= bottom;
  }
  if (!outside(editor.getBoundingClientRect())) return;
  editor.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
  const rect = editor.getBoundingClientRect();
  // The layout and visual viewports may have different heights while the keyboard is open.
  if (outside(rect)) {
    window.scrollBy({ top: rect.bottom <= top ? rect.top - top : rect.bottom - bottom, behavior: 'instant' });
  }
}

export function bindEditorReturn(getContext) {
  let last;
  let captured;
  let beforeBlur;
  let cancelScrollRestore;

  function contextFor(editor) {
    if (!editor?.matches(EDITORS) || !editor.isConnected || editor.disabled || editor.readOnly
      || editor.closest('[hidden], [inert]') || !editor.getClientRects().length) return undefined;
    return getContext(editor.id);
  }

  function snapshot(editor) {
    const context = contextFor(editor);
    if (context === undefined) return undefined;
    const scroll = [];
    for (let box = editor; box && box !== document.documentElement; box = box.parentElement) {
      if (box === editor || box.scrollWidth > box.clientWidth || box.scrollHeight > box.clientHeight) {
        scroll.push({ box, left: box.scrollLeft, top: box.scrollTop });
      }
    }
    return {
      editor, context, scroll, x: window.scrollX, y: window.scrollY,
      start: editor.selectionStart, end: editor.selectionEnd, direction: editor.selectionDirection
    };
  }

  function rememberBeforeBlur() {
    const saved = snapshot(document.activeElement);
    if (!saved) return;
    beforeBlur = saved;
    setTimeout(() => {
      if (beforeBlur === saved) beforeBlur = undefined;
    }, 0);
  }

  // Browsers can reset an input's horizontal scroll before delivering focusout.
  document.addEventListener('pointerdown', event => {
    if (event.target !== document.activeElement) rememberBeforeBlur();
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Tab') rememberBeforeBlur();
  }, true);
  document.addEventListener('focusout', event => {
    if (!event.target.matches?.(EDITORS)) return;
    last = beforeBlur?.editor === event.target ? beforeBlur : snapshot(event.target);
    beforeBlur = undefined;
  });

  function capture() {
    cancelScrollRestore?.();
    captured = snapshot(document.activeElement) ?? last;
    last = undefined;
  }

  function restore() {
    const saved = captured;
    captured = undefined;
    if (!saved || saved.context !== contextFor(saved.editor)) return false;
    const { editor, start, end, direction, scroll, x, y } = saved;
    editor.focus({ preventScroll: true });
    if (document.activeElement !== editor) return false;
    if (start !== null && end !== null) editor.setSelectionRange(start, end, direction);

    function restoreScroll() {
      if (document.activeElement !== editor || contextFor(editor) !== saved.context) return;
      for (const { box, left, top } of scroll) {
        if (box.isConnected) box.scrollTo({ left, top, behavior: 'instant' });
      }
      window.scrollTo({ left: x, top: y, behavior: 'instant' });
      revealOffscreenEditor(editor);
    }

    restoreScroll();
    // Mobile keyboard animation can resize the visual viewport after focus returns.
    const lifetime = new AbortController();
    const { signal } = lifetime;
    const frame = requestAnimationFrame(restoreScroll);
    const timer = setTimeout(stop, 500);
    function stop() {
      lifetime.abort();
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      cancelScrollRestore = undefined;
    }
    window.visualViewport?.addEventListener('resize', restoreScroll, { signal });
    for (const event of ['focusout', 'pointerdown', 'keydown', 'wheel']) {
      document.addEventListener(event, stop, { capture: true, signal });
    }
    cancelScrollRestore = stop;
    return true;
  }

  function reset() {
    cancelScrollRestore?.();
    last = captured = beforeBlur = undefined;
  }

  return { capture, restore, reset };
}
