import { localDate, validDate, emptyState, selectDaily } from './store.js';
import { LockedError, readPayload, vaultStatus, dropVaultKey, lockVault, unlockVault } from './vault.js';
import { createTime, element, formatDate, longDate, memoExcerpt } from './ui/dom.js';
import { focusArchiveReturn, newestMemos, renderArchive, resetArchive } from './ui/archive.js';
import { bindBackupDialogs } from './ui/backup-dialogs.js';
import { bindReplyDialog } from './ui/reply-dialog.js';
import { DocumentConflictError, DocumentWriteError, folderConnection, copyVaultToFolder, useFolder, reconnectFolder, relinkDocument } from './vault.js';
import { readLastFolder } from './last-folder.js';
import { FolderAccessError } from './folder.js';
import { checkMemoSize, detectFormat, documentChanged } from './documents.js';
import { bindFolderFiles } from './ui/folder-files.js';
import { applyMemoCare, applyPetAction, petHatched, petSubject, petView, PET_FORM_DETAILS } from './pet.js';
import { bindPet } from './ui/pet.js';
import { bindDocumentPreview } from './ui/document-preview.js';
import { bindEditorReturn } from './ui/editor-return.js';
import { bindReplyPreviews } from './ui/reply-previews.js';

const channel = new BroadcastChannel('memo-alley');
const requestedDate = new URLSearchParams(location.search).get('date');
const today = () => validDate(requestedDate) ? requestedDate : localDate();
let state = emptyState();
let displayedDate;
let readPetMemoId;
let detailId;
let detailExpanded = false;
let linkedReply;
let returnFocus;
let confirmedReplyCount;
let confirmedDocument;
let editBase;
let editSession;
let pendingRefresh = Promise.resolve();
let pendingArchiveChoice;
let workspaceReady = false;
let mode;
let viewGeneration = 0;
let lockPending = false;
let renderedRevision = -1;
const workspace = document.querySelector('.workspace');
const header = document.querySelector('.site-header');
const replyDialog = bindReplyDialog(change);
const editorReturn = bindEditorReturn(id => {
  if (!workspaceReady || lockPending) return undefined;
  if (id === 'memo-input') return viewGeneration;
  const memo = currentMemo();
  if (!memo) return undefined;
  if (id === 'edit-input') return memo.documentMissing ? undefined : editSession;
  if (id === 'reply-input') return memo.id;
  return replyDialog.editorContext(memo);
});
const pet = bindPet(change, textSaveError, editorReturn);
function documentAt(path) {
  return state.memos.find(memo => memo.documentPath === path && !memo.documentMissing);
}

function openDocumentAt(path, source) {
  const memo = documentAt(path);
  if (memo) openArchiveDetail(memo.id, undefined, source);
}

const folderFiles = bindFolderFiles({
  canOpenMemo: path => mode === 'plain' && Boolean(documentAt(path)),
  openMemo: openDocumentAt
});
const previewSources = {
  folder: () => mode === 'plain' ? folderConnection()?.directory : undefined,
  hasDocument: path => Boolean(documentAt(path)),
  openDocument: openDocumentAt
};
const documentPreview = bindDocumentPreview(previewSources);
const replyPreviews = bindReplyPreviews(previewSources);

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
  editorReturn.reset();
  workspace.hidden = true;
  pendingArchiveChoice = undefined;
  for (const details of document.querySelectorAll('.journal-disclosure[open]')) details.open = false;
  header.hidden = true;
  element('lock-screen').hidden = !showLock;
  element('startup-status').hidden = showLock;
  if (!showLock) setStatus('startup-status', '메모고치를 여는 중입니다.');
  replyDialog.reset();
  pet.reset();
  folderFiles.reset();
  documentPreview.reset();
  replyPreviews.reset();
  resetEdit();
  resetArchive();
  element('folder-start-status').textContent = '';
  element('storage-recovery').hidden = true;
  element('storage-start').hidden = true;
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  for (const id of ['memo-input', 'archive-search', 'reply-input', 'edit-input']) element(id).value = '';
  for (const id of ['detail-original', 'detail-date', 'detail-replies', 'archive-list',
    'detail-status', 'copy-status', 'home-status', 'archive-status', 'settings-status',
    'delete-message', 'vault-state', 'unlock-status', 'detail-path', 'document-path-choice', 'document-refresh-status',
    'found-note-title', 'found-note-date', 'found-note-excerpt', 'found-note-hint']) {
    element(id).replaceChildren();
  }
  element('found-note').hidden = true;
  element('found-note-hint').hidden = true;
  element('pet-expand').classList.remove('has-note');
  element('detail-date').removeAttribute('datetime');
  element('detail-dialog').hidden = true;
  element('edit-form').hidden = true;
  element('memo-count').textContent = '0';
  element('unlock-form').reset();
  clearBackupDialogs();
  state = emptyState();
  renderedRevision = -1;
  detailId = linkedReply = returnFocus = confirmedReplyCount = confirmedDocument = displayedDate = readPetMemoId = undefined;
  detailExpanded = false;
  if (showLock && !lockPending) element('unlock-password').focus();
}

