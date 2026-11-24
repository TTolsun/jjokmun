import { paintInterior, project, stamp } from './shop-interior.js';
import { VISIT_MS } from '../shop.js';

const seatPoint = shop => shop.seat === 'window' ? [29, 78] : [173, 78];
const entrance = [94, 119];

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

const front = [
  '.....oooooo....', '...ohhhllhho...', '..ohllllhhhho..', '.ohlllhhhhhhho.',
  '.ohhhhhhllhhho.', 'ohhhhhlhhfpffo.', 'ohhhlhffpppppo.', '.ohhffpxfppxfo.',
  '.ohsfppxfppxfo.', '..ohspppppppso.', '...ohsfppfsso..', '....osffffso...', '.....oooooo....'
];
const away = [
  '.....oooooo....', '...ohhlllhho...', '..ohllllhhhho..', '.ohlllhhhhhhoo.',
  '.ohhhlhhllhhho.', 'ohhhhhhhllhhho.', 'ohhhhlhhhhhhho.', '.ohhlhhhhhhhoo.',
  '.ohhhhhhhhhsfo.', '..ohhhhlhhhfso.', '...ohhhhhhhoo..', '....ohhhhsoo...', '.....oooooo....'
];
const coat = [
  '..ooossooo..', '.oacappacco.', 'oclcaaatccco', 'oclcctcccdco',
  '.oclcacctdo.', '.odcctccddo.', '.odccccdddo.', '..oddddddo..', '..oooooooo..'
];
const backCoat = [
  '..oooosooo..', '.occcaaadco.', 'oclllcccccdo', 'ocllccccccdo',
  '.occcccccdo.', '.odccccccdo.', '.odccccdddo.', '..oddddddo..', '..oooooooo..'
];
const book = ['.ppp...ppp.', 'rppppdppppr', 'rplppdplppr', 'rrpppdppprr', 'fsrrrdrrrsf'];
const cover = { r:'#a14045', p:'#fff1bb', d:'#bf965e', l:'#dfc588', f:'#f4bb87', s:'#c78059' };
const clerk = { sprite: 1, hair: '#5c4039', highlight: '#976c49', coat: '#57856a', shade: '#365b49', style: 'apron' };

function pixelPerson(ctx, x, y, person, { step = 0, left = false, back = false, reading = false } = {}, sheet) {
  const colors = { o:'#483338', h:person.hair, l:person.highlight, f:'#f1b786', p:'#ffe0aa',
    x:'#382a35', s:'#c67c5b', a:'#ffedc2', c:person.coat, d:person.shade, t:'#e6b75c' };
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(left ? -1 : 1, 1);
  stamp(ctx, -7, -2, ['..ssssssssss..','ssssssssssssss','.sssssssssss..'], {s:'rgba(77,51,37,.30)'});
  // Plant one foot and swing the other. The head moves one pixel with the stride.
  const shoe = ['.ooo.', '.dldo', 'odddo', 'oaaao', '.oooo'];
  const leather = { o:colors.o, d:'#6f5250', l:'#8c6860', a:'#c5956b' };
  stamp(ctx, -4 - step, -5 - Math.max(0, step), shoe, leather);
  stamp(ctx, 1 + step, -5 - Math.max(0, -step), shoe, leather);
  ctx.translate(0, -Math.abs(step));
  stamp(ctx, -6, -13, back ? backCoat : coat, colors);
  if (person.style === 'apron' && !back) {
    stamp(ctx, -4, -12, ['a....a', '.aaaa.', '.appaa', 'aappaa', 'aaaaaa', 'adddda'], {a:'#e9cf91',p:'#bc9969',d:'#a68158'});
  }
  if (person.style === 'satchel') {
    stamp(ctx, -5, -13, ['t......','.t.....','..t....','...t...', '...obb.', '...btbo', '...oooo'],
      {t:'#dda467', b:'#9c673c', o:'#664432'});
  }
  if (sheet) {
    ctx.drawImage(sheet, person.sprite * 16, back ? 16 : 0, 16, 16, -8, -27, 16, 16);
  } else {
    stamp(ctx, -7, -24, back ? away : front, colors);
    if (person.style === 'ribbon') stamp(ctx, -8, -22, ['rr.rr','rdrrr','.rdr.','..rr.','..hho','..oho','...o.'],
      {r:'#ae3c46',d:'#ffae86',h:colors.h,o:colors.o});
    if (person.style === 'bun') stamp(ctx, -8, -26, ['..ooo.', '.ohhho','ohllho','.ohhoo','..aat.'], colors);
    if (person.style === 'cap') stamp(ctx, -7, -25, ['...oooooo....','..occlllco...','.occlccccco..','occcccccccco.','.oddddddddooo','...ooooobbbbo'],
      {o:'#374154',c:'#557c99',l:'#90b5c3',d:'#354e6c',b:'#a7a8a0'});
    if (person.style === 'glasses' && !back) stamp(ctx, -1, -17, ['oooodooo','oloooool','.oo...oo'], {o:'#64504a',l:'#e2dec4',d:'#a9886e'});
  }
  if (reading) stamp(ctx, -3, -11, book, cover);
  else stamp(ctx, -6, -11 - step, ['.oo.', 'occo','ocdo','.ffo','.sso'], colors);
  ctx.restore();
}

export function paintRoom(canvas, shop, furnishings, characters) {
  return paintInterior(canvas, shop, seatPoint(shop), (ctx, x, y) =>
    pixelPerson(ctx, x, y, clerk, { left: true }, characters), furnishings);
}

const displaySpots = [[44, 112], [65, 102], [43, 88], [28, 112], [62, 88], [61, 114], [25, 88], [76, 103], [76, 115]];

export function paintGuests(canvas, arrivals, now, still, furniture, characters) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const guests = arrivals.map(({ at, seed, person, bestseller }, i) => {
    const age = now - at;
    const spot = bestseller ? displaySpots[i % displaySpots.length] : [42 + seed % 4 * 24, 56 + seed % 2 * 10];
    const route = [entrance, [80, 117], [80, spot[1]], spot];
    const progress = Math.min(1, age / 3200, (VISIT_MS - age) / 3200);
    const [x, y] = project(...along(route, still ? 1 : progress));
    const leaving = age > VISIT_MS / 2;
    const other = project(...along(route, Math.max(0, progress - .04)));
    const dx = (x - other[0]) * (leaving ? -1 : 1);
    const dy = (y - other[1]) * (leaving ? -1 : 1);
    const browsing = still || progress === 1;
    const step = browsing ? 0 : [0, 1, 0, -1][Math.floor(age / 135) % 4];
    return { x, y, depth: y, person, step, left: browsing ? seed % 2 === 0 : dx < 0,
      back: !browsing && dy < 0, reading: browsing };
  });
  for (const item of [...furniture, ...guests].sort((a, b) => a.depth - b.depth)) {
    if (item.layer) ctx.drawImage(item.layer, 0, 0);
    else pixelPerson(ctx, item.x, item.y, item.person, item, characters);
  }
}
