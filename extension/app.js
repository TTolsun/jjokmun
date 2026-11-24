import { localDate, validDate, emptyState, selectDaily, PROP_KINDS, validateBackup } from './store.js';
import { BACKUP_FORMAT, MAX_BACKUP_BYTES, encryptBackup, decryptBackup } from './crypto.js';
import { mergeImport, undoImport } from './imports.js';
import { LockedError, readPayload, vaultStatus, dropVaultKey, enableVault, disableVault, lockVault, unlockVault } from './vault.js';

const element = (id) => document.getElementById(id);
const channel = new BroadcastChannel('memo-alley');
const requestedDate = new URLSearchParams(location.search).get('date');
const today = () => validDate(requestedDate) ? requestedDate : localDate();
const longDate = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'full', timeZone: 'UTC' });
const shortDate = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeZone: 'UTC' });
const formatDate = (date, formatter = shortDate) => formatter.format(new Date(date + 'T00:00:00Z'));

let state = emptyState();
let displayedDate;
let detailId;
let linkedReply;
let returnFocus;
let confirmedReplyCount;
let initialView = true;
let sceneRefresh = Promise.resolve();
let workspaceReady = false;
let mode;
let viewGeneration = 0;
let passwordAction;
let preview;
let backupEnvelope;
let lockPending = false;
let renderedRevision = -1;
const workspace = document.querySelector('.workspace');
const header = document.querySelector('.site-header');

function currentMemo() {
  return state.memos.find((memo) => memo.id === detailId);
}

function setStatus(id, message) {
  if (!workspaceReady && !['startup-status', 'unlock-status'].includes(id)) return;
  element(id).textContent = message;
}

function clearPasswords() {
  element('backup-password-form').reset();
  element('unlock-form').reset();
}

function clearSensitive(showLock) {
  viewGeneration += 1;
  workspaceReady = false;
  workspace.hidden = true;
  header.hidden = true;
  element('lock-screen').hidden = !showLock;
  element('startup-status').hidden = showLock;
  if (!showLock) setStatus('startup-status', '메모 골목을 여는 중입니다.');
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  for (const id of ['memo-input', 'archive-search', 'reply-input', 'edit-input', 'import-backup']) element(id).value = '';
  for (const id of ['detail-original', 'detail-date', 'detail-replies', 'daily-excerpt', 'archive-list',
    'detail-status', 'copy-status', 'home-status', 'archive-status', 'settings-status', 'password-status',
    'import-status', 'import-summary', 'undo-result', 'delete-message', 'vault-state', 'unlock-status']) {
    element(id).replaceChildren();
  }
  element('detail-date').removeAttribute('datetime');
  element('scene-board').hidden = true;
  element('daily-board').hidden = true;
  element('detail-dialog').hidden = true;
  element('edit-form').hidden = true;
  element('memo-count').textContent = '0';
  element('prop-count').textContent = '0 / 3';
  element('prop-progress').value = 0;
  for (const kind of PROP_KINDS) {
    for (const node of [element('prop-' + kind), element('collection-' + kind).querySelector('.sprite')]) {
      for (const animation of node.getAnimations()) animation.cancel();
    }
    element('prop-' + kind).hidden = true;
    element('collection-' + kind).disabled = true;
  }
  clearPasswords();
  backupEnvelope = undefined;
  passwordAction = undefined;
  preview = undefined;
  undoToken = undefined;
  state = emptyState();
  renderedRevision = -1;
  detailId = linkedReply = returnFocus = confirmedReplyCount = displayedDate = undefined;
  initialView = true;
  if (showLock && !lockPending) element('unlock-password').focus();
}

function renderPayload(result, security, date) {
  if (result.revision < renderedRevision) return;
  renderedRevision = result.revision;
  mode = security.mode;
  state = result.payload.state;
  workspaceReady = true;
  workspace.hidden = false;
  header.hidden = false;
  element('lock-screen').hidden = true;
  element('startup-status').hidden = true;
  element('undo-import').disabled = !result.payload.undo;
  element('enable-vault').hidden = mode !== 'plain';
  element('disable-vault').hidden = mode !== 'encrypted';
  element('lock-vault').hidden = mode !== 'encrypted';
  setStatus('vault-state', mode === 'encrypted'
    ? '이 프로필의 메모와 가져오기 되돌리기 기록을 암호화하고 있습니다.'
    : '이 프로필의 메모는 현재 평문으로 저장됩니다.');
  render(date);
}

