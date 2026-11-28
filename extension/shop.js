const HAIR = [
  ['#59413a','#997157'], ['#3e414d','#727587'], ['#90543b','#c98654'],
  ['#775249','#b98370'], ['#6a605d','#b0a39a'], ['#9b783f','#d8b166']
];
const SKIN = [
  ['#ffd7aa','#dc9c73'], ['#edbd90','#c68864'], ['#ca9269','#a46c51'], ['#a97355','#84553f']
];
const styles = ['bob', 'crop', 'bun', 'waves', 'sidepart'];
const layers = ['vest', 'cardigan', 'apron', 'jacket'];
const accessories = ['none', 'scarf', 'satchel', 'glasses', 'ribbon', 'cap'];
const appearances = new Map();

function identity(id) {
  let hash = 2166136261;
  for (const ch of id) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
  return (hash ^ hash >>> 16) >>> 0;
}

function appearance(seed) {
  if (appearances.has(seed)) return appearances.get(seed);
  let bits = seed;
  const pick = count => {
    const value = bits % count;
    bits = Math.floor(bits / count);
    return value;
  };
  const sprite = pick(styles.length);
  const [hair, highlight] = HAIR[pick(HAIR.length)];
  const [skin, cheek] = SKIN[pick(SKIN.length)];
  const garment = layers[pick(layers.length)];
  const style = accessories[pick(accessories.length)];
  const hue = pick(180) * 2;
  const light = 45 + pick(12);
  const person = {sprite, hair, highlight, skin, cheek, haircut:styles[sprite], garment, style, hue,
    coat:'hsl(' + hue + ' 40% ' + light + '%)', shade:'hsl(' + hue + ' 34% ' + (light - 17) + '%)',
    trim:'hsl(' + ((hue + 25) % 360) + ' 48% 75%)'};
  if (appearances.size >= 32) appearances.delete(appearances.keys().next().value);
  appearances.set(seed, person);
  return person;
}

const COLOR_NAMES = [[15, '빨간'], [40, '주황'], [65, '노란'], [100, '연두'], [150, '초록'],
  [190, '청록'], [215, '하늘색'], [250, '파란'], [290, '보라'], [345, '자주'], [360, '빨간']];
const GARMENT_NAMES = { vest: '조끼', cardigan: '카디건', apron: '앞치마', jacket: '재킷' };
const ACCESSORY_NAMES = { none: '', scarf: '목도리 두른 ', satchel: '가방 멘 ', glasses: '안경 쓴 ', ribbon: '리본 단 ', cap: '모자 쓴 ' };

// Bonds are derived from replies and signboard history, so they need no stored
// counters, merge rules, or undo journal. Points count distinct days, which
// keeps several replies on one day from inflating a bond.
export const BOND_TIERS = [
  { min: 0, name: '새 단골' },
  { min: 2, name: '낯익은 단골' },
  { min: 5, name: '반가운 단골' },
  { min: 9, name: '오랜 단골' },
  { min: 14, name: '책방 친구' }
];
export const BOND_POINTS = { sameDay: 1, revisit: 2, request: 3 };
export const REGULAR_TIER = 2;

export function regularOf(memoId) {
  const person = appearance(identity(memoId));
  const color = COLOR_NAMES.find(([limit]) => person.hue < limit)[1];
  const name = ACCESSORY_NAMES[person.style] + color + ' ' + GARMENT_NAMES[person.garment] + ' 손님';
  return { person, name };
}

export function requestDates(daily) {
  const dates = new Map();
  for (const entry of daily) {
    if (!entry.memoId || entry.folded) continue;
    if (!dates.has(entry.memoId)) dates.set(entry.memoId, new Set());
    dates.get(entry.memoId).add(entry.date);
  }
  return dates;
}

export function bondOf(memo, daily) {
  return scoreBond(memo, requestDates(daily).get(memo.id));
}

function scoreBond(memo, requested = new Set()) {
  const days = new Set(memo.replies.map(reply => reply.createdOn));
  let points = 0, requests = 0, revisits = 0;
  for (const day of days) {
    if (requested.has(day)) {
      points += BOND_POINTS.request;
      requests += 1;
    } else if (day !== memo.createdOn) {
      points += BOND_POINTS.revisit;
      revisits += 1;
    } else {
      points += BOND_POINTS.sameDay;
    }
  }
  let tier = 0;
  while (tier + 1 < BOND_TIERS.length && points >= BOND_TIERS[tier + 1].min) tier += 1;
  const next = BOND_TIERS[tier + 1];
  return { points, tier, title: BOND_TIERS[tier].name, requests, revisits,
    nextTitle: next?.name ?? null, remaining: next ? next.min - points : 0,
    floor: BOND_TIERS[tier].min, ceiling: next?.min ?? points };
}

export function bondRoster(state) {
  const requested = requestDates(state.daily);
  return state.memos.map(memo => ({ memo, ...regularOf(memo.id), bond: scoreBond(memo, requested.get(memo.id)) }))
    .sort((a, b) => b.bond.points - a.bond.points || b.memo.createdOn.localeCompare(a.memo.createdOn)
      || (a.memo.id < b.memo.id ? -1 : a.memo.id > b.memo.id ? 1 : 0));
}

export function newShop() {
  return { days: 0, coins: 0, hearts: 0, level: 1, seat: 'window', plan: 'reading', openedAt: 0, decor: 0 };
}

export const DEFAULT_NAME = '골목 책방';

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
