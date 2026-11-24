import { createTime, element } from './dom.js';

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
  const start = Math.max(0, hit - 5);
  const end = Math.min(normalized.length, hit + query.length + 32);
  const match = document.createElement('mark');
  match.textContent = normalized.slice(hit, hit + query.length);
  container.append((start ? '…' : '') + normalized.slice(start, hit), match,
    normalized.slice(hit + query.length, end) + (end < normalized.length ? '…' : ''));
}

export function renderArchive(memos, selectedId, openDetail) {
  const list = element('archive-list');
  const focusedId = list.contains(document.activeElement) ? document.activeElement.dataset.memoId : undefined;
  const query = searchText(element('archive-search').value.trim());
  element('memo-count').textContent = memos.length;
  list.replaceChildren();
  let focusTarget;
  for (const memo of memos) {
    const matchedReply = query ? memo.replies.findLast((reply) => searchText(reply.text).includes(query)) : undefined;
    if (query && !matchedReply && !searchText(memo.text).includes(query)) continue;
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'archive-entry';
    row.dataset.memoId = memo.id;
    if (memo.id === selectedId) row.setAttribute('aria-current', 'true');
    const text = document.createElement('span');
    text.className = 'archive-text';
    showMatchingText(text, memo.text, query);
    const meta = document.createElement('span');
    meta.className = 'archive-meta';
    meta.append(createTime(memo.createdOn));
    if (memo.replies.length) meta.append(` · 답장 ${memo.replies.length}개`);
    row.append(text, meta);
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
  if (focusedId) (focusTarget || element('archive-search')).focus();
  element('archive-status').textContent = list.childElementCount ? '' : query ? '검색 결과가 없습니다.' : '아직 남긴 메모가 없습니다.';
}

function focusSearch() {
  element('archive-search').focus();
  element('archive-search').select();
}
element('open-archive').addEventListener('click', focusSearch);
window.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && !document.querySelector('dialog[open]')) {
    event.preventDefault();
    focusSearch();
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
    (event.target.previousElementSibling || element('archive-search')).focus();
  }
});