function refresh() {
  let expected;
  sceneRefresh = sceneRefresh.then(async () => {
    if (lockPending) return;
    const date = today();
    expected = viewGeneration;
    const security = await vaultStatus();
    if (expected !== viewGeneration) return;
    if (security.locked) {
      mode = security.mode;
      if (element('lock-screen').hidden) clearSensitive(true);
      return;
    }
    let result = await readPayload();
    if (!result.payload.state.daily.some((entry) => entry.date === date)) {
      result = await readPayload((draft) => {
        if (draft.daily.some((entry) => entry.date === date)) return false;
        selectDaily(draft, date);
      });
    }
    if (expected === viewGeneration) renderPayload(result, security, date);
  }).catch((error) => {
    if (expected !== viewGeneration) return;
    if (error instanceof LockedError) {
      if (!lockPending && element('lock-screen').hidden) {
        dropVaultKey();
        clearSensitive(true);
      }
    } else {
      setStatus(workspaceReady ? 'home-status' : 'startup-status', error.message || '메모를 불러오지 못했습니다.');
    }
  });
  return sceneRefresh;
}

async function change(mutator) {
  if (!workspaceReady || lockPending) throw new LockedError();
  const date = today();
  const expected = viewGeneration;
  const result = await readPayload((draft) => {
    if (mutator(draft, date) === false) return false;
    selectDaily(draft, date);
  });
  if (expected !== viewGeneration) throw new LockedError();
  renderPayload(result, { mode }, date);
  channel.postMessage('changed');
  return state;
}

function render(date) {
  displayedDate = date;
  element('today-date').textContent = formatDate(date, longDate);
  const entry = state.daily.find((record) => record.date === date);
  const memo = !entry?.folded && state.memos.find((note) => note.id === entry?.memoId);
  const board = element('daily-board');
  const sceneBoard = element('scene-board');
  const boardHadFocus = board.contains(document.activeElement) || sceneBoard === document.activeElement;
  board.hidden = !memo;
  sceneBoard.hidden = !memo;
  element('daily-empty').hidden = Boolean(memo);
  element('daily-empty').textContent = entry?.folded ? '오늘은 입간판을 접어두었어요.' : '지난날의 메모가 여기에 걸려요.';
  if (memo) {
    const characters = Array.from(memo.text);
    element('daily-excerpt').textContent = characters.length > 66 ? characters.slice(0, 66).join('') + '…' : memo.text;
  } else if (boardHadFocus) {
    element('memo-input').focus();
  }

  const unlocked = new Set(state.props.map((prop) => prop.kind));
  for (const kind of PROP_KINDS) {
    element('prop-' + kind).hidden = !unlocked.has(kind);
    element('collection-' + kind).disabled = !unlocked.has(kind);
  }
  element('prop-count').textContent = `${unlocked.size} / ${PROP_KINDS.length}`;
  element('prop-progress').value = unlocked.size;
  element('collection-hint').textContent = unlocked.size === PROP_KINDS.length
    ? '소품을 모두 모았어요. 소품을 눌러 그때의 답장을 읽어 보세요.'
    : '메모에 답장을 남기면 소품이 하나씩 열려요.';

  if (initialView) {
    initialView = false;
    if (!detailId) detailId = newestMemos()[0]?.id;
  }
  if (detailId && !currentMemo()) {
    element('delete-dialog').close();
    closeDetail(element('detail-dialog').contains(document.activeElement));
  }
  renderArchive();
  renderSelection();
}

