import { createTime, element, memoExcerpt } from './dom.js';

function searchText(text) {
  return text.normalize('NFC').toLocaleLowerCase('ko-KR');
}

export function newestMemos(memos) {
  return [...memos].reverse().sort((a, b) => b.createdOn.localeCompare(a.createdOn));
}

function showMatchingText(container, value, query) {
  const normalized = value.normalize('NFC');
  const hit = query ? searchText(normalized).indexOf(query) : -1;
  if (hit === -1) {
    container.textContent = value;
    return;
  }
  const short = normalized.length <= 64;
  const start = short ? 0 : Math.max(0, hit - 5);
  const end = short ? normalized.length : Math.min(normalized.length, hit + query.length + 32);
  const match = document.createElement('mark');
  match.textContent = normalized.slice(hit, hit + query.length);
  container.append((start ? '…' : '') + normalized.slice(start, hit), match,
    normalized.slice(hit + query.length, end) + (end < normalized.length ? '…' : ''));
}

const PAGE_SIZE = 100;
let visibleLimit = PAGE_SIZE;

function searchControl() {
  const section = element('memo-search');
  return section.open ? element('archive-search') : section.querySelector('summary');
}

const archiveToggle = element('archive-toggle');

export function setArchiveOpen(open) {
  archiveToggle.setAttribute('aria-expanded', String(open));
}

export function focusArchiveReturn(id) {
  if (archiveToggle.getClientRects().length && archiveToggle.getAttribute('aria-expanded') === 'false') {
    archiveToggle.focus();
  } else {
    const row = [...element('archive-list').children].find(item => item.dataset.memoId === id);
    (row || searchControl()).focus();
  }
}

export function resetArchive() {
  visibleLimit = PAGE_SIZE;
  setArchiveOpen(false);
  const more = element('archive-more');
  more.onclick = null;
  more.hidden = true;
}

export function renderArchive(memos, selectedId, openDetail) {
  const list = element('archive-list');
  const focusedId = list.contains(document.activeElement) ? document.activeElement.dataset.memoId : undefined;
  const query = searchText(element('archive-search').value.trim());
  element('memo-count').textContent = memos.length;
  element('memo-count').hidden = Boolean(query);
  list.replaceChildren();
  const more = element('archive-more');
  more.hidden = true;
  more.onclick = null;
  let focusTarget;
  for (const memo of memos) {
    const matchedReply = query ? memo.replies.findLast((reply) => searchText(reply.text).includes(query)) : undefined;
    const path = memo.documentPath;
    const matchedText = query && searchText(memo.text).includes(query);
    if (query && !matchedReply && !matchedText && !searchText(path ?? '').includes(query)) continue;
    if (list.childElementCount >= visibleLimit) {
      more.hidden = false;
      more.onclick = () => {
        const previous = visibleLimit;
        visibleLimit += PAGE_SIZE;
        renderArchive(memos, selectedId, openDetail);
        list.children[previous]?.focus();
      };
      break;
    }
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'archive-entry';
    row.dataset.memoId = memo.id;
    if (memo.id === selectedId) row.setAttribute('aria-current', 'true');
    const text = document.createElement('span');
    text.className = 'archive-text';
    const excerpt = matchedText ? memo.text : memoExcerpt(memo, 180);
    showMatchingText(text, memo.documentMissing ? '파일 연결 끊김' : excerpt || '빈 문서', query);
    const meta = document.createElement('span');
    meta.className = 'archive-meta';
    meta.append(createTime(memo.createdOn));
    if (memo.replies.length) meta.append(` · 답장 ${memo.replies.length}개`);
    row.append(text);
    if (path) {
      const location = document.createElement('span');
      location.className = 'archive-path';
      showMatchingText(location, path, query);
      row.append(location);
    }
    row.append(meta);
    if (matchedReply) {
      const snippet = document.createElement('span');
      snippet.className = 'archive-snippet';
      snippet.append('↳ 답장 ');
      const matchText = document.createElement('span');
      showMatchingText(matchText, matchedReply.text, query);
      snippet.append(matchText);
      row.append(snippet);
    }
    row.addEventListener('click', () => openDetail(memo.id, matchedReply?.id, row));
    list.append(row);
    if (memo.id === focusedId) focusTarget = row;
  }
  if (focusedId) (focusTarget || searchControl()).focus();
  element('archive-status').textContent = list.childElementCount ? '' : query ? '검색 결과가 없습니다.' : '아직 남긴 메모가 없습니다.';
}

function openJournal() {
  if (location.hash !== '#journal') {
    history.replaceState(null, '', '#journal');
    window.dispatchEvent(new Event('hashchange'));
  }
}
element('open-archive').addEventListener('click', () => {
  openJournal();
  element('memo-input').focus();
});
archiveToggle.addEventListener('click', () => {
  setArchiveOpen(archiveToggle.getAttribute('aria-expanded') === 'false');
});
window.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && !document.querySelector('dialog[open]')) {
    event.preventDefault();
    if (!document.body.classList.contains('journal-view')) openJournal();
    if (element('memo-archive').closest('[hidden]')) return;
    setArchiveOpen(true);
    element('memo-search').open = true;
    element('archive-search').focus();
    element('archive-search').select();
  }
});
element('archive-search').addEventListener('input', () => { visibleLimit = PAGE_SIZE; });
element('memo-search').addEventListener('toggle', () => {
  const search = element('archive-search');
  if (!element('memo-search').open && search.value) {
    search.value = '';
    search.dispatchEvent(new Event('input'));
  }
});
element('archive-search').addEventListener('keydown', (event) => {
  if (event.isComposing || event.keyCode === 229) return;
  const first = element('archive-list').firstElementChild;
  if (!first || !['ArrowDown', 'Enter'].includes(event.key)) return;
  event.preventDefault();
  if (event.key === 'Enter') first.click();
  else first.focus();
});
element('archive-list').addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    event.target.nextElementSibling?.focus();
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    (event.target.previousElementSibling || searchControl()).focus();
  }
});
