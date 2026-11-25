// Furniture is stored in floor pixels. Only the shoppers' navigation uses tiles.
export const FURNITURE = {
  literature: { name: '문학 서가', origin: [47, 42], box: [-12, -8, 12, 3], height: 28 },
  travel: { name: '여행 서가', origin: [77, 42], box: [-12, -8, 12, 3], height: 28 },
  cart: { name: '신간 매대', origin: [136, 61], box: [-11, -11, 11, 3], height: 23 },
  desk: { name: '계산대', origin: [143, 89], box: [-20, -17, 21, 5], height: 20 },
  chair: { name: '의자', origin: [29, 77], box: [-8, -7, 8, 6], height: 17 },
  table: { name: '열람 테이블', origin: [24, 99], box: [-10, -4, 10, 10], height: 16 }
};
const keys = Object.keys(FURNITURE);
const WIDTH = 23, HEIGHT = 11, SIZE = WIDTH * HEIGHT;
const ENTRANCE = 241; // (96, 116)
export const STEP_MS = 340;
export const BREAK_MS = 14000;
const MAX_TICKS = 240;
const cohort = [[0,0,6],[4,2,6],[7,1,4],[10,2,5],[14,0,4],[18,2,5],[22,1,4],[25,2,4],[29,0,4],[33,2,6]];
const titles = ['literature', 'travel', 'cart'];
export const defaultLayout = () => Object.fromEntries(keys.map(key => [key, [...FURNITURE[key].origin]]));
export const floorPoint = cell => [8 + cell % WIDTH * 8, 36 + Math.floor(cell / WIDTH) * 8];
const adjacent = Array.from({ length: SIZE }, (_, c) => [c-WIDTH,c+1,c-1,c+WIDTH].filter(n =>
  n >= 0 && n < SIZE && Math.abs(c % WIDTH - n % WIDTH) <= 1));