function bindTextForm(formId, inputId, buttonId, statusId, onSubmit) {
  const form = element(formId);
  const input = element(inputId);
  const button = element(buttonId);
  let composing = false;
  let pending = false;
  input.addEventListener('compositionstart', () => { composing = true; });
  input.addEventListener('compositionend', () => { composing = false; });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (composing || event.isComposing || event.keyCode === 229)) {
      event.preventDefault();
    }
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (composing || pending) return;
    const original = input.value;
    const text = original.trim();
    if (!text) {
      setStatus(statusId, '한 줄을 적어 주세요.');
      input.focus();
      return;
    }
    const inDetail = form.closest('#detail-dialog');
    const revision = detailId;
    const expected = viewGeneration;
    pending = true;
    button.disabled = true;
    try {
      const message = await onSubmit(text);
      if (expected === viewGeneration && (!inDetail || (!inDetail.hidden && detailId === revision))) {
        if (input.value === original) input.value = '';
        setStatus(statusId, message);
      }
    } catch (error) {
      if (expected === viewGeneration) {
        setStatus(statusId, error.message === '목록에서 이 메모를 찾을 수 없습니다.' ? error.message : '저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.');
      }
    } finally {
      pending = false;
      button.disabled = false;
    }
  });
}

bindTextForm('memo-form', 'memo-input', 'memo-save', 'home-status', async (text) => {
  const id = crypto.randomUUID();
  const previousId = detailId;
  await change((draft, date) => {
    draft.memos.push({ id, text, createdOn: date, updatedAt: Date.now(), replies: [] });
  });
  if (detailId === previousId) openDetail(id);
  if (document.activeElement === document.body) element('memo-input').focus();
  return '메모를 남겼어요.';
});

function findMemo(draft, id) {
  const memo = draft.memos.find((record) => record.id === id);
  if (!memo) throw new Error('목록에서 이 메모를 찾을 수 없습니다.');
  return memo;
}

bindTextForm('reply-form', 'reply-input', 'reply-save', 'detail-status', async (text) => {
  const replyId = crypto.randomUUID();
  const memoId = detailId;
  let addedProp;
  await change((draft, date) => {
    addedProp = undefined;
    const memo = findMemo(draft, memoId);
    if (memo.replies.some((reply) => reply.id === replyId)) return;
    memo.replies.push({ id: replyId, text, createdOn: date, createdAt: Date.now() });
    const kind = PROP_KINDS.find((item) => !draft.props.some((prop) => prop.kind === item));
    if (kind) {
      draft.props.push({ kind, memoId, replyId });
      addedProp = kind;
    }
  });
  if (addedProp) revealProp(addedProp);
  if (detailId === memoId && document.activeElement === document.body) element('reply-input').focus();
  return addedProp ? '답장을 저장했어요. 책방에 소품이 하나 생겼어요.' : '답장을 저장했어요.';
});

function revealProp(kind) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const frames = [
    { opacity: 0, transform: 'translateY(5px)', filter: 'brightness(1.28)' },
    { opacity: .95, transform: 'translateY(-2px)', offset: .66 },
    { opacity: 1, transform: 'translateY(0)' }
  ];
  element('prop-' + kind).animate(frames, { duration: 360, easing: 'ease-out' });
  element('collection-' + kind).querySelector('.sprite').animate(frames, { duration: 360, easing: 'ease-out' });
}

bindTextForm('edit-form', 'edit-input', 'edit-save', 'detail-status', async (text) => {
  const id = detailId;
  await change((draft) => {
    const memo = findMemo(draft, id);
    memo.text = text;
    memo.updatedAt = Math.min(8640000000000000, Math.max(Date.now(), memo.updatedAt + 1));
  });
  if (detailId === id) hideEdit();
  return '메모를 수정했어요.';
});

function createTime(date) {
  const time = document.createElement('time');
  time.dateTime = date;
  time.textContent = formatDate(date);
  return time;
}

