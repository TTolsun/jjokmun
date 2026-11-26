import { VAULT_FILE, scanFiles } from '../folder.js';
import { element } from './dom.js';
import { bindDocumentPreview } from './document-preview.js';
import { documentFormat, MAX_DOCUMENT_BYTES } from '../documents.js';

export function bindFolderFiles({ canOpenMemo, openMemo }) {
  const panel = element('folder-files');
  const list = element('file-list');
  const preview = element('file-dialog');
  const download = element('file-download');
  const openInJournal = element('open-file-memo');
  const search = element('file-search');
  let connection, scan, files = [], limit = 100, skipped = 0, objectUrl, previewId = 0;
  const documentPreview = bindDocumentPreview({
    raw: element('file-content'), preview: element('file-preview'), toggle: element('toggle-file-source'),
    folder: () => connection?.directory,
    hasDocument: canOpenMemo,
    openDocument(path) {
      preview.close();
      openMemo(path, document.activeElement);
    }
  });

  function clearPreview() {
    previewId++;
    documentPreview.reset(false);
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = undefined;
    openInJournal.hidden = true;
    openInJournal.onclick = null;
    download.removeAttribute('href');
    download.removeAttribute('download');
    for (const id of ['file-title', 'file-content', 'file-info']) element(id).textContent = '';
  }

  async function openFile(entry, source) {
    clearPreview();
    const expected = previewId;
    element('file-title').textContent = entry.path;
    element('file-info').textContent = '파일을 여는 중입니다.';
    openInJournal.hidden = !canOpenMemo(entry.path);
    openInJournal.onclick = () => {
      preview.close();
      openMemo(entry.path, source);
    };
    preview.showModal();
    try {
      const file = await entry.handle.getFile();
      const format = documentFormat(entry.path);
      const renderable = format && format !== 'text' && file.size <= MAX_DOCUMENT_BYTES;
      const bytes = new Uint8Array(await (renderable ? file : file.slice(0, 128 * 1024)).arrayBuffer());
      if (expected !== previewId || !preview.open) return;
      objectUrl = URL.createObjectURL(file);
      download.href = objectUrl;
      download.download = file.name;
      let encoding = 'utf-8';
      if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le';
      if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be';
      const partial = bytes.length < file.size;
      let content;
      if (encoding !== 'utf-8' || !bytes.includes(0)) {
        try { content = new TextDecoder(encoding, { fatal: true }).decode(bytes, { stream: partial }); } catch {}
      }
      element('file-info').textContent = file.size.toLocaleString('ko-KR') + '바이트 · ' +
        (content === undefined ? '원본 파일을 저장해서 열 수 있습니다.' : partial ? '앞부분 128 KiB 미리보기' : '전체 내용');
      element('file-content').textContent = content ?? '';
      if (renderable && content !== undefined) {
        documentPreview.update({ documentPath: entry.path, documentFormat: format, text: content });
      }
    } catch {
      if (expected === previewId) element('file-info').textContent = '파일을 열 수 없습니다. 폴더를 새로고침해 주세요.';
    }
  }

  function render() {
    const query = search.value.trim().toLocaleLowerCase();
    const matches = query ? files.filter(file => file.path.toLocaleLowerCase().includes(query)) : files;
    const rows = matches.slice(0, limit).map(entry => {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = entry.path;
      button.addEventListener('click', () => openFile(entry, button));
      li.append(button);
      return li;
    });
    list.replaceChildren(...rows);
    element('more-files').hidden = matches.length <= limit;
    element('file-status').textContent = (query ? '검색 결과 ' : '파일 ') + matches.length + '개' +
      (skipped ? ' · 접근할 수 없는 하위 폴더 ' + skipped + '개' : '');
  }

  async function rescan() {
    scan?.abort();
    if (!connection) return;
    scan = new AbortController();
    const { signal } = scan;
    element('file-status').textContent = '하위 폴더를 읽는 중입니다.';
    try {
      const result = await scanFiles(connection.directory, signal);
      if (signal.aborted) return;
      files = result.files;
      skipped = result.skipped;
      render();
    } catch {
      if (!signal.aborted) element('file-status').textContent = '폴더를 읽지 못했습니다. 접근 권한을 확인해 주세요.';
    }
  }

  function reset() {
    scan?.abort();
    scan = undefined;
    connection = undefined;
    files = [];
    skipped = 0;
    limit = 100;
    search.value = '';
    panel.hidden = true;
    panel.open = false;
    list.replaceChildren();
    if (preview.open) preview.close();
    clearPreview();
    element('storage-location').textContent = '';
    element('file-status').textContent = '';
  }

  panel.addEventListener('toggle', () => { if (panel.open && !scan) rescan(); });
  preview.addEventListener('close', clearPreview);
  element('file-close').addEventListener('click', () => preview.close());
  element('scan-files').addEventListener('click', rescan);
  element('more-files').addEventListener('click', () => { limit += 100; render(); });
  search.addEventListener('input', () => { limit = 100; render(); });
  return { reset, update(next) {
    element('storage-location').textContent = next ? next.directory.name + ' / ' + VAULT_FILE : '저장 폴더를 선택해 주세요.';
    if (connection?.id === next?.id) return;
    reset();
    connection = next;
    if (next) {
      element('storage-location').textContent = next.directory.name + ' / ' + VAULT_FILE;
      panel.hidden = false;
    }
  } };
}