function renderPayload(result, date, storageMode = mode) {
  if (result.revision < renderedRevision) return;
  renderedRevision = result.revision;
  mode = storageMode;
  state = result.payload.state;
  const resumed = !workspaceReady;
  workspaceReady = true;
  workspace.hidden = false;
  header.hidden = false;
  element('lock-screen').hidden = true;
  element('startup-status').hidden = true;
  element('undo-import').disabled = !result.payload.undo;
  const encrypted = mode === 'encrypted';
  for (const notice of document.querySelectorAll('.legacy-writing')) notice.hidden = !encrypted;
  element('memo-form').hidden = encrypted;
  document.querySelector('label[for="memo-input"]').hidden = encrypted;
  element('copy-vault').hidden = !encrypted;
  element('lock-vault').hidden = mode !== 'encrypted';
  element('refresh-documents').hidden = mode !== 'plain';
  setStatus('vault-state', mode === 'encrypted'
    ? '메모고치 저장 파일에 메모를 암호화해 저장합니다. 폴더에 남은 .md와 .txt 파일은 계속 열 수 있습니다.'
    : '새 메모는 저장 폴더에 파일로 저장됩니다. 답장과 펫 기록은 메모고치 저장 파일에 남습니다.');
  render(date);
  if (resumed && ['#journal', '#pet'].includes(location.hash)) {
    element(location.hash.slice(1)).scrollIntoView();
  }
}

function refresh() {
  let expected;
  pendingRefresh = pendingRefresh.then(async () => {
    if (lockPending) return;
    if (!folderConnection()) {
      element('storage-start').hidden = false;
      element('startup-status').hidden = true;
      return;
    }
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
    // A hatched pet finds one older memo a day. The pick is stored so the least recently found
    // memo comes next and every tab sees the same note.
    if (petHatched(result.payload.state.pet) && !result.payload.state.daily.some(entry => entry.date === date)) {
      result = await readPayload(draft => {
        if (draft.daily.some(entry => entry.date === date)) return false;
        selectDaily(draft, date);
      });
    }
    const connection = folderConnection();
    if (expected === viewGeneration) {
      element('storage-recovery').hidden = true;
      renderPayload(result, date, security.mode);
      folderFiles.update(connection);
      return true;
    }
  }).catch((error) => {
    if (expected !== viewGeneration) return;
    if (error instanceof FolderAccessError) {
      if (element('storage-recovery').hidden) clearSensitive(false);
      element('storage-recovery').hidden = false;
      setStatus('startup-status', error.message);
    } else if (error instanceof LockedError) {
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
  let changed = false;
  const result = await readPayload(draft => {
    changed = mutator(draft, date) !== false;
    return changed;
  });
  if (expected !== viewGeneration) throw new LockedError();
  renderPayload(result, date);
  if (changed) announce('changed');
}

function render(date) {
  displayedDate = date;
  pet.render(state.pet);
  renderPetMemo();
  renderFoundNote(date);
  element('today-date').textContent = formatDate(date, longDate);
  const sorted = newestMemos(state.memos);
  if (detailId && !currentMemo()) {
    element('delete-dialog').close();
    closeDetail(element('detail-dialog').contains(document.activeElement));
    return;
  }
  renderArchive(sorted, detailExpanded ? detailId : undefined, openArchiveDetail);
  renderSelection();
}

function bindTextForm(formId, inputId, buttonId, statusId, onSubmit, readText = input => input.value.trim()) {
  const form = element(formId);
  const input = element(inputId);
  const button = element(buttonId);
  let composing = false;
  let pending = false;
  input.addEventListener('compositionstart', () => { composing = true; });
  input.addEventListener('compositionend', () => { composing = false; });
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    if (composing || event.isComposing || event.keyCode === 229) {
      // An Enter that ends an IME syllable (Korean, on Windows Chrome) arrives only as this
      // composing keydown, so a textarea line break must not be cancelled here.
      if (input.localName === 'textarea' && (event.shiftKey || !('enterSubmits' in input.dataset))) return;
      event.preventDefault();
    } else if ('enterSubmits' in input.dataset && !event.shiftKey) {
      // Memo fields are textareas that still save on Enter; Shift+Enter adds a line.
      event.preventDefault();
      form.requestSubmit();
    }
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (composing || pending) return;
    const original = input.value;
    const text = readText(input);
    if (input.required && !text.trim()) {
      setStatus(statusId, '내용을 적어 주세요.');
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
      if (message && expected === viewGeneration && (!inDetail || detailId === revision)) {
        if (input.value === original) input.value = '';
        setStatus(statusId, message);
      }
    } catch (error) {
      if (expected === viewGeneration) {
        setStatus(statusId, textSaveError(error));
      }
    } finally {
      pending = false;
      button.disabled = false;
    }
  });
}

function textSaveError(error) {
  if (error instanceof FolderAccessError || error instanceof DocumentWriteError || error instanceof DocumentConflictError
    || error.message === '목록에서 이 메모를 찾을 수 없습니다.') return error.message;
  if (error.name === 'NotAllowedError') return '저장 폴더에 쓰려면 접근을 다시 허용해 주세요.';
  if (error.name === 'QuotaExceededError') return '저장 공간이 부족합니다. 공간을 확보한 뒤 다시 시도해 주세요.';
  return '저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.';
}

function newMemo(text, date) {
  if (mode === 'encrypted') throw new DocumentWriteError('새 메모를 쓰려면 먼저 일반 폴더로 복사해 주세요.');
  checkMemoSize(text);
  const now = Date.now();
  return { id: crypto.randomUUID(), text, documentFormat: detectFormat(text), createdOn: date, createdAt: now, updatedAt: now, replies: [] };
}

bindTextForm('memo-form', 'memo-input', 'memo-save', 'home-status', async (text) => {
  let id;
  let care;
  const previousId = detailId;
  await change((draft, date) => {
    const memo = newMemo(text, date);
    draft.memos.push(memo);
    id = memo.id;
    care = applyMemoCare(draft, 'write', date);
  });
  if (detailId === previousId) openDetail(id);
  if (document.activeElement === document.body) element('memo-input').focus();
  if (care) pet.readMemo(care);
  return care ? '메모를 남겼어요. ' + care : '메모를 남겼어요.';
}, input => input.value);

// The note the pet found today, unless it was put back or its memo is gone.
function foundNote(date = displayedDate) {
  if (!petHatched(state.pet)) return undefined;
  const entry = state.daily.find(record => record.date === date);
  const memo = entry && !entry.folded && state.memos.find(record => record.id === entry.memoId);
  if (!memo) return undefined;
  return { memo, answered: memo.replies.some(reply => reply.createdOn === date) };
}

function petName() {
  return PET_FORM_DETAILS[petView(state.pet)?.form]?.name ?? '펫';
}

function daysBetween(from, to) {
  return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);
}