function renderDetail() {
  const memo = currentMemo();
  const time = element('detail-date');
  time.dateTime = memo.createdOn;
  time.textContent = formatDate(memo.createdOn);
  element('detail-original').textContent = memo.text;
  const replies = [...memo.replies].sort((a, b) => a.createdOn.localeCompare(b.createdOn) || a.createdAt - b.createdAt);
  const container = element('detail-replies');
  const focusedReply = container.contains(document.activeElement) ? document.activeElement.dataset.replyId : undefined;
  container.replaceChildren();
  if (!replies.length) return;
  const label = document.createElement('h3');
  label.textContent = '답장';
  container.append(label);
  for (const reply of replies) {
    const article = document.createElement('article');
    if (reply.id === linkedReply) {
      article.className = 'linked-reply';
      const tag = document.createElement('span');
      tag.className = 'reply-tag';
      tag.textContent = returnFocus?.dataset.memoId ? '검색어가 있는 답장' : '이 소품을 남긴 답장';
      article.append(tag);
    }
    const text = document.createElement('p');
    text.textContent = reply.text;
    const header = document.createElement('div');
    header.className = 'reply-heading';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'copy-button copy-reply';
    copy.dataset.replyId = reply.id;
    copy.setAttribute('aria-label', '답장 복사');
    const icon = document.createElement('span');
    icon.className = 'copy-icon';
    icon.setAttribute('aria-hidden', 'true');
    copy.append(icon);
    copy.addEventListener('click', () => copyText(reply.text));
    header.append(createTime(reply.createdOn), copy);
    article.append(header, text);
    container.append(article);
    if (reply.id === focusedReply) copy.focus({ preventScroll: true });
  }
}

async function copyText(text) {
  if (!workspaceReady || lockPending) return;
  const expected = viewGeneration;
  const memo = detailId;
  try {
    const security = await vaultStatus();
    if (security.locked) {
      if (expected === viewGeneration) clearSensitive(true);
      return;
    }
    if (expected !== viewGeneration) return;
    await navigator.clipboard.writeText(text);
    if (expected === viewGeneration && memo === detailId) setStatus('copy-status', '텍스트를 복사했어요.');
  } catch {
    if (expected === viewGeneration && memo === detailId) setStatus('copy-status', '텍스트를 복사하지 못했습니다.');
  }
}

element('copy-memo').addEventListener('click', () => {
  const memo = currentMemo();
  if (memo) copyText(memo.text);
});

function openDetail(id, replyId, source) {
  if (!state.memos.some((memo) => memo.id === id)) return;
  if (detailId !== id) {
    element('reply-input').value = '';
    element('edit-form').hidden = true;
    setStatus('detail-status', '');
    setStatus('copy-status', '');
  }
  detailId = id;
  linkedReply = replyId;
  returnFocus = source;
  renderSelection();
  renderArchive();
  if (source) element('detail-title').focus();
}

function renderSelection() {
  const hasMemo = Boolean(currentMemo());
  element('detail-dialog').hidden = !hasMemo;
  element('note-empty').hidden = hasMemo;
  if (hasMemo) {
    renderDetail();
  } else if (state.memos.length) {
    element('empty-title').textContent = '메모를 골라 주세요';
    element('empty-text').textContent = '전체 메모에서 원문이나 답장을 찾아 열 수 있어요.';
  } else {
    element('empty-title').textContent = '아직 남긴 메모가 없어요';
    element('empty-text').textContent = '위에 한 줄을 저장하면 원문과 답장을 이곳에서 읽을 수 있어요.';
  }
}

function closeDetail(restoreFocus = true) {
  if (restoreFocus && returnFocus?.dataset.memoId) {
    const row = [...element('archive-list').children].find((item) => item.dataset.memoId === detailId);
    (row || element('archive-search')).focus();
  } else if (restoreFocus && returnFocus?.isConnected && !returnFocus.closest('[hidden]') && !returnFocus.disabled) {
    returnFocus.focus();
  } else if (restoreFocus) {
    element('memo-input').focus();
  }
  detailId = undefined;
  linkedReply = undefined;
  returnFocus = undefined;
  element('reply-input').value = '';
  element('edit-form').hidden = true;
  setStatus('detail-status', '');
  setStatus('copy-status', '');
  renderSelection();
  renderArchive();
}

function searchText(text) {
  return text.normalize('NFC').toLocaleLowerCase('ko-KR');
}

