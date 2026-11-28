// Earlier backups include furniture positions in floor pixels and the original path constraints.
const FURNITURE_BOUNDS = {
  literature: [-12, -8, 12, 3],
  travel: [-12, -8, 12, 3],
  cart: [-11, -11, 11, 3],
  desk: [-20, -17, 21, 5],
  chair: [-8, -7, 8, 6],
  table: [-10, -4, 10, 10]
};
const keys = Object.keys(FURNITURE_BOUNDS);
const WIDTH = 23, HEIGHT = 11, SIZE = WIDTH * HEIGHT;
const ENTRANCE = 241; // (96, 116)
const MAX_TICKS = 240;
const LOYALTY_COUNT = 10;
const TARGETS = ['literature', 'travel', 'cart', 'desk'];
const floorPoint = cell => [8 + cell % WIDTH * 8, 36 + Math.floor(cell / WIDTH) * 8];
const adjacent = Array.from({ length: SIZE }, (_, c) => [c-WIDTH,c+1,c-1,c+WIDTH].filter(n =>
  n >= 0 && n < SIZE && Math.abs(c % WIDTH - n % WIDTH) <= 1));
function bounds(key, [x, y]) {
  const [left, top, right, bottom] = FURNITURE_BOUNDS[key];
  return [x + left, y + top, x + right, y + bottom];
}
function intersects(a, b) { return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]; }
function distances(start, walkable) {
  const dist = new Int16Array(SIZE).fill(-1);
  const queue = [start];
  dist[start] = 0;
  for (let i = 0; i < queue.length; i++) {
    for (const n of adjacent[queue[i]]) if (walkable[n] && dist[n] < 0) {
      dist[n] = dist[queue[i]] + 1;
      queue.push(n);
    }
  }
  return dist;
}
function hasPaths(layout) {
  const boxes = keys.map(key => bounds(key, layout[key]));
  const walkable = Array.from({ length: SIZE }, (_, cell) => {
    const [x,y] = floorPoint(cell);
    return !boxes.some(([l,t,r,b]) => x >= l-1 && x <= r+1 && y >= t-1 && y <= b+1);
  });
  const exit = distances(ENTRANCE, walkable);
  function nearest(x, y) {
    let best = ENTRANCE, cost = Infinity;
    for (let c = 0; c < SIZE; c++) {
      if (exit[c] < 0) continue;
      const [cx,cy] = floorPoint(c);
      const d = (cx-x)**2 + (cy-y)**2;
      if (d < cost) { cost = d; best = c; }
    }
    return best;
  }
  return TARGETS.every(key => {
    const [x, y] = layout[key];
    const front = y + FURNITURE_BOUNDS[key][3] + 5;
    const [goalX, goalY] = floorPoint(nearest(x, front));
    return Math.hypot(goalX - x, goalY - front) <= 12;
  });
}
function validLayout(layout) {
  const boxes = keys.map(key => bounds(key, layout[key]));
  return boxes.every((box, index) => box[0] >= 2 && box[1] >= 34 && box[2] <= 190 && box[3] <= 118
    && !intersects(box, [84, 109, 106, 121])
    && !boxes.slice(index + 1).some(other => intersects(box, other)))
    && hasPaths(layout);
}
export function validateBusiness(b) {
  const invalid = () => { throw new Error('책방 영업 기록을 읽을 수 없습니다.'); };
  const point = p => Array.isArray(p) && p.length === 2 && p.every(Number.isSafeInteger);
  if (!b || !Number.isSafeInteger(b.days) || b.days < 0 || !Number.isSafeInteger(b.started) || b.started < 0
    || !b.opening || !keys.every(k => point(b.opening[k])) || !Array.isArray(b.moves) || b.moves.length > (MAX_TICKS+1)*keys.length
    || !Array.isArray(b.loyalty) || b.loyalty.length !== LOYALTY_COUNT || b.loyalty.some(n => ![0,1,2].includes(n))) invalid();
  const opening = Object.fromEntries(keys.map(k => [k, [...b.opening[k]]]));
  const layout = { ...opening };
  if (!validLayout(layout)) invalid();
  let tick = 0;
  const moves = b.moves.map((m, i) => {
    if (!m || !keys.includes(m.key) || !point(m.point) || !Number.isInteger(m.tick) || m.tick < tick || m.tick > MAX_TICKS) invalid();
    tick = m.tick;
    layout[m.key] = m.point;
    if (b.moves[i+1]?.tick !== tick && !validLayout(layout)) invalid();
    return { tick, key: m.key, point: [...m.point] };
  });
  return { days: b.days, started: b.started, opening, moves, loyalty: [...b.loyalty] };
}
