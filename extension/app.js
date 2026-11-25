import { localDate, validDate, emptyState, selectDaily } from './store.js';
import { LockedError, readPayload, vaultStatus, dropVaultKey, lockVault, unlockVault } from './vault.js';
import { createTime, element, formatDate, longDate } from './ui/dom.js';
import { newestMemos, renderArchive, resetArchive } from './ui/archive.js';
import { bindBackupDialogs } from './ui/backup-dialogs.js';
import { bindReplyDialog } from './ui/reply-dialog.js';
import { folderConnection, useFolder, reconnectFolder } from './vault.js';
import { readLastFolder } from './last-folder.js';
import { FolderAccessError } from './folder.js';
import { BOND_POINTS, BOND_TIERS, DEFAULT_NAME, bondHint, bondOf, bondRoster, newShop, regularOf } from './shop.js';
import { bindFolderFiles } from './ui/folder-files.js';
import { bindPortraits } from './ui/bookshop.js';
import { bindGuestVisit } from './ui/guest-visit.js';
import { bindSalesFloor } from './ui/sales-floor.js';
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
let initialView = true;
let pickingMemo = false;
let pendingRefresh = Promise.resolve();
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
const folderFiles = bindFolderFiles();

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
  for (const details of document.querySelectorAll('.journal-disclosure[open]')) details.open = false;
  header.hidden = true;
  element('lock-screen').hidden = !showLock;
  element('startup-status').hidden = showLock;
  if (!showLock) setStatus('startup-status', 'jjokmun을 여는 중입니다.');
  replyDialog.reset();
  salesFloor.reset();
  guestVisit.reset();
  folderFiles.reset();
  resetArchive();
  element('folder-start-status').textContent = '';
  element('shop-name').value = '';
  element('storage-recovery').hidden = true;
  element('storage-start').hidden = true;
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  for (const id of ['memo-input', 'floor-memo-input', 'archive-search', 'reply-input', 'edit-input']) element(id).value = '';
  for (const id of ['detail-original', 'detail-date', 'detail-replies', 'daily-excerpt', 'archive-list',
    'detail-status', 'copy-status', 'home-status', 'floor-memo-status', 'archive-status', 'settings-status',
    'delete-message', 'vault-state', 'unlock-status', 'daily-request', 'roster-count', 'roster-tally', 'roster-list',
    'regular-name', 'regular-title', 'regular-hint', 'season-name', 'goal-list', 'shop-grade',
    'goal-status', 'review-title', 'review-stats']) {
    element(id).replaceChildren();
  }
  element('detail-date').removeAttribute('datetime');
  element('regular-progress').value = 0;
  element('regular-progress').max = 1;
  const portrait = element('regular-portrait');
  portrait.getContext('2d').clearRect(0, 0, portrait.width, portrait.height);
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
  detailId = linkedReply = returnFocus = confirmedReplyCount = displayedDate = undefined;
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
  element('enable-vault').hidden = mode !== 'plain';
  element('disable-vault').hidden = mode !== 'encrypted';
  element('lock-vault').hidden = mode !== 'encrypted';
  setStatus('vault-state', mode === 'encrypted'
    ? '현재 저장소의 메모와 가져오기 되돌리기 기록을 암호화하고 있습니다.'
    : '현재 저장소의 메모는 현재 평문으로 저장됩니다.');
  render(date, months, grade);
  if (!document.body.classList.contains('journal-view')) salesFloor.update(state, date);
}