function newestMemos() {
  return [...state.memos].reverse().sort((a, b) => b.createdOn.localeCompare(a.createdOn));
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

function renderArchive() {
  const list = element('archive-list');
  const focusedId = list.contains(document.activeElement) ? document.activeElement.dataset.memoId : undefined;
  const query = searchText(element('archive-search').value.trim());
  const matches = newestMemos().filter((memo) => searchText(memo.text).includes(query)
    || memo.replies.some((reply) => searchText(reply.text).includes(query)));
  element('memo-count').textContent = state.memos.length;
  list.replaceChildren();
  let focusTarget;
  for (const memo of matches) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'archive-entry';
    row.dataset.memoId = memo.id;
    if (memo.id === detailId) row.setAttribute('aria-current', 'true');
    const text = document.createElement('span');
    text.className = 'archive-text';
    showMatchingText(text, memo.text, query);
    const meta = document.createElement('span');
    meta.className = 'archive-meta';
    meta.append(createTime(memo.createdOn));
    if (memo.replies.length) meta.append(` · 답장 ${memo.replies.length}개`);
    row.append(text, meta);
    const matchedReply = query && [...memo.replies].reverse().find((reply) => searchText(reply.text).includes(query));
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
  setStatus('archive-status', matches.length ? '' : query ? '검색 결과가 없습니다.' : '아직 남긴 메모가 없습니다.');
}

for (const id of ['daily-memo', 'scene-board']) {
  element(id).addEventListener('click', (event) => {
    const daily = state.daily.find((entry) => entry.date === displayedDate && !entry.folded);
    if (daily) openDetail(daily.memoId, undefined, event.currentTarget);
  });
}

element('defer-memo').addEventListener('click', async () => {
  const date = displayedDate;
  try {
    await change((draft) => { selectDaily(draft, date).folded = true; });
    setStatus('home-status', '오늘의 입간판을 접어두었어요.');
  } catch {
    setStatus('home-status', '입간판을 접어두지 못했습니다. 다시 시도해 주세요.');
  }
});

for (const kind of PROP_KINDS) {
  for (const prefix of ['prop-', 'collection-']) {
    element(prefix + kind).addEventListener('click', (event) => {
      const prop = state.props.find((item) => item.kind === kind);
      if (prop) openDetail(prop.memoId, prop.replyId, event.currentTarget);
    });
  }
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
element('archive-search').addEventListener('input', renderArchive);
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

element('edit-memo').addEventListener('click', () => {
  element('edit-input').value = currentMemo().text;
  element('edit-form').hidden = false;
  setStatus('detail-status', '');
  element('edit-input').focus();
});
function hideEdit() {
  element('edit-form').hidden = true;
  element('edit-memo').focus();
}
element('edit-cancel').addEventListener('click', hideEdit);

function describeDeletion(count, changed = false) {
  confirmedReplyCount = count;
  const message = count
    ? `메모에 남긴 답장 ${count}개가 함께 삭제됩니다. 이 메모에 연결된 소품도 사라집니다.`
    : '이 메모에는 답장이 없습니다. 삭제한 메모는 되돌릴 수 없습니다.';
  element('delete-message').textContent = changed ? `답장 수가 바뀌었습니다. ${message} 삭제하려면 다시 확인해 주세요.` : message;
}

element('delete-memo').addEventListener('click', () => {
  describeDeletion(currentMemo().replies.length);
  element('delete-dialog').showModal();
});

element('delete-confirm').addEventListener('click', async () => {
  const id = detailId;
  const expectedCount = confirmedReplyCount;
  const button = element('delete-confirm');
  let updatedCount;
  button.disabled = true;
  try {
    await change((draft) => {
      const memo = draft.memos.find((record) => record.id === id);
      if (!memo) return;
      if (memo.replies.length !== expectedCount) {
        updatedCount = memo.replies.length;
        return false;
      }
      draft.memos = draft.memos.filter((memo) => memo.id !== id);
      draft.props = draft.props.filter((prop) => prop.memoId !== id);
      for (const entry of draft.daily) {
        if (entry.memoId !== id) continue;
        entry.memoId = null;
        entry.folded = true;
      }
    });
    if (updatedCount !== undefined) {
      if (element('delete-dialog').open && detailId === id) {
        describeDeletion(updatedCount, true);
        element('delete-cancel').focus();
      }
      return;
    }
    setStatus('home-status', '메모를 삭제했어요.');
  } catch {
    element('delete-dialog').close();
    setStatus('detail-status', '메모를 삭제하지 못했습니다. 다시 시도해 주세요.');
  } finally {
    button.disabled = false;
  }
});

element('detail-close').addEventListener('click', () => closeDetail());
element('detail-dialog').addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !event.isComposing && event.keyCode !== 229) closeDetail();
});
element('settings-close').addEventListener('click', () => element('settings-dialog').close());
element('delete-cancel').addEventListener('click', () => element('delete-dialog').close());