function bounds(key, [x, y]) {
  const [left, top, right, bottom] = FURNITURE[key].box;
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
function navigation(layout) {
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
  const paths = { exit };
  let accessible = true;
  for (const key of [...titles, 'desk']) {
    const [x,y] = layout[key];
    const front = y + FURNITURE[key].box[3] + 5;
    const goal = nearest(x, front);
    const [gx,gy] = floorPoint(goal);
    if (Math.hypot(gx-x, gy-front) > 12) accessible = false;
    paths[key] = distances(goal, walkable);
  }
  return { paths, nearest, accessible };
}
export function placementError(layout, key, point) {
  const box = bounds(key, point);
  if (box[0] < 2 || box[1] < 34 || box[2] > 190 || box[3] > 118) return '가구 전체가 책방 바닥 안에 들어와야 해요.';
  if (intersects(box, [84,109,106,121])) return '손님이 드나드는 출입구를 비워 주세요.';
  if (keys.some(other => other !== key && intersects(box, bounds(other, layout[other])))) return '다른 가구와 겹쳐요.';
  if (!navigation({ ...layout, [key]: point }).accessible) return '손님이 서가와 계산대 앞까지 걸어갈 통로가 필요해요.';
  return '';
}
export function currentLayout(b) {
  const layout = { ...b.opening };
  for (const move of b.moves) layout[move.key] = move.point;
  return layout;
}
function step(cell, dist) {
  return adjacent[cell].find(next => dist[next] >= 0 && dist[next] < dist[cell]) ?? cell;
}

function simulate(opening, moves) {
  let layout = { ...opening }, nav = navigation(layout), cursor = 0;
  const guests = [], frames = [], buyers = [], losses = [], stock = [8,8,8], stops = [0,0,0];
  let event = '문이 열렸어요. 첫 손님이 들어옵니다.';
  for (let tick = 0; tick < MAX_TICKS; tick++) {
    if (moves[cursor]?.tick === tick) {
      let deskMoved = false;
      while (moves[cursor]?.tick === tick) {
        const move = moves[cursor++];
        layout[move.key] = move.point;
        if (move.key === 'desk') deskMoved = true;
      }
      nav = navigation(layout);
      for (const g of guests) {
        if (nav.paths.exit[g.cell] < 0) g.cell = nav.nearest(...floorPoint(g.cell));
        if (g.phase === 'pay' && deskMoved) g.phase = 'queue';
      }
    }
    for (const [id, [arrival, title, patience]] of cohort.entries()) {
      if (tick === arrival) guests.push({ id, title, patience, cell: ENTRANCE, phase: 'walk', wait: 0, carrying: false });
    }
    for (const g of guests) {
      g.from = g.cell;
      if (g.phase === 'gone') continue;
      if (g.phase === 'read' || g.phase === 'pay') {
        if (--g.time > 0) continue;
        if (g.phase === 'pay') {
          buyers.push(g.id);
          event = '책을 산 손님이 출입구로 향합니다.';
          g.phase = 'exit';
        } else if (stock[g.title]) {
          stock[g.title]--;
          g.carrying = true;
          g.phase = 'queue';
        } else g.phase = 'exit';
        continue;
      }
      const paths = nav.paths;
      if (g.phase === 'walk') {
        const target = g.title === 2 ? (g.id % 3 === 0 ? 'literature' : 'travel') : titles[g.title];
        if (g.title === 2 ? paths.cart[g.cell] <= 2 : paths[target][g.cell] === 0) {
          g.phase = 'read';
          g.time = 4;
          stops[g.title]++;
          event = FURNITURE[titles[g.title]].name + '에서 손님이 책을 펼칩니다.';
        } else if (paths[target][g.cell] === 0) {
          g.phase = 'exit';
          event = '가게를 한 바퀴 돌아본 손님이 빈손으로 나갑니다.';
        } else g.cell = step(g.cell, paths[target]);
      } else if (g.phase === 'queue') {
        const next = step(g.cell, paths.desk);
        const blocked = guests.some(other => other !== g && other.cell === next && ['queue','read','pay'].includes(other.phase));
        if (blocked) {
          event = '책을 든 손님이 통로에서 기다립니다.';
          if (++g.wait >= g.patience) {
            stock[g.title]++;
            losses.push(g.cell);
            g.carrying = false;
            g.phase = 'leave';
            event = '기다리던 손님이 책을 내려놓고 돌아섭니다.';
          }
        } else if (paths.desk[g.cell] === 0) {
          g.phase = 'pay';
          g.time = 5;
        } else g.cell = next;
      } else if (g.cell === ENTRANCE) g.phase = 'gone';
      else g.cell = step(g.cell, paths.exit);
    }
    const people = guests.filter(g => g.phase !== 'gone').map(g => ({ ...g }));
    frames.push({ people, event, buyers: [...buyers] });
    if (!people.length && guests.length === cohort.length) break;
  }
  return { frames, buyers, losses, stops };
}
const cache = new Map();
export function dayFor(b) {
  const signature = JSON.stringify([b.opening, b.moves]);
  if (!cache.has(signature)) {
    if (cache.size >= 5) cache.delete(cache.keys().next().value);
    cache.set(signature, simulate(b.opening, b.moves));
  }
  return cache.get(signature);
}
// Memos are the books on sale. The new-release cart prefers memos written in
// the last week and the two shelves prefer older ones; either falls back to
// any memo when its own pool is empty. Each reader only sees memos that
// existed when that reader opened a book and takes an unread one first, so
// earlier picks never change when a memo is written mid-day and the newest
// memo goes to the very next reader. The memo on today's signboard is the
// book a returning regular asks for: the first shelf reader opens it.
export const NEW_RELEASE_MS = 7 * 86400000;
const writtenAt = memo => memo.createdAt ?? Date.parse(memo.createdOn + 'T00:00:00');
export function memoBooks(b, memos, requestedId) {
  const day = dayFor(b);
  const readers = [];
  day.frames.forEach((frame, index) => {
    for (const person of frame.people) {
      if (person.phase === 'read' && !readers.some(r => r.id === person.id)) {
        readers.push({ id: person.id, cart: person.title === 2, at: b.started + index * STEP_MS });
      }
    }
  });
  const newest = [...memos].sort((x, y) => writtenAt(y) - writtenAt(x) || (x.id < y.id ? -1 : 1));
  const picks = new Map();
  const picked = new Set();
  let request = newest.find(memo => memo.id === requestedId);
  for (const [rank, reader] of readers.entries()) {
    const existing = newest.filter(memo => writtenAt(memo) <= reader.at);
    if (!reader.cart && request && existing.includes(request)) {
      picks.set(reader.id, request);
      picked.add(request.id);
      request = undefined;
      continue;
    }
    const fresh = existing.filter(memo => reader.at - writtenAt(memo) < NEW_RELEASE_MS);
    const old = existing.filter(memo => reader.at - writtenAt(memo) >= NEW_RELEASE_MS);
    // Rotate the older shelves by business day so different memos resurface.
    if (old.length) old.push(...old.splice(0, (b.days * 3) % old.length));
    const preferred = reader.cart ? fresh : old;
    const pool = preferred.length ? preferred : existing;
    const memo = pool.find(item => !picked.has(item.id)) ?? pool[rank % (pool.length || 1)];
    if (memo) { picks.set(reader.id, memo); picked.add(memo.id); }
  }
  return picks;
}
export function firstBusiness(now) {
  return { days: 0, started: now, opening: defaultLayout(), moves: [], loyalty: cohort.map(() => 0) };
}
export function currentShift(b, now) {
  const day = dayFor(b);
  const closes = b.started + day.frames.length * STEP_MS;
  const opens = closes + BREAK_MS;
  const elapsed = Math.max(0, (now - b.started) / STEP_MS);
  const frame = day.frames[Math.min(day.frames.length - 1, Math.floor(elapsed))];
  return { day, frame, closed: now >= closes, opens, elapsed };
}
// Resolve missed days in two batches: the edited day, then identical days at
// the final layout. Reopening a vault after months costs no per-day replay.
export function advanceBusiness(b, now) {
  let shift = currentShift(b, now);
  if (now < shift.opens) return false;
  function finish(count) {
    for (const id of shift.day.buyers) b.loyalty[id] = Math.min(2, b.loyalty[id] + count);
    b.days += count;
    b.started += (shift.opens - b.started) * count;
  }
  finish(1);
  b.opening = currentLayout(b);
  b.moves = [];
  shift = currentShift(b, now);
  const extra = Math.floor((now - b.started) / (shift.opens - b.started));
  if (extra > 0) finish(extra);
  return true;
}
export function moveFurniture(b, key, point, now) {
  advanceBusiness(b, now);
  const layout = currentLayout(b);
  const error = placementError(layout, key, point);
  if (error) throw new Error(error);
  if (layout[key][0] === point[0] && layout[key][1] === point[1]) return false;
  // A move made after closing belongs to tomorrow's layout. It must not
  // change the completed day's observations or visitors' purchase history.
  const shift = currentShift(b, now);
  const tick = Math.max(b.moves.at(-1)?.tick || 0, Math.min(shift.day.frames.length, Math.floor(shift.elapsed) + 1));
  b.moves = b.moves.filter(m => m.tick !== tick || m.key !== key);
  b.moves.push({ tick, key, point });
}
export function validateBusiness(b) {
  const invalid = () => { throw new Error('책방 영업 기록을 읽을 수 없습니다.'); };
  const point = p => Array.isArray(p) && p.length === 2 && p.every(Number.isSafeInteger);
  if (!b || !Number.isSafeInteger(b.days) || b.days < 0 || !Number.isSafeInteger(b.started) || b.started < 0
    || !b.opening || !keys.every(k => point(b.opening[k])) || !Array.isArray(b.moves) || b.moves.length > (MAX_TICKS+1)*keys.length
    || !Array.isArray(b.loyalty) || b.loyalty.length !== cohort.length || b.loyalty.some(n => ![0,1,2].includes(n))) invalid();
  const opening = Object.fromEntries(keys.map(k => [k, [...b.opening[k]]]));
  const layout = { ...opening };
  if (keys.some(k => placementError(layout, k, layout[k]))) invalid();
  let tick = 0;
  const moves = b.moves.map((m, i) => {
    if (!m || !keys.includes(m.key) || !point(m.point) || !Number.isInteger(m.tick) || m.tick < tick || m.tick > MAX_TICKS) invalid();
    tick = m.tick;
    layout[m.key] = m.point;
    if (b.moves[i+1]?.tick !== tick && keys.some(k => placementError(layout, k, layout[k]))) invalid();
    return { tick, key: m.key, point: [...m.point] };
  });
  return { days: b.days, started: b.started, opening, moves, loyalty: [...b.loyalty] };
}
