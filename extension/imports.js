import { selectDaily } from './store.js';
import { validateBusiness } from './business.js';

const core = (memo) => ({ text: memo.text, updatedAt: memo.updatedAt });
const link = (memoId, replyId) => memoId + '/' + replyId;

function sameReply(a, b) {
  return a.id === b.id && a.text === b.text && a.createdOn === b.createdOn && a.createdAt === b.createdAt;
}

function sameDaily(a, b) {
  return a?.date === b.date && a.memoId === b.memoId && a.folded === b.folded;
}

function sameProp(a, b) {
  return a?.kind === b.kind && a.memoId === b.memoId && a.replyId === b.replyId;
}

function conflict(summary, reason) {
  summary.conflicts += 1;
  if (!summary.reasons.includes(reason)) summary.reasons.push(reason);
}

export function mergeImport(state, backup, date) {
  const summary = { newMemos: 0, updatedMemos: 0, newReplies: 0, daily: 0, props: 0, conflicts: 0, reasons: [] };
  const undo = { memos: [], daily: [], props: [] };
  const memos = new Map(state.memos.map((memo) => [memo.id, memo]));
  const rejectedMemos = new Set();
  const rejectedReplies = new Set();
  for (const incoming of backup.memos) {
    const existing = memos.get(incoming.id);
    const delta = { id: incoming.id, createdOn: incoming.createdOn, before: null, after: null, replies: [] };
    if (!existing) {
      const memo = structuredClone(incoming);
      state.memos.push(memo);
      memos.set(memo.id, memo);
      delta.after = core(memo);
      delta.replies = memo.replies;
      undo.memos.push(delta);
      summary.newMemos += 1;
      summary.newReplies += delta.replies.length;
      continue;
    }
    if (existing.createdOn !== incoming.createdOn) {
      rejectedMemos.add(incoming.id);
      conflict(summary, 'ID는 같지만 작성일이 다른 메모는 기존 기록을 유지합니다.');
      continue;
    }
    if (existing.text !== incoming.text) {
      if (incoming.updatedAt > existing.updatedAt) {
        delta.before = core(existing);
        delta.after = core(incoming);
        Object.assign(existing, delta.after);
        summary.updatedMemos += 1;
      } else {
        conflict(summary, '기존 원문이 같거나 더 최근에 수정된 메모는 유지합니다.');
      }
    }
    const replies = new Map(existing.replies.map((reply) => [reply.id, reply]));
    for (const reply of incoming.replies) {
      const current = replies.get(reply.id);
      if (!current) {
        existing.replies.push(reply);
        delta.replies.push(reply);
        summary.newReplies += 1;
      } else if (!sameReply(current, reply)) {
        rejectedReplies.add(link(existing.id, reply.id));
        conflict(summary, 'ID는 같지만 내용이 다른 답장은 기존 기록을 유지합니다.');
      }
    }
    if (delta.after || delta.replies.length) undo.memos.push(delta);
  }

  const beforeByDate = new Map(state.daily.map((entry) => [entry.date, { ...entry }]));
  const byDate = new Map(state.daily.map((entry) => [entry.date, entry]));
  for (const incoming of backup.daily) {
    if (rejectedMemos.has(incoming.memoId)) {
      conflict(summary, '충돌한 메모를 가리키는 입간판 기록은 건너뜁니다.');
      continue;
    }
    const existing = byDate.get(incoming.date);
    if (!existing) state.daily.push({ ...incoming });
    else if (existing.date === date && existing.memoId === null && !existing.folded) Object.assign(existing, incoming);
    else if (!sameDaily(existing, incoming)) conflict(summary, '같은 날짜의 입간판은 기존 기록을 유지합니다.');
  }
  const today = state.daily.find((entry) => entry.date === date);
  if (today?.memoId === null && !today.folded && summary.newMemos) {
    state.daily = state.daily.filter((entry) => entry !== today);
  }
  if (summary.newMemos) selectDaily(state, date);
  for (const entry of state.daily) {
    const before = beforeByDate.get(entry.date) ?? null;
    if (!sameDaily(before, entry)) undo.daily.push({ date: entry.date, before, after: entry });
  }
  summary.daily = undo.daily.length;

  for (const prop of backup.props) {
    const existing = state.props.find((item) => item.kind === prop.kind
      || link(item.memoId, item.replyId) === link(prop.memoId, prop.replyId));
    if (!existing && !rejectedMemos.has(prop.memoId) && !rejectedReplies.has(link(prop.memoId, prop.replyId))) {
      state.props.push(prop);
      undo.props.push(prop);
    } else if (!sameProp(existing, prop)) {
      conflict(summary, '이미 사용 중이거나 충돌한 답장을 가리키는 소품은 건너뜁니다.');
    }
  }
  summary.props = undo.props.length;

  const changed = Object.values(undo).some((entries) => entries.length > 0);
  const freshFloor = state.business && !state.business.days && !state.business.moves.length;
  if (backup.business && (!state.business || (freshFloor && (backup.business.days > 0 || backup.business.moves.length > 0)))) {
    undo.business = { before: state.business || null, after: structuredClone(backup.business) };
    state.business = structuredClone(backup.business);
    summary.business = 1;
  }
  if (backup.shop && !state.shop) {
    state.shop = structuredClone(backup.shop);
    if (rejectedMemos.has(state.shop.guestMemoId)) {
      delete state.shop.guestMemoId;
      delete state.shop.guestReplyId;
      conflict(summary, '작성일이 충돌한 메모는 연두에게 건넨 글에서 제외했습니다.');
    } else if (rejectedReplies.has(link(state.shop.guestMemoId, state.shop.guestReplyId))) {
      delete state.shop.guestReplyId;
      conflict(summary, '내용이 충돌한 답장은 연두의 뒷이야기에서 제외했습니다.');
    }
    if (rejectedMemos.has(state.shop.displayMemoId)) {
      delete state.shop.displayMemoId;
      conflict(summary, '작성일이 충돌한 메모는 매대에 올리지 않았습니다.');
    }
    // A backup from a clock set ahead should still finish a shift on this device.
    state.shop.openedAt = Math.min(state.shop.openedAt, Date.now());
    undo.shop = structuredClone(state.shop);
    summary.shop = 1;
  }
  return { summary, undo: changed || undo.shop || undo.business ? structuredClone(undo) : null };
}