function renderFoundNote(date) {
  const note = foundNote(date);
  const card = element('found-note');
  card.hidden = !note;
  const waiting = Boolean(note && !note.answered);
  const trigger = element('pet-expand');
  trigger.classList.toggle('has-note', waiting);
  trigger.setAttribute('aria-label', waiting ? '정원 기기 확대 · 펫이 쪽지를 찾아왔어요' : '정원 기기 확대');
  renderFoundNoteHint(note);
  if (!note) {
    for (const id of ['found-note-title', 'found-note-date', 'found-note-excerpt']) element(id).replaceChildren();
    return;
  }
  const { memo, answered } = note;
  const name = petSubject(petName());
  card.classList.toggle('answered', answered);
  element('found-note-pet').src = element('pet-summary-sprite').getAttribute('src') || 'art/egg.png';
  element('found-note-title').textContent = answered
    ? `${name} 찾아온 쪽지에 오늘 답장했어요`
    : `${name} 정원에서 묻어 둔 쪽지를 찾아왔어요`;
  const [, month, day] = memo.createdOn.split('-').map(Number);
  const time = element('found-note-date');
  time.dateTime = memo.createdOn;
  time.textContent = `${month}월 ${day}일에 쓴 메모 · ${daysBetween(memo.createdOn, date)}일 전`;
  element('found-note-excerpt').textContent = memoExcerpt(memo, 120);
  element('found-note-open').textContent = answered ? '다시 보기' : '다시 읽고 답장';
  element('found-note-fold').hidden = answered;
}

function renderFoundNoteHint(note = foundNote()) {
  const hint = element('found-note-hint');
  hint.hidden = !note || note.answered || note.memo.id !== detailId;
  hint.textContent = hint.hidden ? '' : `${petSubject(petName())} 찾아온 쪽지예요. 답장을 남기면 ${petSubject(petName())} 기뻐해요.`;
}

