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
  const person = {sprite, hair, highlight, skin, cheek, haircut:styles[sprite], garment, style,
    coat:'hsl(' + hue + ' 40% ' + light + '%)', shade:'hsl(' + hue + ' 34% ' + (light - 17) + '%)',
    trim:'hsl(' + ((hue + 25) % 360) + ' 48% 75%)'};
  if (appearances.size >= 32) appearances.delete(appearances.keys().next().value);
  appearances.set(seed, person);
  return person;
}

export function newShop() {
  return { days: 0, coins: 0, hearts: 0, level: 1, seat: 'window', plan: 'reading', openedAt: 0, decor: 0 };
}

export const DEFAULT_NAME = '골목 책방';
export const VISIT_MS = 18000;

export function bookTraffic(memos, now = Date.now()) {
  let featured;
  let latestActivity = 0;
  const readers = memos.map(memo => {
    const seed = identity(memo.id);
    const at = memo.replies.reduce((latest, reply) => Math.max(latest, reply.createdAt), memo.createdAt || 0);
    latestActivity = Math.max(latestActivity, at);
    const newer = !featured || memo.createdOn > featured.createdOn ||
      (memo.createdOn === featured.createdOn && (memo.createdAt || 0) >= (featured.createdAt || 0));
    if (!featured || memo.replies.length > featured.replies.length ||
      (memo.replies.length === featured.replies.length && newer)) featured = memo;
    return { at, seed };
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
  return Array.from(arrivals, ([reader, at]) => ({ ...reader, person: appearance(reader.seed), at, bestseller }));
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
