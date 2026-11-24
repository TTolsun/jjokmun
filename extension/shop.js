const REGULARS = [
  { sprite: 0, hair: '#903f3d', highlight: '#d47757', coat: '#b54e51', shade: '#78383e', style: 'ribbon' },
  { sprite: 1, hair: '#54342d', highlight: '#96634a', coat: '#5588ad', shade: '#345b77', style: 'cap' },
  { sprite: 2, hair: '#815036', highlight: '#c79153', coat: '#c99c48', shade: '#8a6535', style: 'satchel' },
  { sprite: 3, hair: '#b58f52', highlight: '#f1d794', coat: '#9772a4', shade: '#634971', style: 'glasses' },
  { sprite: 4, hair: '#41363f', highlight: '#74545c', coat: '#618e68', shade: '#3e604f', style: 'bun' }
];

export function newShop() {
  return { days: 0, coins: 0, hearts: 0, level: 1, seat: 'window', plan: 'reading', openedAt: 0, decor: 0 };
}

export const DEFAULT_NAME = '골목 책방';
export const VISIT_MS = 18000;

export function bookTraffic(memos, now = Date.now()) {
  let featured;
  let latestActivity = 0;
  const readers = memos.map(memo => {
    let seed = 0;
    for (const ch of memo.id) seed = (Math.imul(seed, 31) + ch.charCodeAt(0)) >>> 0;
    const at = memo.replies.reduce((latest, reply) => Math.max(latest, reply.createdAt), memo.createdAt || 0);
    latestActivity = Math.max(latestActivity, at);
    const newer = !featured || memo.createdOn > featured.createdOn ||
      (memo.createdOn === featured.createdOn && (memo.createdAt || 0) >= (featured.createdAt || 0));
    if (!featured || memo.replies.length > featured.replies.length ||
      (memo.replies.length === featured.replies.length && newer)) featured = memo;
    return { at, seed, person: REGULARS[seed % REGULARS.length] };
  });
  const recent = readers.filter(reader => reader.at >= now - VISIT_MS).sort((a, b) => b.at - a.at).slice(0, 9);
  return { readers, recent, featured, latestActivity };
}

// One reader per memo. Reconstruct arrivals from wall time so returning tabs agree.
export function visitsAt(traffic, now) {
  const { readers, latestActivity } = traffic;
  if (!readers.length) return [];
  const arrivals = new Map();
  const interval = Math.max(3200, Math.ceil(25000 / readers.length));
  const ticket = Math.floor(now / interval);
  for (let t = ticket; t * interval > now - VISIT_MS; t--) {
    const reader = readers[t % readers.length];
    if (!arrivals.has(reader)) arrivals.set(reader, t * interval);
  }
  for (const reader of traffic.recent) {
    if (reader.at <= now && now - reader.at < VISIT_MS) arrivals.set(reader, reader.at);
  }
  const bestseller = now >= latestActivity && now - latestActivity < VISIT_MS;
  return Array.from(arrivals, ([reader, at]) => ({ ...reader, at, bestseller }));
}

export function validateShop(shop) {
  if (!shop || !['days', 'coins', 'hearts', 'openedAt', 'level', 'decor'].every(
    key => Number.isSafeInteger(shop[key]) && shop[key] >= 0 && shop[key] <= Number.MAX_SAFE_INTEGER / 2)
    || shop.level < 1 || shop.level > 3 || shop.decor > 3
    || !['window', 'garden'].includes(shop.seat) || !['reading', 'picks'].includes(shop.plan)) {
    throw new Error('책방 운영 기록의 형식이 올바르지 않습니다.');
  }
  const { days, coins, hearts, level, seat, plan, openedAt, decor } = shop;
  const clean = { days, coins, hearts, level, seat, plan, openedAt, decor };
  if (shop.name !== undefined) {
    if (typeof shop.name !== 'string' || !shop.name.trim() || shop.name.length > 40 || /[\r\n]/.test(shop.name)) {
      throw new Error('책방 이름을 1~40자로 입력해 주세요.');
    }
    clean.name = shop.name.trim();
  }
  return clean;
}