element('found-note-open').addEventListener('click', event => {
  const note = foundNote();
  if (!note) return;
  openDetail(note.memo.id, undefined, event.currentTarget);
  if (!note.answered && !element('reply-form').closest('[hidden]')) element('reply-input').focus();
});

element('found-note-fold').addEventListener('click', async event => {
  const button = event.currentTarget;
  const expected = viewGeneration;
  button.disabled = true;
  try {
    await change((draft, date) => {
      const entry = selectDaily(draft, date);
      if (entry.folded) return false;
      entry.folded = true;
    });
    if (expected === viewGeneration) {
      setStatus('home-status', '쪽지를 정원에 다시 묻어 두었어요.');
      element('memo-input').focus();
    }
  } catch (error) {
    if (expected === viewGeneration) setStatus('home-status', textSaveError(error));
  } finally {
    button.disabled = false;
  }
});

function renderPetMemo() {
  if (state.pet?.form === 'egg') readPetMemoId = undefined;
  const memo = state.memos.find(record => record.id === readPetMemoId);
  const quote = element('pet-memo-excerpt');
  quote.hidden = !memo || Boolean(memo.documentMissing);
  quote.textContent = quote.hidden ? '' : memoExcerpt(memo, 160);
}

element('pet-read-memo').addEventListener('click', async event => {
  const button = event.currentTarget;
  if (button.disabled) return;
  button.disabled = true;
  const expected = viewGeneration;
  const id = detailId;
  try {
    let result;
    await change(draft => {
      if (findMemo(draft, id).documentMissing) return false;
      result = applyPetAction(draft, 'memo');
      return result.changed;
    });
    if (expected !== viewGeneration || detailId !== id || !result) return;
    const ready = petView(state.pet)?.available.includes('memo');
    if (!ready && !result.changed) {
      setStatus('detail-status', result.event || '펫이 깨어 있을 때 메모를 읽어 줄 수 있어요.');
      return;
    }
    readPetMemoId = id;
    renderPetMemo();
    pet.readMemo(result.event);
    setStatus('detail-status', result.event);
  } catch (error) {
    if (expected === viewGeneration && detailId === id) setStatus('detail-status', textSaveError(error));
  } finally {
    button.disabled = false;
  }
});

function findMemo(draft, id) {
  const memo = draft.memos.find((record) => record.id === id);
  if (!memo) throw new Error('목록에서 이 메모를 찾을 수 없습니다.');
  return memo;
}

bindTextForm('reply-form', 'reply-input', 'reply-save', 'detail-status', async (text) => {
  const replyId = crypto.randomUUID();
  const memoId = detailId;
  let care;
  await change((draft, date) => {
    const memo = findMemo(draft, memoId);
    if (memo.replies.some((reply) => reply.id === replyId)) return;
    memo.replies.push({ id: replyId, text, createdOn: date, createdAt: Date.now() });
    // Only rereading counts: a reply on the day the memo was written is not a revisit.
    const found = draft.daily.some(entry => entry.date === date && entry.memoId === memoId && !entry.folded);
    care = found ? applyMemoCare(draft, 'found', date)
      : memo.createdOn < date ? applyMemoCare(draft, 'revisit', date) : '';
  });
  if (detailId === memoId && document.activeElement === document.body) element('reply-input').focus();
  if (care) pet.readMemo(care);
  return care ? '답장을 저장했어요. ' + care : '답장을 저장했어요.';
});

bindTextForm('edit-form', 'edit-input', 'edit-save', 'detail-status', async (text) => {
  const id = detailId;
  const expected = viewGeneration;
  const base = editBase;
  if (!base || base.id !== id || !element('edit-conflict').hidden) return;
  let conflicted = false;
  try {
    await change((draft) => {
      const memo = findMemo(draft, id);
      if (base.documentPath && !sameDocument(base, memo)) {
        conflicted = true;
        return false;
      }
      if (memo.text === text || (base.documentPath && text === base.text.replace(/\r\n?/g, '\n'))) return false;
      if (!base.documentPath) checkMemoSize(text);
      memo.text = text;
      memo.updatedAt = Math.min(8640000000000000, Math.max(Date.now(), memo.updatedAt + 1));
    });
  } catch (error) {
    if (!(error instanceof DocumentConflictError)) throw error;
    await refresh();
    conflicted = true;
  }
  if (expected !== viewGeneration || editBase !== base) return;
  if (conflicted) {
    element('edit-conflict').hidden = false;
    element('edit-save').hidden = true;
    renderEditConflict(currentMemo());
    element('keep-edit-draft').focus();
    setStatus('detail-status', '파일과 작성본을 비교한 뒤 계속해 주세요.');
    return;
  }
  hideEdit();
  return '메모를 수정했어요.';
}, input => editBase?.documentPath || input.value.trim() ? input.value : '');

