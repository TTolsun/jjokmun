import { localDate, validDate, emptyState, selectDaily } from './store.js';
import { LockedError, readPayload, vaultStatus, dropVaultKey, lockVault, unlockVault } from './vault.js';
import { createTime, element, formatDate, longDate, memoExcerpt } from './ui/dom.js';
import { focusArchiveReturn, newestMemos, renderArchive, resetArchive, setArchiveOpen } from './ui/archive.js';
import { bindBackupDialogs } from './ui/backup-dialogs.js';
import { bindReplyDialog } from './ui/reply-dialog.js';
import { DocumentConflictError, DocumentWriteError, folderConnection, copyVaultToFolder, useFolder, reconnectFolder, relinkDocument } from './vault.js';
import { readLastFolder } from './last-folder.js';
import { FolderAccessError } from './folder.js';
import { checkMemoSize, detectFormat, documentChanged } from './documents.js';
import { BOND_POINTS, BOND_TIERS, DEFAULT_NAME, bondOf, bondRoster, newShop, regularOf } from './shop.js';
import { bindFolderFiles } from './ui/folder-files.js';
import { bindPortraits } from './ui/bookshop.js';
import { bindGuestVisit } from './ui/guest-visit.js';
import { bindSalesFloor } from './ui/sales-floor.js';
import { bindDocumentPreview } from './ui/document-preview.js';
import { bindReplyPreviews } from './ui/reply-previews.js';
import { activity, monthlyProgress, reviewYear, seasonOf, shopGrade, yearReview } from './season.js';

const channel = new BroadcastChannel('memo-alley');
const requestedDate = new URLSearchParams(location.search).get('date');
const today = () => validDate(requestedDate) ? requestedDate : localDate();
let state = emptyState();
let displayedDate;
let detailId;
let linkedReply;
let returnFocus;
let confirmedReplyCount;
let confirmedDocument;
let editBase;
let initialView = true;
let pickingMemo = false;
let pendingRefresh = Promise.resolve();
let pendingArchiveChoice;
let workspaceReady = false;
let mode;
let viewGeneration = 0;
let lockPending = false;
let renderedRevision = -1;
let seenGoals;
const workspace = document.querySelector('.workspace');
const header = document.querySelector('.site-header');
const replyDialog = bindReplyDialog(change);
const portraits = bindPortraits();
const salesFloor = bindSalesFloor(change, { openMemo: openFromFloor });
const guestVisit = bindGuestVisit();
portraits.portrait(element('guest-portrait'), 'sketchbook-reader');
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
  workspace.hidden = true;
  pickingMemo = false;
  pendingArchiveChoice = undefined;
  for (const details of document.querySelectorAll('.journal-disclosure[open]')) details.open = false;
  header.hidden = true;
  element('lock-screen').hidden = !showLock;
  element('startup-status').hidden = showLock;
  if (!showLock) setStatus('startup-status', 'jjokmun을 여는 중입니다.');
  replyDialog.reset();
  salesFloor.reset();
  guestVisit.reset();
  folderFiles.reset();
  documentPreview.reset();
  replyPreviews.reset();
  resetEdit();
  resetArchive();
  element('folder-start-status').textContent = '';
  element('shop-name').value = '';
  element('storage-recovery').hidden = true;
  element('storage-start').hidden = true;
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  for (const id of ['memo-input', 'floor-memo-input', 'archive-search', 'reply-input', 'edit-input']) element(id).value = '';
  for (const id of ['detail-original', 'detail-date', 'detail-replies', 'daily-excerpt', 'archive-list',
    'detail-status', 'copy-status', 'home-status', 'floor-memo-status', 'archive-status', 'settings-status', 'shelf-previous',
    'delete-message', 'vault-state', 'unlock-status', 'daily-request', 'roster-count', 'roster-tally', 'roster-list',
    'season-name', 'goal-list', 'shop-grade',
    'goal-status', 'review-title', 'review-stats', 'detail-path', 'document-path-choice', 'document-refresh-status']) {
    element(id).replaceChildren();
  }
  element('detail-date').removeAttribute('datetime');
  element('daily-board').hidden = true;
  element('year-review').hidden = true;
  seenGoals = undefined;
  element('detail-dialog').hidden = true;
  element('edit-form').hidden = true;
  element('memo-count').textContent = '0';
  element('unlock-form').reset();
  clearBackupDialogs();
  state = emptyState();
  renderedRevision = -1;
  detailId = linkedReply = returnFocus = confirmedReplyCount = confirmedDocument = displayedDate = undefined;
  initialView = true;
  if (showLock && !lockPending) element('unlock-password').focus();
}

