import { paintInterior, project, stamp } from './shop-interior.js';

const seatPoint = shop => shop.seat === 'window' ? [29, 78] : [173, 78];
const entrance = [94, 119];
const counter = [134, 97];

function along(points, fraction) {
  const lengths = points.slice(1).map(([x, y], i) => Math.abs(x - points[i][0]) + Math.abs(y - points[i][1]));
  let distance = Math.max(0, Math.min(1, fraction)) * lengths.reduce((sum, length) => sum + length, 0);
  for (let i = 0; i < lengths.length; i++) {
    if (lengths[i] && distance <= lengths[i]) {
      const [x, y] = points[i], [nextX, nextY] = points[i + 1];
      return [Math.round(x + (nextX - x) * distance / lengths[i]), Math.round(y + (nextY - y) * distance / lengths[i])];
    }
    distance -= lengths[i];
  }
  return points[points.length - 1];
}

export function guestPose(v, shop, time, still) {
  if (time < v.enters || time >= v.paid + 2) return null;
  const shelf = [47 + v.i % (shop.level + 1) * 22, 45 + v.i % 2 * 3];
  const seat = seatPoint(shop);
  const walk = (route, from, to, label) => ({
    xy: along(route, still ? 0.5 : (time - from) / (to - from)), label, walking: !still
  });
  const display = [44, 111];
  if (!v.reads) {
    if (time < v.enters + 2) return walk([entrance, [94, 111], display], v.enters, v.enters + 2, '추천대로 이동');
    if (time < v.browseEnd) return { xy: display, label: '추천 도서 고르는 중', browsing: true };
  } else {
    if (time < v.enters + 2) return walk([entrance, [94, 59], [shelf[0], 59], shelf], v.enters, v.enters + 2, '서가로 이동');
    if (time < v.browseEnd || time < v.seatStart - 2) return { xy: shelf, label: '책 고르는 중', browsing: true };
  }
  if (v.reads && time < v.seatStart) return walk([shelf, [shelf[0], 59], [seat[0], 59], seat], v.seatStart - 2, v.seatStart, '열람석으로 이동');
  if (v.reads && time < v.seatEnd) return { xy: seat, label: '독서 중', reading: true };
  const from = v.reads ? seat : display;
  const leave = v.reads ? v.seatEnd : v.browseEnd;
  if (time < v.checkout) {
    const aisle = v.reads ? [94, from[1]] : [94, 111];
    // The garden seat is beyond the counter. Approach from the front of the shop.
    const path = v.reads && shop.seat === 'garden' ? [from, [from[0], 97], counter]
      : [from, aisle, [94, 97], counter];
    return walk(path, leave, v.checkout, '계산대로 이동');
  }
  if (time < v.paid) return { xy: counter, label: '계산 중', paying: true };
  return walk([counter, [134, 109], [94, 109], entrance], v.paid, v.paid + 2, '귀가 중');
}

const head = [
  '....ooooo....',
  '..oohhhhoo...',
  '.ohhhllhhho..',
  'ohhlllhhhhho.',
  'ohhhhhhlhhho.',
  'ohhhhfhhfffo.',
  'ohhfffffffpo.',
  '.hhfpxffpxpo.',
  '.ohffxfffxso.',
  '..ofssfffspo.',
  '...osfffsso..',
  '....oossoo...'
];
const backOfHead = [
  '....ooooo....',
  '..oohhhhoo...',
  '.ohhhllhhho..',
  'ohhlllhhhhho.',
  'ohhhhhllhhho.',
  'ohhhhlhhhlho.',
  'ohhlhhhhhhoo.',
  '.ohlhhhhhhoo.',
  '.ohhhohohhso.',
  '..ohhhhhhos..',
  '...oooooos...',
  '....ossso....'
];
const jacket = [
  '..oossoo..',
  '.oafpptao.',
  'oacactccco',
  'occcctccco',
  '.occctccdo',
  '.odccccddo',
  '..odddddo.',
  '..ooooooo.'
];

function pixelPerson(ctx, x, y, person, step = 0, reading = false, left = false, browsing = false, back = false) {
  const ink = '#443637';
  const colors = {o:ink, h:person.hair, l:person.highlight || '#956f50', f:'#f4c79b', p:'#ffdfad',
    x:'#3c3438', s:'#d89b78', a:'#fff0cd', c:person.coat, d:'#665749', t:'#d5aa6d'};
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(left ? -1 : 1, 1);
  function rect(color, dx, dy, w, h) {
    ctx.fillStyle = color;
    ctx.fillRect(dx, dy, w, h);
  }
  rect('#a78259', -6, -1, 13, 2);
  rect(ink, -4, -4 - step, 4, 4);
  rect(ink, 2, -4 + step, 4, 4);
  rect('#bf9668', -4, -2 - step, 2, 1);
  rect('#bf9668', 3, -2 + step, 2, 1);
  ctx.translate(0, reading ? 2 : -step);
  stamp(ctx, -5, -12, jacket, colors);
  stamp(ctx, -6, -23, back ? backOfHead : head, colors);
  if (person.style === 'ribbon') {
    stamp(ctx, -9, -21, ['.rr.rr','rhhrrh','.rddr.', '...hh.', '..ohh.', '..oho.', '...o..'],
      {r:'#b4434f', h:person.hair, d:'#ffc2a2', o:ink});
  } else if (person.style === 'satchel') {
    stamp(ctx, -5, -12, ['tt......','.tt.....','..tt....','...tt...', '....tbbb','....bppb','....bbbb'],
      {t:'#9e633d', b:'#72503b', p:'#e7ae56'});
  } else if (person.style === 'bun') {
    stamp(ctx, -8, -26, ['.oooh.','ohhlho','ohhhho','.ohho.', '..tt..'], {o:ink,h:person.hair,l:colors.l,t:'#e7b866'});
  }
  if (person.cap) {
    stamp(ctx, -7, -24, ['...oooooo....','..obbbllbo...', '.obblbbbbbo..','obbbbbbbbbo..','.oddddddddooo','...ooooobbbbo'],
      {o:'#364452', b:'#587c95', l:'#95b6bc', d:'#344e67'});
  }
  if (person.glasses && !back) {
    stamp(ctx, -3, -17, ['oooodooo','oloooool','.oo...oo'], {o:'#655346', l:'#d3e8d6', d:'#d49d73'});
  }
  if (reading) {
    stamp(ctx, -2, -10, ['.ppp...ppp.', 'rppppdppppr','rplppdplppr','rrpppdppprr','fsrrrdrrrsf'],
      {r:'#975643', p:'#fff0bc', d:'#c8a574', l:'#d0b47e', f:colors.f, s:colors.s});
  } else if (browsing) {
    stamp(ctx, 2, -12, ['..rrrr.','..pprro','..rrrro','..rllro','ccfrrro','.fsrrro'],
      {o:ink, r:'#a65750', p:'#f7dfa0', l:'#dba366', c:person.coat, f:colors.f, s:colors.s});
  } else {
    rect(ink, -6, -11 + step, 3, 5);
    rect(person.coat, -6, -11 + step, 3, 3);
    rect(colors.f, -5, -8 + step, 2, 2);
  }
  ctx.restore();
}