function sameDocument(previous, current) {
  return !current.documentMissing && current.text === previous.text && current.updatedAt === previous.updatedAt
    && current.documentPath === previous.documentPath;
}

function renderEditConflict(memo) {
  if (element('edit-conflict').hidden) return;
  const available = memo?.documentPath && !memo.documentMissing;
  element('edit-conflict-draft').textContent = element('edit-input').value;
  element('edit-conflict-disk').textContent = available ? memo.text : '파일을 찾거나 읽을 수 없습니다.';
  element('use-disk-edit').disabled = !available;
}

function renderRelink(memo) {
  const form = element('relink-document');
  const choices = memo.documentMissing ? state.memos.filter(note => note.documentRelinkable && !note.documentMissing) : [];
  form.hidden = !choices.length;
  const input = element('document-path-choice');
  const previous = input.value;
  const prompt = new Option('파일 선택', '');
  input.replaceChildren(prompt, ...choices
    .sort((a, b) => a.documentPath.localeCompare(b.documentPath, 'ko'))
    .map(note => new Option(note.documentPath, note.documentPath)));
  if (choices.some(note => note.documentPath === previous)) input.value = previous;
}

element('relink-document').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = element('relink-document-submit');
  const id = detailId;
  const expected = viewGeneration;
  const path = element('document-path-choice').value;
  if (!workspaceReady || lockPending || button.disabled || !currentMemo()?.documentMissing || !path) return;
  button.disabled = true;
  try {
    const result = await relinkDocument(id, path);
    if (expected !== viewGeneration) return;
    renderPayload(result, today());
    announce('changed');
    if (detailId === id) {
      element('detail-title').focus();
      setStatus('detail-status', '파일을 다시 연결했어요.');
    }
  } catch (error) {
    if (expected === viewGeneration && detailId === id) {
      setStatus('detail-status', textSaveError(error));
    }
  } finally {
    button.disabled = false;
  }
});

function renderDetail() {
  const memo = currentMemo();
  renderFoundNoteHint();
  const time = element('detail-date');
  time.dateTime = memo.createdOn;
  time.textContent = formatDate(memo.createdOn);
  const path = element('detail-path');
  path.hidden = !memo.documentPath;
  path.textContent = memo.documentPath || '';
  element('document-missing').hidden = !memo.documentMissing;
  element('copy-memo').disabled = Boolean(memo.documentMissing);
  element('edit-memo').disabled = Boolean(memo.documentMissing);
  const petState = petView(state.pet);
  element('pet-read-memo').hidden = Boolean(memo.documentMissing) || !petState || petState.form === 'egg';
  renderRelink(memo);
  renderEditConflict(memo);
  element('detail-original').textContent = memo.text;
  documentPreview.update(memo);
  const replies = [...memo.replies].sort((a, b) => a.createdOn.localeCompare(b.createdOn) || a.createdAt - b.createdAt);
  const container = element('detail-replies');
  const focused = container.contains(document.activeElement) ? document.activeElement : undefined;
  container.replaceChildren();
  replyPreviews.prune(new Set(replies.map(reply => reply.id)));
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
      tag.textContent = '검색어가 있는 답장';
      article.append(tag);
    }
    const text = replyPreviews.bodyFor(reply, memo);
    const header = document.createElement('div');
    header.className = 'reply-heading';
    const actions = element('reply-actions-template').content.cloneNode(true);
    for (const button of actions.querySelectorAll('button')) {
      const action = button.dataset.action;
      button.addEventListener('click', () => {
        if (action === 'copy') copyText(reply.text);
        else replyDialog.open(action, memo.id, reply);
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
  if (workspaceReady) renderArchive(newestMemos(state.memos), detailExpanded ? detailId : undefined, openArchiveDetail);
}

element('archive-search').addEventListener('input', refreshArchive);
element('refresh-documents').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  const expected = viewGeneration;
  button.disabled = true;
  setStatus('document-refresh-status', '폴더 문서를 읽는 중입니다.');
  try {
    const refreshed = await refresh();
    if (expected === viewGeneration) {
      setStatus('document-refresh-status', refreshed ? '폴더 문서를 다시 읽었어요.' : '폴더 문서를 읽지 못했습니다. 폴더의 접근 권한을 확인해 주세요.');
    }
  } finally {
    button.disabled = false;
  }
});