function switchView() {
  const journal = location.hash === '#journal';
  const leavingJournal = !journal && document.body.classList.contains('journal-view');
  document.body.classList.toggle('journal-view', journal);
  element('floor-link').setAttribute('aria-current', journal ? 'false' : 'page');
  element('open-archive').setAttribute('aria-current', journal ? 'page' : 'false');
  if (journal) salesFloor.reset();
  else if (workspaceReady) salesFloor.update(state, displayedDate);
  if (leavingJournal) {
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
  element('today-date').textContent = formatDate(date, longDate);
  const entry = state.daily.find((record) => record.date === date);
  const memo = !entry?.folded && state.memos.find((note) => note.id === entry?.memoId);
  const board = element('daily-board');
  const boardHadFocus = board.contains(document.activeElement);
  board.hidden = !memo;
  element('daily-empty').hidden = Boolean(memo);
  element('daily-empty').textContent = entry?.folded ? '오늘은 다시 찾는 책을 접어두었어요.' : '며칠 지난 책은 손님이 다시 찾아와요.';
  if (memo) {
    const characters = Array.from(memo.text);
    element('daily-excerpt').textContent = characters.length > 66 ? characters.slice(0, 66).join('') + '…' : memo.text;
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
  renderArchive(sorted, detailId, openDetail);
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

function renderRegular(memo) {
  const bond = bondOf(memo, state.daily);
  element('regular-name').textContent = regularOf(memo.id).name;
  element('regular-title').textContent = bond.title + ' · 정 ' + bond.points;
  const progress = element('regular-progress');
  progress.max = Math.max(1, bond.ceiling - bond.floor);
  progress.value = bond.nextTitle ? bond.points - bond.floor : progress.max;
  element('regular-hint').textContent = bondHint(bond, {
    requestedToday: state.daily.some((entry) => !entry.folded && entry.date === displayedDate && entry.memoId === memo.id),
    repliedToday: memo.replies.some((reply) => reply.createdOn === displayedDate)
  });
  portraits.portrait(element('regular-portrait'), memo.id);
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

function newMemo(text, date) {
  const now = Date.now();
  return { id: crypto.randomUUID(), text, createdOn: date, createdAt: now, updatedAt: now, replies: [] };
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
});

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
});

// A sold book opens in the journal with the reply field ready.
function openFromFloor(id) {
  if (!state.memos.some((memo) => memo.id === id)) return;
  showView('#journal');
  openDetail(id);
  element('reply-compose').open = true;
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
  renderRegular(memo);
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
      tag.textContent = '검색어가 있는 답장';
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
  if (workspaceReady) renderArchive(newestMemos(state.memos), detailId, openDetail);
}

element('archive-search').addEventListener('input', refreshArchive);

function openDetail(id, replyId, source) {
  if (!state.memos.some((memo) => memo.id === id)) return;
  if (detailId !== id) {
    element('reply-compose').open = false;
    element('memo-tools').open = false;
    replyDialog.reset();
    element('reply-input').value = '';
    element('edit-form').hidden = true;
    setStatus('detail-status', '');
    setStatus('copy-status', '');
  }
  detailId = id;
  linkedReply = replyId;
  returnFocus = source;
  if (pickingMemo && source?.dataset.memoId) {
    element('memo-tools').open = true;
    pickingMemo = false;
  }
  renderSelection();
  refreshArchive();
  if (source) element('detail-title').focus();
}

function renderSelection() {
  const hasMemo = Boolean(currentMemo());
  document.querySelector('.notebook').hidden = !state.memos.length;
  element('detail-dialog').hidden = !hasMemo;
  element('note-empty').hidden = hasMemo;
  if (hasMemo) {
    const displayed = detailId === state.shop?.displayMemoId;
    element('display-memo').disabled = displayed;
    element('display-memo').textContent = displayed ? '매대에 진열 중' : '매대에 올리기';
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
  element('memo-search').open = true;
  const search = element('archive-search');
  search.value = '';
  search.dispatchEvent(new Event('input'));
  search.focus();
  setStatus('archive-status', message);
}
element('guest-choose').addEventListener('click', () => chooseFromArchive('메모를 열고 ‘이 글을 연두에게 건네기’를 눌러 주세요.'));


element('display-memo').addEventListener('click', async () => {
  const id = detailId;
  const button = element('display-memo');
  button.disabled = true;
  try {
    await change(draft => {
      findMemo(draft, id);
      (draft.shop ??= newShop()).displayMemoId = id;
    });
    if (detailId === id && state.shop?.displayMemoId === id) {
      setStatus('detail-status', '책방 매대에 추천글을 올렸어요.');
      element('memo-tools').querySelector('summary').focus();
    }
  } catch (error) {
    if (workspaceReady && detailId === id) {
      button.disabled = id === state.shop?.displayMemoId;
      setStatus('detail-status', error.message || '매대에 올리지 못했어요. 다시 시도해 주세요.');
    }
  }
});

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
    ? `메모에 남긴 답장 ${count}개가 함께 삭제됩니다.`
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
