import { validateShop } from './shop.js';
import { validateBusiness } from './business.js';

const VERSION = 1;
export const NOTE_LIMIT = 2000;
export const PROP_KINDS = ['chair', 'plant', 'books'];

export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function localDate(now = new Date()) {
  const digits = (number) => String(number).padStart(2, '0');
  return `${now.getFullYear()}-${digits(now.getMonth() + 1)}-${digits(now.getDate())}`;
}

export function emptyState() {
  return { version: VERSION, memos: [], daily: [], props: [] };
}

export function selectDaily(state, date) {
  const existing = state.daily.find((entry) => entry.date === date);
  if (existing) return existing;

  const lastSeen = new Map();
  for (const entry of state.daily) {
    if (entry.memoId && entry.date < date && entry.date > (lastSeen.get(entry.memoId) || '')) {
      lastSeen.set(entry.memoId, entry.date);
    }
  }

  const candidates = state.memos.filter((memo) => !memo.documentMissing && memo.createdOn < date);
  const yesterday = previousDate(date);
  const mostRecent = [...lastSeen].find(([, seenOn]) => seenOn === yesterday)?.[0];
  const eligible = candidates.length > 1 ? candidates.filter((memo) => memo.id !== mostRecent) : candidates;
  eligible.sort((a, b) => compare(lastSeen.get(a.id) || '', lastSeen.get(b.id) || '')
    || compare(a.createdOn, b.createdOn) || compare(a.id, b.id));

  const chosen = { date, memoId: eligible[0]?.id ?? null, folded: false };
  state.daily.push(chosen);
  return chosen;
}

function compare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function previousDate(date) {
  const yesterday = new Date(date + 'T00:00:00Z');
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return yesterday.toISOString().slice(0, 10);
}

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const validId = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const validReply = (value) => typeof value === 'string' && value.length <= NOTE_LIMIT && Boolean(value.trim()) && !/[\r\n]/.test(value);
const validText = (value) => typeof value === 'string' && value.length <= 4 * 1024 * 1024;
const formats = new Set(['markdown', 'text', 'plantuml', 'mermaid']);
const validTime = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000;

export function backupSnapshot(state) {
  return validateBackup(state, { local: true });
}

export function validateBackup(value, { local = false } = {}) {
  function require(condition) {
    if (!condition) throw new Error('jjokmun에서 내보낸 올바른 JSON 백업 파일을 선택해 주세요.');
  }
  require(object(value) && value.version === VERSION
    && Array.isArray(value.memos) && (local || value.memos.length <= 10_000)
    && Array.isArray(value.daily) && (local || value.daily.length <= 20_000)
    && Array.isArray(value.props) && value.props.length <= PROP_KINDS.length);

  const memosById = new Map();
  let replyCount = 0;
  const memos = value.memos.map((memo) => {
    require(object(memo) && validId(memo.id) && !memosById.has(memo.id) && validText(memo.text)
      && validDate(memo.createdOn) && validTime(memo.updatedAt) && Array.isArray(memo.replies)
      && (local || memo.replies.length <= 5_000));
    replyCount += memo.replies.length;
    require(local || replyCount <= 30_000);
    const replyIds = new Set();
    const replies = memo.replies.map((reply) => {
      require(object(reply) && validId(reply.id) && !replyIds.has(reply.id) && validReply(reply.text)
        && validDate(reply.createdOn) && validTime(reply.createdAt));
      replyIds.add(reply.id);
      return { id: reply.id, text: reply.text, createdOn: reply.createdOn, createdAt: reply.createdAt };
    });
    const clean = { id: memo.id, text: memo.text, createdOn: memo.createdOn, updatedAt: memo.updatedAt, replies };
    if (memo.documentFormat !== undefined) {
      require(formats.has(memo.documentFormat));
      clean.documentFormat = memo.documentFormat;
    }
    if (memo.createdAt !== undefined) {
      require(validTime(memo.createdAt));
      clean.createdAt = memo.createdAt;
    }
    memosById.set(clean.id, clean);
    return clean;
  });

  const dates = new Set();
  const daily = value.daily.map((entry) => {
    require(object(entry) && validDate(entry.date) && !dates.has(entry.date) && typeof entry.folded === 'boolean');
    const memo = memosById.get(entry.memoId);
    require(entry.memoId === null || (memo && memo.createdOn < entry.date));
    dates.add(entry.date);
    return { date: entry.date, memoId: entry.memoId, folded: entry.folded };
  });

  const kinds = new Set();
  const linkedReplies = new Set();
  const props = value.props.map((prop) => {
    require(object(prop) && PROP_KINDS.includes(prop.kind) && !kinds.has(prop.kind));
    const key = `${prop.memoId}/${prop.replyId}`;
    require(!linkedReplies.has(key) && memosById.get(prop.memoId)?.replies.some((reply) => reply.id === prop.replyId));
    kinds.add(prop.kind);
    linkedReplies.add(key);
    return { kind: prop.kind, memoId: prop.memoId, replyId: prop.replyId };
  });
  const clean = { version: VERSION, memos, daily, props };
  if (value.business !== undefined) clean.business = validateBusiness(value.business);
  if (value.shop !== undefined) {
    clean.shop = validateShop(value.shop);
    if (value.shop.guestMemoId !== undefined) {
      require(memosById.has(value.shop.guestMemoId));
      clean.shop.guestMemoId = value.shop.guestMemoId;
    }
    if (value.shop.guestReplyId !== undefined) {
      require(memosById.get(clean.shop.guestMemoId)?.replies.some(reply => reply.id === value.shop.guestReplyId));
      clean.shop.guestReplyId = value.shop.guestReplyId;
    }
    if (value.shop.displayMemoId !== undefined) {
      require(memosById.has(value.shop.displayMemoId));
      clean.shop.displayMemoId = value.shop.displayMemoId;
    }
  }
  return clean;
}