function openDetail(id, replyId, source) {
  pendingArchiveChoice = undefined;
  if (!state.memos.some((memo) => memo.id === id)) return;
  if (detailId !== id) {
    setStatus('home-status', '');
    replyDialog.reset();
    element('reply-input').value = '';
    element('document-path-choice').value = '';
    resetEdit();
    setStatus('detail-status', '');
    setStatus('copy-status', '');
  }
  detailId = id;
  detailExpanded = true;
  linkedReply = replyId;
  returnFocus = source;
  renderSelection();
  refreshArchive();
  if (source) {
    const title = element('detail-title');
    title.focus({ preventScroll: true });
    title.scrollIntoView({ block: 'start', inline: 'nearest' });
  }
}

function openArchiveDetail(id, replyId, source) {
  if (source?.matches('.archive-entry') && detailExpanded && detailId === id && linkedReply === replyId) {
    detailExpanded = false;
    renderSelection();
    refreshArchive();
    focusArchiveReturn(id);
    return;
  }
  openDetail(id, replyId, source);
  const memo = currentMemo();
  const directory = folderConnection()?.directory;
  if (mode !== 'plain' || memo?.id !== id || !memo.documentPath || !directory) return;
  const choice = {};
  pendingArchiveChoice = choice;
  documentChanged(directory, memo).then(changed => {
    if (changed && pendingArchiveChoice === choice) refresh();
  }).catch(() => {
    if (pendingArchiveChoice === choice) refresh();
  });
}

function renderSelection() {
  const hasMemo = detailExpanded && Boolean(currentMemo());
  element('detail-dialog').hidden = !hasMemo;
  if (hasMemo) renderDetail();
  else {
    documentPreview.reset();
    replyPreviews.reset();
  }
}

function closeDetail(restoreFocus = true) {
  pendingArchiveChoice = undefined;
  replyDialog.reset();
  if (restoreFocus && returnFocus?.dataset.memoId) {
    focusArchiveReturn(detailId);
  } else if (restoreFocus && returnFocus?.isConnected && !returnFocus.closest('[hidden]') && !returnFocus.disabled) {
    returnFocus.focus();
  } else if (restoreFocus) {
    element('memo-input').focus();
  }
  detailId = undefined;
  detailExpanded = false;
  linkedReply = undefined;
  returnFocus = undefined;
  element('reply-input').value = '';
  resetEdit();
  setStatus('detail-status', '');
  setStatus('copy-status', '');
  renderSelection();
  refreshArchive();
}

element('edit-memo').addEventListener('click', () => {
  const memo = currentMemo();
  if (!memo || memo.documentMissing) return;
  if (element('edit-form').hidden) startEdit(memo);
  element('edit-input').focus();
});

function startEdit(memo) {
  resetEdit();
  editBase = memo;
  editSession = Symbol();
  const input = element('edit-input');
  input.value = memo.text;
  input.required = !memo.documentPath;
  if (memo.documentPath || memo.text.length > 2000) input.removeAttribute('maxlength');
  else input.maxLength = 2000;
  element('edit-form').hidden = false;
  setStatus('detail-status', '');
}

function resetEdit() {
  editBase = editSession = undefined;
  element('edit-form').hidden = true;
  element('edit-save').hidden = false;
  element('edit-input').value = '';
  element('edit-conflict').hidden = true;
  element('edit-conflict-draft').textContent = '';
  element('edit-conflict-disk').textContent = '';
}

function hideEdit() {
  resetEdit();
  (element('edit-memo').disabled ? element('detail-title') : element('edit-memo')).focus();
}
element('edit-cancel').addEventListener('click', hideEdit);
element('edit-input').addEventListener('input', () => renderEditConflict(currentMemo()));
element('use-disk-edit').addEventListener('click', () => {
  const memo = currentMemo();
  if (!memo?.documentPath || memo.documentMissing) return;
  startEdit(memo);
  element('edit-input').focus();
});
element('keep-edit-draft').addEventListener('click', async event => {
  const button = event.currentTarget;
  const id = detailId;
  const expected = viewGeneration;
  const base = editBase;
  const text = element('edit-input').value;
  let newId;
  if (!base || base.id !== id || button.disabled || element('edit-conflict').hidden) return;
  button.disabled = true;
  try {
    await change((draft, date) => {
      const memo = newMemo(text, date);
      draft.memos.push(memo);
      newId = memo.id;
    });
    if (expected === viewGeneration && editBase === base && element('edit-input').value === text) {
      openDetail(newId);
      element('detail-title').focus();
      setStatus('detail-status', '작성본을 새 메모로 저장했어요.');
    }
  } catch (error) {
    if (expected === viewGeneration && editBase === base) {
      setStatus('detail-status', textSaveError(error));
    }
  } finally {
    button.disabled = false;
  }
});