element('open-settings').addEventListener('click', () => {
  setStatus('settings-status', '');
  element('settings-dialog').showModal();
});

const passwordDialog = element('backup-password-dialog');
const previewDialog = element('import-preview-dialog');
const undoDialog = element('undo-dialog');
let undoToken;

const passwordPrompts = {
  export: ['암호화 백업 내보내기', '이 파일을 복원할 때 사용할 비밀번호를 정하세요.', true],
  import: ['암호화 백업 열기', '이 백업을 만들 때 정한 비밀번호를 입력하세요.', false],
  enable: ['저장소 암호화', '이 비밀번호가 있어야 저장소를 다시 열 수 있습니다. 이전에 만든 평문 백업 파일은 별도로 관리해 주세요.', true],
  disable: ['저장소 암호화 해제', '계속하면 이 기기에 남은 기록과 되돌리기 기록을 평문으로 저장합니다.', false]
};

function askPassword(action) {
  if (!workspaceReady) return;
  passwordAction = action;
  const [title, description, confirm] = passwordPrompts[action];
  element('password-title').textContent = title;
  element('password-description').textContent = description;
  element('confirm-password-field').hidden = !confirm;
  element('backup-password-confirm').required = confirm;
  element('backup-password-form').reset();
  setStatus('password-status', '');
  passwordDialog.showModal();
}

function rejectStaleView(expected) {
  if (expected !== viewGeneration || !workspaceReady || lockPending) throw new LockedError();
}

function downloadBackup(backup) {
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
  if (blob.size > MAX_BACKUP_BYTES) throw new Error('백업이 가져오기 제한인 8 MiB를 넘습니다.');
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'memo-alley-' + today() + '.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function createPreview(backup, expected) {
  const result = await readPayload();
  rejectStaleView(expected);
  const date = today();
  const { summary } = mergeImport(result.payload.state, backup, date);
  return { backup, summary, revision: result.revision, date };
}

function showPreview(next) {
  preview = next;
  const summary = next.summary;
  const list = document.createElement('dl');
  for (const [label, field] of [
    ['추가할 메모', 'newMemos'], ['바뀔 원문', 'updatedMemos'], ['새 답장', 'newReplies'],
    ['입간판 기록', 'daily'], ['추가할 소품', 'props'], ['충돌', 'conflicts']
  ]) {
    const term = document.createElement('dt');
    term.textContent = label;
    const value = document.createElement('dd');
    value.textContent = summary[field] + '개';
    list.append(term, value);
  }
  const reasons = document.createElement('ul');
  for (const reason of summary.reasons) {
    const item = document.createElement('li');
    item.textContent = reason;
    reasons.append(item);
  }
  element('import-summary').replaceChildren(list);
  if (reasons.children.length) element('import-summary').append(reasons);
  if (!previewDialog.open) {
    setStatus('import-status', '');
    previewDialog.showModal();
  }
}

element('export-backup').addEventListener('click', () => askPassword('export'));
element('enable-vault').addEventListener('click', () => askPassword('enable'));
element('disable-vault').addEventListener('click', () => askPassword('disable'));
element('backup-password-cancel').addEventListener('click', () => passwordDialog.close());
passwordDialog.addEventListener('cancel', (event) => {
  if (element('backup-password-submit').disabled) event.preventDefault();
});
passwordDialog.addEventListener('close', () => {
  if (!passwordDialog.open) {
    element('backup-password-form').reset();
    passwordAction = undefined;
    backupEnvelope = undefined;
  }
});

