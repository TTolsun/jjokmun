// One opening is replayable from its start time. Animation never writes to disk.
export const REGULARS = [
  { name: '유리', hair: '#543d37', coat: '#bb6860', style: 'ribbon', seat: 'window', plan: 'reading' },
  { name: '도담', hair: '#413f4b', coat: '#60899c', seat: 'garden', plan: 'picks', cap: true },
  { name: '솔', hair: '#79553c', coat: '#a4984d', style: 'satchel', seat: 'garden', plan: 'reading' },
  { name: '민', hair: '#55455b', coat: '#977b9e', seat: 'window', plan: 'picks', glasses: true },
  { name: '봄', hair: '#785349', coat: '#658e75', style: 'bun', seat: 'garden', plan: 'reading' }
];

export function newShop() {
  return { days: 0, coins: 0, hearts: 0, level: 1, seat: 'window', plan: 'reading', openedAt: 0, decor: 0 };
}

export const VISIT_MS = 18000;

// Rebuild visits from successful writes, so reloading and opening a second tab
// replay the same crowd without awarding another visit for an edit.
export function bookTraffic(memos, now) {
  let featured;
  const recent = [];
  function record(at, size) {
    if (at <= now && now - at < VISIT_MS + 1200) recent.push({ at, size });
  }
  for (const memo of memos) {
    const newer = !featured || memo.createdOn > featured.createdOn ||
      (memo.createdOn === featured.createdOn && (memo.createdAt ?? 0) >= (featured.createdAt ?? 0));
    if (!featured || memo.replies.length > featured.replies.length ||
      (memo.replies.length === featured.replies.length && newer)) featured = memo;
    record(memo.createdAt, 3);
    for (const reply of memo.replies) record(reply.createdAt, 2);
  }
  const arrivals = [];
  for (const { at, size } of recent.sort((a, b) => a.at - b.at).slice(-5)) {
    for (let i = 0; i < size; i++) arrivals.push(at + i * 550);
  }
  return { featured, arrivals: arrivals.slice(-9) };
}

export function validateShop(shop) {
  if (!shop || !['days', 'coins', 'hearts', 'openedAt', 'level', 'decor'].every(
    key => Number.isSafeInteger(shop[key]) && shop[key] >= 0 && shop[key] <= Number.MAX_SAFE_INTEGER / 2)
    || shop.level < 1 || shop.level > 3 || shop.decor > 3
    || !['window', 'garden'].includes(shop.seat) || !['reading', 'picks'].includes(shop.plan)) {
    throw new Error('책방 운영 기록의 형식이 올바르지 않습니다.');
  }
  const { days, coins, hearts, level, seat, plan, openedAt, decor } = shop;
  return { days, coins, hearts, level, seat, plan, openedAt, decor };
}

export const upgradeCost = level => level * 18;
export const COLLECTOR_REPUTATION = 8;
const collector = { name: '헌책 수집가 별', hair: '#9a826f', coat: '#695b7e', seat: 'window', plan: 'picks', glasses: true };

export function schedule(shop) {
  const visitors = [];
  let seatFree = 0;
  let registerFree = 0;
  const regularCount = shop.level + 2;
  const hasCollector = shop.hearts >= COLLECTOR_REPUTATION;
  for (let i = 0; i < regularCount + Number(hasCollector); i++) {
    const person = i === regularCount ? collector : REGULARS[(shop.days + i) % REGULARS.length];
    const enters = i * 3.6;
    const reads = shop.plan === 'reading' || person.plan === 'reading';
    const browseEnd = enters + (shop.plan === 'picks' ? 4 : 5.5);
    const seatStart = reads ? Math.max(browseEnd + 2, seatFree) : 0;
    const seatEnd = reads ? seatStart + 3.5 : 0;
    if (reads) seatFree = seatEnd + 1.5;
    const checkout = Math.max((reads ? seatEnd : browseEnd) + 2.5, registerFree);
    registerFree = checkout + 2.5;
    const favorites = [];
    if (person.plan === shop.plan) favorites.push('운영 방침');
    if (reads && person.seat === shop.seat) favorites.push('열람석');
    if (shop.decor > i) favorites.push('책방 소품');
    const hearts = favorites.length;
    const coins = 4 + shop.level + (shop.plan === 'picks' ? 2 : 0) + hearts;
    visitors.push({ person, i, enters, browseEnd, reads, seatStart, seatEnd, checkout, paid: checkout + 1.6, hearts, favorites, coins });
  }
  return visitors;
}

export function shiftSeconds(visitors) {
  return visitors[visitors.length - 1].paid + 2;
}

export function totals(visitors, elapsed) {
  const result = { served: 0, coins: 0, hearts: 0 };
  for (const visitor of visitors) {
    if (elapsed < visitor.paid) continue;
    result.served++;
    result.coins += visitor.coins;
    result.hearts += visitor.hearts;
  }
  return result;
}

export function operate(shop, action, value, now) {
  if (action === 'settle') {
    const visitors = schedule(shop);
    if (!shop.openedAt || now - shop.openedAt < shiftSeconds(visitors) * 1000) return false;
    const result = totals(visitors, Infinity);
    shop.coins += result.coins;
    shop.hearts += result.hearts;
    shop.days++;
    shop.openedAt = shop.decor = 0;
    return true;
  }
  if (shop.openedAt) return false;
  if (action === 'open') {
    shop.openedAt = now;
    shop.decor = 0;
  } else if (action === 'upgrade' && shop.level < 3 && shop.coins >= upgradeCost(shop.level)) {
    shop.coins -= upgradeCost(shop.level);
    shop.level++;
  } else if (action === 'seat' && ['window', 'garden'].includes(value)) {
    shop.seat = value;
  } else if (action === 'plan' && ['reading', 'picks'].includes(value)) {
    shop.plan = value;
  } else {
    return false;
  }
  return true;
}