function describeDeletion(memo, changed = false) {
  const count = memo.replies.length;
  confirmedReplyCount = count;
  confirmedDocument = memo.documentPath ? memo : undefined;
  const message = count
    ? `메모에 남긴 답장 ${count}개가 함께 삭제됩니다.`
    : '이 메모에는 답장이 없습니다. 삭제한 메모는 되돌릴 수 없습니다.';
  const summary = memo.documentPath ? message + (memo.documentMissing
    ? ' 사라진 파일에 연결된 메모 기록을 지웁니다.'
    : ' 전체 메모에서 지우고 폴더의 원본 파일은 보관합니다.') : message;
  const changedMessage = memo.documentPath ? '메모가 바뀌었습니다.' : '답장 수가 바뀌었습니다.';
  element('delete-message').textContent = changed ? `${changedMessage} ${summary} 삭제하려면 다시 확인해 주세요.` : summary;
}

element('delete-memo').addEventListener('click', () => {
  describeDeletion(currentMemo());
  element('delete-dialog').showModal();
});

element('delete-confirm').addEventListener('click', async () => {
  const id = detailId;
  const expectedCount = confirmedReplyCount;
  const base = confirmedDocument;
  const button = element('delete-confirm');
  let updatedMemo;
  button.disabled = true;
  try {
    await change((draft) => {
      const memo = draft.memos.find((record) => record.id === id);
      if (!memo) return;
      if (memo.replies.length !== expectedCount || (base && (
        memo.documentMissing !== base.documentMissing || memo.text !== base.text ||
        memo.updatedAt !== base.updatedAt || memo.documentPath !== base.documentPath
      ))) {
        updatedMemo = memo;
        return false;
      }
      draft.memos = draft.memos.filter((memo) => memo.id !== id);
      if (draft.shop?.displayMemoId === id) delete draft.shop.displayMemoId;
      if (draft.shop?.guestMemoId === id) {
        delete draft.shop.guestMemoId;
        delete draft.shop.guestReplyId;
      }
      draft.props = draft.props.filter((prop) => prop.memoId !== id);
      for (const entry of draft.daily) {
        if (entry.memoId !== id) continue;
        entry.memoId = null;
        entry.folded = true;
      }
    });
    if (updatedMemo) {
      if (element('delete-dialog').open && detailId === id) {
        describeDeletion(updatedMemo, true);
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

let lastDirectory;

function reopenLastFolder() {
  return useFolder(lastDirectory, { reopen: true, remember: false });
}

function showLastFolderError(error) {
  const name = lastDirectory.name;
  element('reopen-last-folder').hidden = false;
  element('reopen-last-folder').textContent = name + ' 다시 연결';
  element('choose-first-folder').textContent = '기존 저장 폴더 찾아 열기';
  element('choose-new-folder').hidden = false;
  element('folder-start-status').textContent = '「' + name + '」 폴더를 열 수 없습니다. ' + error.message;
}

async function restoreLastFolder() {
  try {
    lastDirectory = await readLastFolder();
    if (lastDirectory) await reopenLastFolder();
  } catch (error) {
    if (lastDirectory) showLastFolderError(error);
    else element('folder-start-status').textContent = '마지막 폴더를 확인할 수 없습니다. 저장 폴더를 선택해 주세요.';
  }
}

element('reopen-last-folder').addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = element('choose-first-folder').disabled = element('choose-new-folder').disabled = true;
  try {
    if (await lastDirectory.requestPermission({ mode: 'readwrite' }) !== 'granted') {
      throw new FolderAccessError('다시 연결하려면 읽기와 쓰기를 허용해 주세요.');
    }
    await reopenLastFolder();
    clearSensitive(false);
    await refresh();
  } catch (error) { showLastFolderError(error); }
  finally { button.disabled = element('choose-first-folder').disabled = element('choose-new-folder').disabled = false; }
});

async function chooseFolder(button, reopen) {
  const expected = viewGeneration;
  button.disabled = true;
  try {
    const directory = await window.showDirectoryPicker({ mode: 'readwrite' });
    if (expected !== viewGeneration) return;
    const remembered = await useFolder(directory, { reopen, copyCurrent: workspaceReady });
    clearSensitive(false);
    await refresh();
    if (!remembered) {
      setStatus(workspaceReady ? 'home-status' : 'unlock-status', '폴더를 열었지만 다음 실행을 위한 연결 정보를 저장하지 못했습니다.');
    }
  } catch (error) {
    if (error.name !== 'AbortError') {
      if (!folderConnection()) element('folder-start-status').textContent = error.message;
      else if (!element('lock-screen').hidden) setStatus('unlock-status', error.message);
      else setStatus(reopen ? 'startup-status' : 'settings-status', error.message);
    }
  } finally { button.disabled = false; }
}

element('choose-first-folder').addEventListener('click', event => chooseFolder(event.currentTarget, Boolean(lastDirectory)));
element('choose-new-folder').addEventListener('click', event => chooseFolder(event.currentTarget, false));
element('choose-locked-folder').addEventListener('click', event => chooseFolder(event.currentTarget, false));
const copyDialog = element('vault-copy-dialog');
let copyTarget;

async function chooseCopyTarget(event) {
  const status = event.currentTarget.closest('#settings-dialog') ? 'settings-status' : 'home-status';
  const expected = viewGeneration;
  try {
    const target = await window.showDirectoryPicker({ mode: 'readwrite', id: 'jjokmun-copy' });
    if (expected !== viewGeneration || mode !== 'encrypted') return;
    copyTarget = target;
    setStatus('vault-copy-description', '「' + folderConnection().directory.name + '」의 기록을 「' + target.name
      + '」에 평문으로 복사합니다. 연결된 문서는 두 폴더에서 같은 상대 경로로 찾을 수 있습니다.');
    setStatus('vault-copy-status', '');
    copyDialog.showModal();
  } catch (error) {
    if (error.name !== 'AbortError' && expected === viewGeneration) setStatus(status, error.message);
  }
}
for (const button of document.querySelectorAll('#copy-vault, .legacy-writing button')) button.addEventListener('click', chooseCopyTarget);
element('vault-copy-cancel').addEventListener('click', () => copyDialog.close());
copyDialog.addEventListener('close', () => {
  copyTarget = undefined;
  element('vault-copy-description').textContent = '';
  element('vault-copy-status').textContent = '';
});
copyDialog.addEventListener('cancel', event => {
  if (element('vault-copy-confirm').disabled) event.preventDefault();
});
element('vault-copy-confirm').addEventListener('click', async event => {
  const target = copyTarget;
  if (!target) return;
  const expected = viewGeneration;
  const button = event.currentTarget;
  button.disabled = element('vault-copy-cancel').disabled = true;
  setStatus('vault-copy-status', '문서를 복사하고 메모, 답장, 펫 기록을 다시 읽어 확인하고 있습니다.');
  try {
    await copyVaultToFolder(target);
    if (expected !== viewGeneration) return;
    const remembered = await useFolder(target, { reopen: true, copyCurrent: false });
    clearSensitive(false);
    await refresh();
    setStatus('home-status', '「' + target.name + '」에 복사한 메모, 답장, 펫 기록을 확인했습니다.'
      + (remembered ? '' : ' 다음 실행 때 이 폴더를 다시 선택해 주세요.'));
    element('journal').scrollIntoView();
    element('memo-input').focus({ preventScroll: true });
  } catch (error) {
    if (expected === viewGeneration) setStatus('vault-copy-status', '복사를 마치지 못했습니다. ' + error.message);
  } finally {
    button.disabled = element('vault-copy-cancel').disabled = false;
  }
});

element('choose-folder').addEventListener('click', event => chooseFolder(event.currentTarget, false));
element('storage-relocate').addEventListener('click', event => chooseFolder(event.currentTarget, true));
element('storage-reconnect').addEventListener('click', async () => {
  try {
    await reconnectFolder();
    await refresh();
  } catch (error) { setStatus('startup-status', error.message); }
});

element('open-settings').addEventListener('click', () => {
  setStatus('settings-status', '');
  element('settings-dialog').showModal();
});

const clearBackupDialogs = bindBackupDialogs({
  activeView: () => workspaceReady && !lockPending ? viewGeneration : undefined,
  today,
  setStatus,
  announce,
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
    setStatus('unlock-status', '잠금 상태를 저장하지 못했습니다. 열린 메모고치 탭을 모두 닫아 주세요.');
  } finally {
    announce('security');
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
    if (workspaceReady) document.querySelector('.writing .legacy-writing button').focus();
  } catch (error) {
    if (expected === viewGeneration) {
      setStatus('unlock-status', error.message || '저장소를 열지 못했습니다.');
      input.focus();
    }
  } finally {
    button.disabled = false;
  }
});

function announce(type) {
  const active = folderConnection();
  if (active) channel.postMessage({ type, directory: active.directory });
}

channel.addEventListener('message', async ({ data }) => {
  const active = folderConnection();
  if (!active || !data?.directory || !await active.directory.isSameEntry(data.directory) || active !== folderConnection()) return;
  if (data.type === 'security') {
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
  if (lockPending || !folderConnection()) return;
  try {
    const security = await vaultStatus();
    if (today() !== displayedDate || security.mode !== mode || (security.locked && workspaceReady)) refresh();
  } catch (error) {
    if (workspaceReady && error instanceof FolderAccessError) refresh();
  }
}, 5000);
pendingRefresh = restoreLastFolder();
refresh();