element('backup-password-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = element('backup-password-submit');
  if (!workspaceReady || button.disabled || !passwordAction) return;
  const expected = viewGeneration;
  const action = passwordAction;
  const password = element('backup-password').value;
  if (passwordPrompts[action][2] && password !== element('backup-password-confirm').value) {
    setStatus('password-status', '비밀번호 확인이 일치하지 않습니다.');
    return;
  }
  const envelope = backupEnvelope;
  element('backup-password-form').reset();
  button.disabled = true;
  element('backup-password-cancel').disabled = true;
  setStatus('password-status', '처리 중입니다.');
  try {
    if (action === 'export') {
      const result = await readPayload();
      rejectStaleView(expected);
      const backup = await encryptBackup(validateBackup(result.payload.state), password);
      await vaultStatus();
      await readPayload();
      rejectStaleView(expected);
      downloadBackup(backup);
      setStatus('settings-status', '암호화 백업을 내보냈어요.');
    } else if (action === 'import') {
      const backup = validateBackup(await decryptBackup(envelope, password));
      const next = await createPreview(backup, expected);
      passwordDialog.close();
      showPreview(next);
    } else {
      if (action === 'enable') await enableVault(password);
      else await disableVault(password);
      channel.postMessage('security');
      rejectStaleView(expected);
      passwordDialog.close();
      await refresh();
      setStatus('settings-status', action === 'enable' ? '저장소를 암호화했어요.' : '저장소 암호화를 해제했어요.');
    }
    if (action === 'export') passwordDialog.close();
  } catch (error) {
    if (expected === viewGeneration) setStatus('password-status', error.message || '요청을 처리하지 못했습니다.');
  } finally {
    button.disabled = false;
    element('backup-password-cancel').disabled = false;
  }
});

element('choose-backup').addEventListener('click', () => {
  if (workspaceReady) element('import-backup').click();
});
element('import-backup').addEventListener('change', async (event) => {
  const input = event.currentTarget;
  const file = input.files[0];
  const expected = viewGeneration;
  if (!workspaceReady || !file) return;
  if (file.size > MAX_BACKUP_BYTES) {
    input.value = '';
    setStatus('settings-status', '8 MiB 이하의 백업 파일을 선택해 주세요.');
    return;
  }
  const button = element('choose-backup');
  button.disabled = true;
  try {
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      throw new Error('JSON 파일을 읽지 못했습니다. 메모 골목 백업 파일을 선택해 주세요.');
    }
    rejectStaleView(expected);
    if (parsed?.format === BACKUP_FORMAT) {
      backupEnvelope = parsed;
      askPassword('import');
    } else {
      showPreview(await createPreview(validateBackup(parsed), expected));
    }
  } catch (error) {
    if (expected === viewGeneration) setStatus('settings-status', error.message || '백업을 읽지 못했습니다.');
  } finally {
    input.value = '';
    button.disabled = false;
  }
});

element('import-cancel').addEventListener('click', () => previewDialog.close());
previewDialog.addEventListener('cancel', (event) => {
  if (element('import-confirm').disabled) event.preventDefault();
});
previewDialog.addEventListener('close', () => {
  if (!previewDialog.open) {
    preview = undefined;
    element('import-summary').replaceChildren();
  }
});
element('import-confirm').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  const pending = preview;
  if (!workspaceReady || !pending || button.disabled) return;
  const expected = viewGeneration;
  const date = today();
  const token = crypto.randomUUID();
  let revised;
  let imported;
  button.disabled = true;
  element('import-cancel').disabled = true;
  try {
    const result = await readPayload((draft, payload, revision) => {
      revised = imported = undefined;
      if (revision !== pending.revision || date !== pending.date) {
        const { summary } = mergeImport(structuredClone(draft), pending.backup, date);
        revised = { backup: pending.backup, summary, revision, date };
        return false;
      }
      const plan = mergeImport(draft, pending.backup, date);
      if (!plan.undo) return false;
      validateBackup(draft);
      payload.undo = { token, ...plan.undo };
      imported = plan.summary;
    });
    rejectStaleView(expected);
    if (revised) {
      showPreview(revised);
      setStatus('import-status', '미리보기 이후 저장된 기록이 바뀌었습니다. 다시 확인해 주세요.');
      return;
    }
    previewDialog.close();
    renderPayload(result, { mode }, date);
    if (imported) channel.postMessage('changed');
    setStatus('settings-status', imported ? '백업을 가져왔어요.' : '추가하거나 바꿀 기록이 없습니다.');
  } catch (error) {
    if (expected === viewGeneration) setStatus('import-status', error.message || '가져오지 못했습니다. 기존 기록은 그대로입니다.');
  } finally {
    button.disabled = false;
    element('import-cancel').disabled = false;
  }
});