export function paintPortrait(canvas, person) {
  pixelPerson(canvas.getContext('2d'), 9, 25, person);
}

export function paintRoom(canvas, shop) {
  return paintInterior(canvas, shop, seatPoint(shop), (ctx, x, y) =>
    pixelPerson(ctx, x, y, { hair: '#6a5040', coat: '#608675' }));
}

export function paintGuests(canvas, visitors, time, shop, still, street, selected, furniture = []) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const actors = [];
  for (const v of visitors) {
    const pose = guestPose(v, shop, time, still);
    if (!pose) continue;
    let [x, y] = project(...pose.xy);
    let left = false;
    if (street) {
      if (time < v.enters + 2) x = still ? 70 : Math.round(10 + 81 * (time - v.enters) / 2);
      else if (time >= v.paid) x = still ? 106 : Math.round(91 + 48 * (time - v.paid) / 2);
      else continue;
      y = 99;
    } else if (pose.walking) {
      const next = guestPose(v, shop, time + .12, false);
      left = next && project(...next.xy)[0] < x;
    }
    actors.push({ v, pose, x, y, left, depth: y + (pose.reading ? 1 : 0) });
  }
  const layers = [...furniture, ...actors].sort((a, b) => a.depth - b.depth);
  for (const item of layers) {
    if (item.layer) {
      ctx.drawImage(item.layer, 0, 0);
      continue;
    }
    const { v, pose, x, y, left } = item;
    pixelPerson(ctx, x, y, v.person, pose.walking ? Math.floor(time * 4 + v.i) % 2 : 0, pose.reading, left, pose.browsing, pose.browsing && v.reads);
  }
  if (street) return;
  for (const { v, pose, x, y } of actors) {
    if (pose.paying || (pose.reading && v.person.seat === shop.seat)) {
      ctx.fillStyle = '#785d4b';
      ctx.fillRect(x - 8, y - 35, 17, 10);
      ctx.fillStyle = '#fff3cd';
      ctx.fillRect(x - 7, y - 34, 15, 8);
      ctx.fillRect(x, y - 26, 2, 3);
      if (pose.paying) {
        const digits = String(v.coins);
        // Use native-grid glyphs so the sale stays legible on a narrow phone.
        stamp(ctx, x - 6, y - 33, ['.gg.', 'gllg', 'glgg', '.gg.'], {g:'#a66c30', l:'#f2c953'});
        for (const [i, digit] of [...digits].entries()) {
          stamp(ctx, x + 1 + i * 4, y - 33, PRICE_DIGITS[digit], {x:'#67452e'});
        }
      } else {
        ctx.fillStyle = '#bd6262';
        ctx.fillRect(x - 3, y - 32, 2, 2);
        ctx.fillRect(x + 1, y - 32, 2, 2);
        ctx.fillRect(x - 2, y - 30, 5, 1);
        ctx.fillRect(x - 1, y - 29, 3, 1);
        ctx.fillRect(x, y - 28, 1, 1);
      }
    } else if (v.person.name === selected) {
      ctx.fillStyle = '#6e553e';
      ctx.fillRect(x - 3, y - 29, 7, 3);
      ctx.fillStyle = '#ffdf89';
      ctx.fillRect(x - 2, y - 29, 5, 2);
      ctx.fillRect(x - 1, y - 27, 3, 2);
    }
  }
  return layers.filter(item => item.v).reverse();
}

const PRICE_DIGITS = [
  ['xxx','x.x','x.x','x.x','xxx'], ['.x.','xx.','.x.','.x.','xxx'],
  ['xxx','..x','xxx','x..','xxx'], ['xxx','..x','xxx','..x','xxx'],
  ['x.x','x.x','xxx','..x','..x'], ['xxx','x..','xxx','..x','xxx'],
  ['xxx','x..','xxx','x.x','xxx'], ['xxx','..x','..x','.x.','.x.'],
  ['xxx','x.x','xxx','x.x','xxx'], ['xxx','x.x','xxx','..x','xxx']
];
