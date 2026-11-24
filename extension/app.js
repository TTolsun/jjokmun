import { localDate, validDate, emptyState, selectDaily, PROP_KINDS } from './store.js';
import { LockedError, readPayload, vaultStatus, dropVaultKey, lockVault, unlockVault } from './vault.js';
import { createTime, element, formatDate, longDate } from './ui/dom.js';
import { newestMemos, renderArchive } from './ui/archive.js';
import { bindBackupDialogs } from './ui/backup-dialogs.js';
import { bindReplyDialog } from './ui/reply-dialog.js';

const channel = new BroadcastChannel('memo-alley');
const requestedDate = new URLSearchParams(location.search).get('date');
const today = () => validDate(requestedDate) ? requestedDate : localDate();
let state = emptyState();
let displayedDate;
let detailId;
let linkedReply;
let returnFocus;
let confirmedReplyCount;
let initialView = true;
let pendingRefresh = Promise.resolve();
let workspaceReady = false;
let mode;
let viewGeneration = 0;
let lockPending = false;
let renderedRevision = -1;
const workspace = document.querySelector('.workspace');
const header = document.querySelector('.site-header');
const replyDialog = bindReplyDialog(change);

function currentMemo() {
  return state.memos.find((memo) => memo.id === detailId);
}

function setStatus(id, message) {
  if (!workspaceReady && !['startup-status', 'unlock-status'].includes(id)) return;
  element(id).textContent = message;
}

function clearSensitive(showLock) {
  viewGeneration += 1;
  workspaceReady = false;
  workspace.hidden = true;
  header.hidden = true;
  element('lock-screen').hidden = !showLock;
  element('startup-status').hidden = showLock;
  if (!showLock) setStatus('startup-status', 'jjokmun을 여는 중입니다.');
  replyDialog.reset();
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  for (const id of ['memo-input', 'archive-search', 'reply-input', 'edit-input']) element(id).value = '';
  for (const id of ['detail-original', 'detail-date', 'detail-replies', 'daily-excerpt', 'archive-list',
    'detail-status', 'copy-status', 'home-status', 'archive-status', 'settings-status',
    'delete-message', 'vault-state', 'unlock-status']) {
    element(id).replaceChildren();
  }
  element('detail-date').removeAttribute('datetime');
  element('scene-board').hidden = true;
  element('daily-board').hidden = true;
  element('detail-dialog').hidden = true;
  element('edit-form').hidden = true;
  element('memo-count').textContent = '0';
  element('prop-count').textContent = `0 / ${PROP_KINDS.length}`;
  element('prop-progress').value = 0;
  for (const kind of PROP_KINDS) {
    for (const node of [element('prop-' + kind), element('collection-' + kind).querySelector('.sprite')]) {
      for (const animation of node.getAnimations()) animation.cancel();
    }
    element('prop-' + kind).hidden = true;
    element('collection-' + kind).disabled = true;
  }
  element('unlock-form').reset();
  clearBackupDialogs();
  state = emptyState();
  renderedRevision = -1;
  detailId = linkedReply = returnFocus = confirmedReplyCount = displayedDate = undefined;
  initialView = true;
  if (showLock && !lockPending) element('unlock-password').focus();
}

function renderPayload(result, date, storageMode = mode) {
  if (result.revision < renderedRevision) return;
  renderedRevision = result.revision;
  mode = storageMode;
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
  pendingRefresh = pendingRefresh.then(async () => {
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
    if (expected === viewGeneration) renderPayload(result, date, security.mode);
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
  return pendingRefresh;
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
  renderPayload(result, date);
  channel.postMessage('changed');
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

  const sorted = newestMemos(state.memos);
  if (initialView) {
    initialView = false;
    if (!detailId) detailId = sorted[0]?.id;
  }
  if (detailId && !currentMemo()) {
    element('delete-dialog').close();
    closeDetail(element('detail-dialog').contains(document.activeElement));
    return;
  }
  renderArchive(sorted, detailId, openDetail);
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

function renderDetail() {
  const memo = currentMemo();
  const time = element('detail-date');
  time.dateTime = memo.createdOn;
  time.textContent = formatDate(memo.createdOn);
  element('detail-original').textContent = memo.text;
  const replies = [...memo.replies].sort((a, b) => a.createdOn.localeCompare(b.createdOn) || a.createdAt - b.createdAt);
  const container = element('detail-replies');
  const focused = container.contains(document.activeElement) ? document.activeElement : undefined;
  container.replaceChildren();
  if (!replies.length) return;
  const label = document.createElement('h3');
  label.textContent = '답장';
  container.append(label);
  for (const reply of replies) {
    const article = document.createElement('article');
    article.dataset.replyId = reply.id;
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
    const actions = element('reply-actions-template').content.cloneNode(true);
    for (const button of actions.querySelectorAll('button')) {
      const action = button.dataset.action;
      button.addEventListener('click', () => {
        if (action === 'copy') copyText(reply.text);
        else replyDialog.open(action, memo.id, reply, state.props);
      });
    }
    header.append(createTime(reply.createdOn), actions);
    article.append(header, text);
    container.append(article);
    if (reply.id === focused?.closest('article')?.dataset.replyId && focused.dataset.action) {
      article.querySelector(`[data-action="${focused.dataset.action}"]`).focus({ preventScroll: true });
    }
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

function refreshArchive() {
  if (workspaceReady) renderArchive(newestMemos(state.memos), detailId, openDetail);
}

element('archive-search').addEventListener('input', refreshArchive);

function openDetail(id, replyId, source) {
  if (!state.memos.some((memo) => memo.id === id)) return;
  if (detailId !== id) {
    replyDialog.reset();
    element('reply-input').value = '';
    element('edit-form').hidden = true;
    setStatus('detail-status', '');
    setStatus('copy-status', '');
  }
  detailId = id;
  linkedReply = replyId;
  returnFocus = source;
  renderSelection();
  refreshArchive();
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
  replyDialog.reset();
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
  refreshArchive();
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

const clearBackupDialogs = bindBackupDialogs({
  activeView: () => workspaceReady && !lockPending ? viewGeneration : undefined,
  today,
  setStatus,
  channel,
  refresh,
  renderResult: renderPayload
});

element('lock-vault').addEventListener('click', async () => {
  if (!workspaceReady || lockPending || mode !== 'encrypted') return;
  lockPending = true;
  clearSensitive(true);
  element('unlock-submit').disabled = true;
  try {
    await lockVault();
  } catch {
    setStatus('unlock-status', '잠금 상태를 저장하지 못했습니다. 열린 jjokmun 탭을 모두 닫아 주세요.');
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