element('undo-import').addEventListener('click', async () => {
  if (!workspaceReady) return;
  const expected = viewGeneration;
  try {
    const result = await readPayload();
    rejectStaleView(expected);
    undoToken = result.payload.undo?.token;
    if (undoToken && !undoDialog.open) undoDialog.showModal();
  } catch (error) {
    if (expected === viewGeneration) setStatus('undo-result', error.message);
  }
});
element('undo-cancel').addEventListener('click', () => undoDialog.close());
undoDialog.addEventListener('cancel', (event) => {
  if (element('undo-confirm').disabled) event.preventDefault();
});
element('undo-confirm').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  if (!workspaceReady || button.disabled || !undoToken) return;
  const expected = viewGeneration;
  const token = undoToken;
  const date = today();
  let summary;
  button.disabled = true;
  element('undo-cancel').disabled = true;
  try {
    const result = await readPayload((draft, payload) => {
      if (payload.undo?.token !== token) throw new Error('다른 탭에서 가져오기 기록이 바뀌었습니다. 다시 확인해 주세요.');
      summary = undoImport(draft, payload.undo, date);
      payload.undo = null;
    });
    rejectStaleView(expected);
    undoDialog.close();
    renderPayload(result, { mode }, date);
    channel.postMessage('changed');
    const message = '가져오기를 되돌렸어요. 제거한 메모 ' + summary.memos + '개, 복원한 원문 '
      + summary.originals + '개, 제거한 답장 ' + summary.replies + '개.';
    setStatus('undo-result', summary.conflicts ? message + ' 충돌 ' + summary.conflicts + '건. ' + summary.reasons.join(' ') : message);
  } catch (error) {
    if (expected === viewGeneration) {
      undoDialog.close();
      setStatus('undo-result', error.message || '가져오기를 되돌리지 못했습니다.');
    }
  } finally {
    button.disabled = false;
    element('undo-cancel').disabled = false;
  }
});

element('lock-vault').addEventListener('click', async () => {
  if (!workspaceReady || lockPending || mode !== 'encrypted') return;
  lockPending = true;
  clearSensitive(true);
  element('unlock-submit').disabled = true;
  try {
    await lockVault();
  } catch {
    setStatus('unlock-status', '잠금 상태를 저장하지 못했습니다. 열린 메모 골목 탭을 모두 닫아 주세요.');
  } finally {
    channel.postMessage('security');
    lockPending = false;
    element('unlock-submit').disabled = false;
    element('unlock-password').focus();
    refresh();
  }
});

element('unlock-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = element('unlock-submit');
  if (lockPending || button.disabled || element('lock-screen').hidden) return;
  const expected = viewGeneration;
  const input = element('unlock-password');
  const password = input.value;
  input.value = '';
  button.disabled = true;
  try {
    await unlockVault(password);
    if (expected !== viewGeneration) return;
    await refresh();
    if (workspaceReady) element('memo-input').focus();
  } catch (error) {
    if (expected === viewGeneration) {
      setStatus('unlock-status', error.message || '저장소를 열지 못했습니다.');
      input.focus();
    }
  } finally {
    button.disabled = false;
  }
});

channel.addEventListener('message', (event) => {
  if (event.data === 'security') {
    dropVaultKey();
    clearSensitive(mode === 'encrypted');
  }
  refresh();
});
window.addEventListener('focus', refresh);
window.addEventListener('pageshow', refresh);
window.addEventListener('pagehide', () => {
  if (mode === 'encrypted') {
    dropVaultKey();
    clearSensitive(true);
  }
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
setInterval(async () => {
  if (lockPending) return;
  try {
    const security = await vaultStatus();
    if (today() !== displayedDate || security.mode !== mode || (security.locked && workspaceReady)) refresh();
  } catch {
    // The initial refresh owns database startup messages.
  }
}, 5000);
refresh();