export function undoImport(state, undo, date) {
  const summary = { memos: 0, originals: 0, replies: 0, conflicts: 0, reasons: [] };
  if (undo.business) {
    if (state.business && JSON.stringify(validateBusiness(state.business)) === JSON.stringify(validateBusiness(undo.business.after))) {
      if (undo.business.before) state.business = undo.business.before;
      else delete state.business;
    } else conflict(summary, '가져오기 뒤 진행한 영업은 유지했습니다.');
  }
  if (undo.shop) {
    if (Object.keys(state.shop || {}).length === Object.keys(undo.shop).length && Object.keys(undo.shop).every(key => state.shop?.[key] === undo.shop[key])) delete state.shop;
    else conflict(summary, '가져오기 뒤 운영한 책방 기록은 유지했습니다.');
  }
  const importedProps = new Map(undo.props.map((prop) => [prop.kind, prop]));
  state.props = state.props.filter((prop) => {
    const imported = importedProps.get(prop.kind);
    if (!imported) return true;
    if (sameProp(imported, prop)) return false;
    conflict(summary, '가져오기 뒤 다른 답장과 연결한 소품은 유지했습니다.');
    return true;
  });
  const linked = new Set(state.props.map((prop) => link(prop.memoId, prop.replyId)));
  if (state.shop?.guestReplyId) linked.add(link(state.shop.guestMemoId, state.shop.guestReplyId));
  const memos = new Map(state.memos.map((memo) => [memo.id, memo]));
  for (const delta of undo.memos) {
    const memo = memos.get(delta.id);
    if (!memo) {
      if (delta.before || !delta.after) conflict(summary, '가져오기 뒤 삭제한 메모를 다시 만들지 않았습니다.');
      continue;
    }
    if (memo.createdOn !== delta.createdOn) {
      conflict(summary, '작성일이 달라진 메모는 유지했습니다.');
      continue;
    }
    const importedReplies = new Map(delta.replies.map((reply) => [reply.id, reply]));
    memo.replies = memo.replies.filter((reply) => {
      const imported = importedReplies.get(reply.id);
      if (!imported) return true;
      if (sameReply(imported, reply) && !linked.has(link(memo.id, reply.id))) {
        summary.replies += 1;
        return false;
      }
      conflict(summary, '가져오기 뒤 바뀌었거나 현재 소품과 연결된 답장은 유지했습니다.');
      return true;
    });
    if (!delta.after) continue;
    const sameOriginal = memo.text === delta.after.text && memo.updatedAt === delta.after.updatedAt;
    if (delta.before && sameOriginal) {
      Object.assign(memo, delta.before);
      summary.originals += 1;
    } else if (!delta.before && sameOriginal && !memo.replies.length && memo.id === state.shop?.guestMemoId) {
      conflict(summary, '가져오기 뒤 연두에게 건넨 메모는 유지했습니다.');
    } else if (!delta.before && sameOriginal && !memo.replies.length && memo.id === state.shop?.displayMemoId) {
      conflict(summary, '가져오기 뒤 매대에 올린 메모는 유지했습니다.');
    } else if (!delta.before && sameOriginal && !memo.replies.length) {
      memos.delete(memo.id);
      summary.memos += 1;
    } else {
      conflict(summary, '가져오기 뒤 원문을 수정했거나 새 답장을 단 메모는 유지했습니다.');
    }
  }
  state.memos = state.memos.filter((memo) => memos.has(memo.id));
  const appliedDates = new Map(undo.daily.map((entry) => [entry.date, entry]));
  state.daily = state.daily.flatMap((entry) => {
    const change = appliedDates.get(entry.date);
    if (change && sameDaily(entry, change.after)) {
      return change.before && (change.before.memoId === null || memos.has(change.before.memoId))
        ? [change.before] : [];
    }
    if (change) conflict(summary, '가져오기 뒤 다시 바뀐 입간판 기록은 유지했습니다.');
    if (entry.memoId !== null && !memos.has(entry.memoId)) return [{ ...entry, memoId: null }];
    return [entry];
  });
  selectDaily(state, date);
  return summary;
}