function renderPayload(result, date, storageMode = mode) {
  if (result.revision < renderedRevision) return;
  renderedRevision = result.revision;
  mode = storageMode;
  state = result.payload.state;
  const months = activity(state, date);
  const grade = shopGrade(state, date, months);
  workspaceReady = true;
  workspace.hidden = false;
  header.hidden = false;
  element('lock-screen').hidden = true;
  element('startup-status').hidden = true;
  element('undo-import').disabled = !result.payload.undo;
  const encrypted = mode === 'encrypted';
  for (const notice of document.querySelectorAll('.legacy-writing')) notice.hidden = !encrypted;
  for (const id of ['memo-form', 'floor-memo-form']) element(id).hidden = encrypted;
  document.querySelector('label[for="memo-input"]').hidden = encrypted;
  element('copy-vault').hidden = !encrypted;
  element('lock-vault').hidden = mode !== 'encrypted';
  element('refresh-documents').hidden = mode !== 'plain';
  setStatus('vault-state', mode === 'encrypted'
    ? '쪽문 저장 파일에 메모를 암호화해 저장합니다. 폴더에 남은 .md와 .txt 파일은 계속 열 수 있습니다.'
    : '새 메모는 저장 폴더에 .md 파일로 저장됩니다. 답장과 책방 기록은 쪽문 저장 파일에 남습니다.');
  render(date, months, grade);
  if (!document.body.classList.contains('journal-view')) salesFloor.update(state, date);
}

function switchView() {
  const journal = location.hash === '#journal';
  const leavingJournal = !journal && document.body.classList.contains('journal-view');
  document.body.classList.toggle('journal-view', journal);
  element('floor-link').setAttribute('aria-current', journal ? 'false' : 'page');
  element('open-archive').setAttribute('aria-current', journal ? 'page' : 'false');
  if (journal) {
    salesFloor.reset();
    if (workspaceReady) renderSelection();
  } else {
    pendingArchiveChoice = undefined;
    documentPreview.reset();
    replyPreviews.reset();
    if (workspaceReady) salesFloor.update(state, displayedDate);
  }
  if (leavingJournal) {
    if (pickingMemo) {
      pickingMemo = false;
      refreshArchive();
    }
    setArchiveOpen(false);
    element('floor-title').focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
}
window.addEventListener('hashchange', switchView);

function showView(hash) {
  if (location.hash === hash) return;
  history.replaceState(null, '', hash);
  switchView();
}
switchView();

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
    if (!result.payload.state.daily.some((entry) => entry.date === date)) {
      result = await readPayload((draft) => {
        if (draft.daily.some((entry) => entry.date === date)) return false;
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
  const result = await readPayload((draft) => {
    if (mutator(draft, date) === false) return false;
    selectDaily(draft, date);
  });
  if (expected !== viewGeneration) throw new LockedError();
  renderPayload(result, date);
  announce('changed');
}

function render(date, months, grade) {
  displayedDate = date;
  guestVisit.render(state, date);
  if (mode === 'encrypted' && !state.shop?.guestMemoId) element('guest-form').hidden = true;
  element('today-date').textContent = formatDate(date, longDate);
  const entry = state.daily.find((record) => record.date === date);
  const memo = !entry?.folded && state.memos.find((note) => note.id === entry?.memoId);
  const board = element('daily-board');
  const boardHadFocus = board.contains(document.activeElement);
  board.hidden = !memo;
  element('daily-empty').hidden = Boolean(memo);
  element('daily-empty').textContent = entry?.folded ? '오늘은 다시 찾는 책을 접어두었어요.' : '며칠 지난 책은 손님이 다시 찾아와요.';
  if (memo) {
    element('daily-excerpt').textContent = memoExcerpt(memo, 66);
    const { name } = regularOf(memo.id);
    element('daily-request').textContent = memo.replies.some((reply) => reply.createdOn === date)
      ? name + '의 부탁을 들어줬어요 · 정 +' + BOND_POINTS.request
      : name + '이 이 책을 다시 찾아요';
  } else if (boardHadFocus) {
    element('memo-input').focus();
  }

  // Season and roster summarize all memos, so refresh them before the early
  // return that closes a deleted memo's detail view.
  renderSeason(date, months, grade);
  renderRoster();
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
  renderArchive(sorted, detailId, openArchiveDetail);
  renderSelection();
}

// Pick 이 or 가 from the final syllable's batchim.
function withSubject(word) {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  return word + (code >= 0 && code < 11172 && code % 28 === 0 ? '가' : '이');
}

function renderSeason(date, months, grade) {
  const season = seasonOf(date);
  const progress = monthlyProgress(state, date, months);
  element('floor').dataset.season = season.key;
  element('season-name').textContent = Number(date.slice(5, 7)) + '월 · ' + season.name;
  element('goal-list').replaceChildren(...progress.goals.map((goal) => {
    const item = document.createElement('li');
    item.classList.toggle('done', goal.done);
    const label = document.createElement('span');
    label.textContent = goal.label;
    const count = document.createElement('span');
    count.className = 'goal-count';
    count.textContent = Math.min(goal.count, goal.target) + '/' + goal.target + (goal.done ? ' 달성' : '');
    const bar = document.createElement('progress');
    bar.max = goal.target;
    bar.value = Math.min(goal.count, goal.target);
    bar.setAttribute('aria-label', goal.label + ' ' + goal.count + '/' + goal.target);
    item.append(label, count, bar);
    return item;
  }));
  element('shop-grade').textContent = '책방 등급: ' + grade.name + (grade.nextName
    ? ' · 목표를 모두 이룬 달이 ' + grade.remaining + '번 더 있으면 ' + withSubject(grade.nextName) + ' 돼요.'
    : ' · 가장 높은 등급이에요.');

  // Announce only goals completed while this tab is open, not ones met earlier.
  const done = new Set(progress.goals.filter((goal) => goal.done).map((goal) => goal.key));
  if (seenGoals?.month === progress.month) {
    const fresh = progress.goals.filter((goal) => goal.done && !seenGoals.done.has(goal.key));
    if (progress.complete && fresh.length) {
      setStatus('goal-status', '이달의 목표를 모두 이뤘어요. 책방 등급: ' + grade.name + '.');
    } else if (fresh.length) {
      setStatus('goal-status', '이달의 목표 달성: ' + fresh.map((goal) => goal.label).join(', ') + '.');
    } else if ([...seenGoals.done].some(key => !done.has(key))) {
      setStatus('goal-status', '');
    }
  } else {
    setStatus('goal-status', '');
  }
  seenGoals = { month: progress.month, done };
  renderReview(date, months);
}

function renderReview(date, months) {
  const year = reviewYear(date);
  const review = year && yearReview(state, year, date, months);
  element('year-review').hidden = !review;
  if (!review) return;
  element('review-title').textContent = review.year + '년 책방 결산';
  const rows = [
    ['새로 쓴 메모', review.memos + '편'],
    ['메모를 쓴 날', review.writingDays + '일'],
    ['다시 읽고 답장한 날', review.rereadingDays + '일'],
    ['다시 찾은 책에 답한 날', review.requests + '일'],
    ['목표를 모두 이룬 달', review.completedMonths + '달']
  ];
  if (review.busiest) rows.push(['가장 부지런했던 달', Number(review.busiest.month.slice(5)) + '월 (' + review.busiest.days + '일)']);
  if (review.favorite) rows.push(['올해의 단골', review.favorite.name + ' · ' + review.favorite.bond.title]);
  element('review-stats').replaceChildren(...rows.flatMap(([term, value]) => {
    const dt = document.createElement('dt');
    dt.textContent = term;
    const dd = document.createElement('dd');
    dd.textContent = value;
    return [dt, dd];
  }));
}

const ROSTER_SIZE = 5;

function renderRoster() {
  const roster = bondRoster(state);
  element('roster-count').textContent = roster.length + '명';
  element('roster-tally').textContent = roster.length
    ? BOND_TIERS.map((tier, index) => [tier.name, roster.filter((entry) => entry.bond.tier === index).length])
      .filter(([, count]) => count).reverse().map(([name, count]) => name + ' ' + count + '명').join(' · ')
    : '메모를 한 편 쓰면 단골이 한 명 생겨요.';
  const list = element('roster-list');
  const focused = list.contains(document.activeElement) ? document.activeElement.dataset.regular : undefined;
  list.replaceChildren(...roster.slice(0, ROSTER_SIZE).map((entry) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.regular = entry.memo.id;
    const canvas = document.createElement('canvas');
    canvas.width = 24;
    canvas.height = 32;
    canvas.setAttribute('aria-hidden', 'true');
    portraits.portrait(canvas, entry.memo.id);
    const name = document.createElement('strong');
    name.textContent = entry.name;
    const title = document.createElement('span');
    title.textContent = entry.bond.title + ' · 정 ' + entry.bond.points;
    button.append(canvas, name, title);
    button.addEventListener('click', () => openFromFloor(entry.memo.id));
    item.append(button);
    return item;
  }));
  if (focused) list.querySelector(`[data-regular="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
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
      event.preventDefault();
    } else if ('enterSubmits' in input.dataset && !event.shiftKey) {
      // Memo fields are textareas that still save on Enter; Shift+Enter adds a line.
      event.preventDefault();
      form.requestSubmit();
    }
  });
  if (input.type === 'text') {
    // A single-line field drops pasted line breaks silently, gluing words together.
    input.addEventListener('paste', (event) => {
      const pasted = event.clipboardData?.getData('text/plain') ?? '';
      if (!/[\r\n]/.test(pasted)) return;
      event.preventDefault();
      const room = input.maxLength < 0 ? Infinity
        : input.maxLength - input.value.length + (input.selectionEnd - input.selectionStart);
      let line = pasted.replace(/\s*[\r\n]+\s*/g, ' ');
      if (input.selectionStart === 0) line = line.trimStart();
      if (input.selectionEnd === input.value.length) line = line.trimEnd();
      input.setRangeText(line.slice(0, Math.max(0, room)), input.selectionStart, input.selectionEnd, 'end');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      setStatus(statusId, '이 칸은 한 줄로 저장돼서 줄바꿈을 띄어쓰기로 바꿨어요.');
    });
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (composing || pending) return;
    const original = input.value;
    const text = readText(input);
    if (input.required && !text.trim()) {
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
      if (message && expected === viewGeneration && (!inDetail || (!inDetail.hidden && detailId === revision))) {
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
  const previousId = detailId;
  await change((draft, date) => {
    const memo = newMemo(text, date);
    draft.memos.push(memo);
    id = memo.id;
  });
  if (detailId === previousId) openDetail(id);
  if (document.activeElement === document.body) element('memo-input').focus();
  return '메모를 남겼어요. 새 책이 되어 책방 신간 매대에 꽂혔어요.';
}, input => input.value);

// Writing on the shop floor keeps the owner in the shop: the memo becomes the
// newest book on the cart and the next cart reader opens it.
bindTextForm('floor-memo-form', 'floor-memo-input', 'floor-memo-save', 'floor-memo-status', async (text) => {
  let id;
  const previousId = detailId;
  await change((draft, date) => {
    const memo = newMemo(text, date);
    draft.memos.push(memo);
    id = memo.id;
  });
  if (detailId === previousId) openDetail(id);
  if (document.activeElement === document.body) element('floor-memo-input').focus();
  return '새 책을 신간 매대에 꽂았어요. 곧 손님이 펼쳐 볼 거예요.';
}, input => input.value);

// A sold book opens in the journal with the reply field ready.
function openFromFloor(id) {
  if (!state.memos.some((memo) => memo.id === id)) return;
  showView('#journal');
  openDetail(id);
  element('reply-input').focus();
}

function replyMessage(memoId, before, after) {
  const { name } = regularOf(memoId);
  if (after.tier > before.tier) return '답장을 저장했어요. ' + name + '과 한층 가까워졌어요: ' + after.title + '.';
  if (after.points > before.points) return '답장을 저장했어요. ' + name + '과의 정 +' + (after.points - before.points) + '.';
  return '답장을 저장했어요. 오늘은 ' + name + '과 이미 정을 쌓았어요.';
}

function findMemo(draft, id) {
  const memo = draft.memos.find((record) => record.id === id);
  if (!memo) throw new Error('목록에서 이 메모를 찾을 수 없습니다.');
  return memo;
}

async function giveGuestMemo({ id, text }) {
  let givenId;
  await change((draft, date) => {
    if (draft.shop?.guestMemoId) return false;
    const memo = id ? findMemo(draft, id) : newMemo(text, date);
    if (!id) draft.memos.push(memo);
    (draft.shop ??= newShop()).guestMemoId = memo.id;
    givenId = memo.id;
  });
  if (givenId) openDetail(givenId);
  showView('#floor');
  element('writing-title').focus();
  return givenId ? '연두에게 글을 건넸어요.' : '연두가 다른 탭에서 이미 글을 받았어요.';
}

bindTextForm('guest-form', 'guest-input', 'guest-submit', 'guest-status', async text => {
  const id = state.shop?.guestMemoId;
  if (!id) return giveGuestMemo({ text });
  let saved = false;
  await change((draft, date) => {
    if (draft.shop?.guestMemoId !== id || draft.shop.guestReplyId) return false;
    const memo = findMemo(draft, id);
    const reply = { id: crypto.randomUUID(), text, createdOn: date, createdAt: Date.now() };
    memo.replies.push(reply);
    draft.shop.guestReplyId = reply.id;
    saved = true;
  });
  element('writing-title').focus();
  return saved ? '건넨 글에 뒷이야기를 답장으로 남겼어요.' : '다른 탭에서 연두의 이야기가 바뀌었어요.';
});

element('give-memo').addEventListener('click', async () => {
  const button = element('give-memo');
  const expected = viewGeneration;
  button.disabled = true;
  try {
    setStatus('guest-status', await giveGuestMemo({ id: detailId }));
  } catch (error) {
    if (expected === viewGeneration) setStatus('detail-status', error.message || '글을 건네지 못했어요.');
  } finally { button.disabled = false; }
});

bindTextForm('reply-form', 'reply-input', 'reply-save', 'detail-status', async (text) => {
  const replyId = crypto.randomUUID();
  const memoId = detailId;
  let message = '답장을 저장했어요.';
  await change((draft, date) => {
    const memo = findMemo(draft, memoId);
    if (memo.replies.some((reply) => reply.id === replyId)) return;
    selectDaily(draft, date);
    const before = bondOf(memo, draft.daily);
    memo.replies.push({ id: replyId, text, createdOn: date, createdAt: Date.now() });
    message = replyMessage(memoId, before, bondOf(memo, draft.daily));
  });
  if (detailId === memoId && document.activeElement === document.body) element('reply-input').focus();
  return message;
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
  const time = element('detail-date');
  time.dateTime = memo.createdOn;
  time.textContent = formatDate(memo.createdOn);
  const path = element('detail-path');
  path.hidden = !memo.documentPath;
  path.textContent = memo.documentPath || '';
  element('document-missing').hidden = !memo.documentMissing;
  element('copy-memo').disabled = Boolean(memo.documentMissing);
  element('edit-memo').disabled = Boolean(memo.documentMissing);
  renderRelink(memo);
  renderEditConflict(memo);
  element('detail-original').textContent = memo.text;
  if (document.body.classList.contains('journal-view')) documentPreview.update(memo);
  const replies = [...memo.replies].sort((a, b) => a.createdOn.localeCompare(b.createdOn) || a.createdAt - b.createdAt);
  const container = element('detail-replies');
  const focused = container.contains(document.activeElement) ? document.activeElement : undefined;
  container.replaceChildren();
  replyPreviews.prune(new Set(replies.map(reply => reply.id)));
  if (!replies.length) return;
  const rendering = document.body.classList.contains('journal-view');
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
    const text = replyPreviews.bodyFor(reply, memo, rendering);
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
  if (workspaceReady) renderArchive(newestMemos(state.memos), detailId, openArchiveDetail);
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
  linkedReply = replyId;
  returnFocus = source;
  if (pickingMemo && source?.dataset.memoId) {
    pickingMemo = false;
  }
  renderSelection();
  if (source?.dataset.memoId) setArchiveOpen(false);
  refreshArchive();
  if (source) element('detail-title').focus();
}

function openArchiveDetail(id, replyId, source) {
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
  const hasMemo = Boolean(currentMemo());
  document.querySelector('.notebook').hidden = !state.memos.length;
  element('detail-dialog').hidden = !hasMemo;
  element('note-empty').hidden = hasMemo;
  if (!hasMemo) {
    documentPreview.reset();
    replyPreviews.reset();
  }
  if (hasMemo) {
    // The shelf holds one memo, so show what a new pick would replace.
    const displayId = state.shop?.displayMemoId;
    const displayed = detailId === displayId;
    const previous = displayId && !displayed && state.memos.find(memo => memo.id === displayId);
    element('shelf-previous').hidden = !previous;
    element('shelf-previous').textContent = previous ? '지금 매대에 놓인 글 · ' + memoExcerpt(previous, 100) : '';
    element('display-memo').disabled = false;
    element('display-memo').textContent = displayed ? '책방에서 보기' : previous ? '이 글로 교체하기' : '매대에 놓기';
    renderDetail();
  } else if (state.memos.length) {
    element('empty-title').textContent = '메모를 골라 주세요';
    element('empty-text').textContent = '전체 메모에서 원문이나 답장을 찾아 열 수 있어요.';
  } else {
    element('empty-title').textContent = '아직 남긴 메모가 없어요';
    element('empty-text').textContent = '위에 한 줄을 저장하면 원문과 답장을 이곳에서 읽을 수 있어요.';
  }
}

function chooseFromArchive(message) {
  showView('#journal');
  pickingMemo = true;
  setArchiveOpen(true);
  element('memo-search').open = true;
  const search = element('archive-search');
  search.value = '';
  search.dispatchEvent(new Event('input'));
  search.focus();
  setStatus('archive-status', message);
}
element('guest-choose').addEventListener('click', () => chooseFromArchive('메모를 열고 ‘이 글을 연두에게 건네기’를 눌러 주세요.'));
element('archive-toggle').addEventListener('click', (event) => {
  if (event.currentTarget.getAttribute('aria-expanded') === 'false' && pickingMemo) {
    pickingMemo = false;
    element('memo-search').open = false;
    refreshArchive();
  }
});


element('display-memo').addEventListener('click', async () => {
  const id = detailId;
  const previousId = state.shop?.displayMemoId;
  if (id === previousId) {
    showView('#floor');
    return;
  }
  const button = element('display-memo');
  button.disabled = true;
  try {
    // Replace only the pick this tab showed; another tab may have changed it.
    await change(draft => {
      findMemo(draft, id);
      if (draft.shop?.displayMemoId !== previousId) return false;
      (draft.shop ??= newShop()).displayMemoId = id;
    });
    if (detailId === id) {
      setStatus('detail-status', state.shop?.displayMemoId === id
        ? '책방 매대에 추천글을 올렸어요.'
        : '다른 탭에서 매대의 글이 바뀌었어요. 교체할 글을 다시 확인해 주세요.');
      button.focus();
    }
  } catch (error) {
    if (workspaceReady && detailId === id) setStatus('detail-status', error.message || '매대에 올리지 못했어요. 다시 시도해 주세요.');
  } finally {
    button.disabled = false;
  }
});

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
  linkedReply = undefined;
  returnFocus = undefined;
  element('reply-input').value = '';
  resetEdit();
  setStatus('detail-status', '');
  setStatus('copy-status', '');
  renderSelection();
  refreshArchive();
}

element('daily-memo').addEventListener('click', () => {
  const daily = state.daily.find((entry) => entry.date === displayedDate && !entry.folded);
  if (daily) openFromFloor(daily.memoId);
});

element('defer-memo').addEventListener('click', async () => {
  const date = displayedDate;
  try {
    await change((draft) => { selectDaily(draft, date).folded = true; });
    setStatus('business-status', '오늘은 다시 찾는 책을 접어두었어요.');
  } catch {
    setStatus('business-status', '접어두지 못했습니다. 다시 시도해 주세요.');
  }
});


element('edit-memo').addEventListener('click', () => {
  const memo = currentMemo();
  if (!memo || memo.documentMissing) return;
  if (element('edit-form').hidden) startEdit(memo);
  element('edit-input').focus();
});

function startEdit(memo) {
  resetEdit();
  editBase = memo;
  const input = element('edit-input');
  input.value = memo.text;
  input.required = !memo.documentPath;
  if (memo.documentPath || memo.text.length > 2000) input.removeAttribute('maxlength');
  else input.maxLength = 2000;
  element('edit-form').hidden = false;
  setStatus('detail-status', '');
}

function resetEdit() {
  editBase = undefined;
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

element('shop-name-form').addEventListener('submit', async event => {
  event.preventDefault();
  const name = element('shop-name').value.trim();
  if (!name) {
    setStatus('settings-status', '책방 이름을 입력해 주세요.');
    element('shop-name').focus();
    return;
  }
  try {
    await change(draft => { (draft.shop ??= newShop()).name = name; });
    setStatus('settings-status', '책방 이름을 저장했어요.');
  } catch (error) { setStatus('settings-status', error.message); }
});

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
  const status = event.currentTarget.closest('#settings-dialog') ? 'settings-status'
    : event.currentTarget.closest('#floor') ? 'floor-memo-status' : 'home-status';
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
  setStatus('vault-copy-status', '문서를 복사하고 메모와 답장을 다시 읽어 확인하고 있습니다.');
  try {
    await copyVaultToFolder(target);
    if (expected !== viewGeneration) return;
    const remembered = await useFolder(target, { reopen: true, copyCurrent: false });
    clearSensitive(false);
    await refresh();
    setStatus('home-status', '「' + target.name + '」에 복사한 메모와 답장을 확인했습니다.'
      + (remembered ? '' : ' 다음 실행 때 이 폴더를 다시 선택해 주세요.'));
    showView('#journal');
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
  element('shop-name').value = state.shop?.name || DEFAULT_NAME;
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
    setStatus('unlock-status', '잠금 상태를 저장하지 못했습니다. 열린 jjokmun 탭을 모두 닫아 주세요.');
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
    if (workspaceReady) document.querySelector(document.body.classList.contains('journal-view')
      ? '.writing .legacy-writing button' : '#floor .legacy-writing button').focus();
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
