import { paintInterior, project, stamp, WALK_WIDTH, WALK_HEIGHT } from './shop-interior.js';
import { REGULARS, REGULAR_TIER, VISIT_MS } from '../shop.js';

const seatPoint = shop => shop.seat === 'window' ? [29, 78] : [173, 78];
const entrance = [94, 119];

function walkRoute(points, progress) {
  const path = points.map(point => project(...point));
  const lengths = path.slice(1).map(([x, y], i) => Math.hypot(x - path[i][0], y - path[i][1]));
  const distance = Math.max(0, Math.min(1, progress)) * lengths.reduce((a, b) => a + b, 0);
  let remaining = distance;
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i] || i === lengths.length - 1) {
      const [x, y] = path[i];
      const dx = path[i + 1][0] - x, dy = path[i + 1][1] - y;
      const t = lengths[i] ? remaining / lengths[i] : 0;
      return {x:Math.round(x + t * dx), y:Math.round(y + t * dy), dx, dy, distance};
    }
    remaining -= lengths[i];
  }
}

// All poses share the sole at (0, 0) and a neck joint at (0, -12).
// The far eye sits one pixel higher on the turned face.
const face = [
  '....ooooo....', '..oohhhhhoo..', '.ohhllhhhhoo.', '.ohllllhhhhh.',
  'ohhlhhhhhffho', 'ohhhhhfffpppo', '.ohhhsppppxpo', '.ohfspxpppxpo',
  '..offpxppppso', '...ospppppso.', '....ossppso..', '......oooo...'
];
const nape = [
  '....ooooo....', '..oohhhhhoo..', '.ohhllhhhhoo.', '.ohllllhhhhh.',
  'ohhlhhhlhhhho', 'ohhhhhllhhhho', '.ohhhhhhhhhho', '.ohhlhhhhhhso',
  '..ohhhhlhhso.', '...ohhhhhso..', '....oohhso...', '......ooo....'
];
const garments = {
  vest: ['..ottto..','.octatdo.','otccatddo','odcctcddo','.dcctcdd.','.occcddo.','..ooooo..'],
  cardigan: ['..ottto..','.octatdo.','otcaaacdo','occtatcdo','.cctatdd.','.occtddo.','..ooooo..'],
  apron: ['..ottto..','.oactcao.','otattatdo','ocattatdo','.dattatd.','.ottttto.','..ooooo..'],
  jacket: ['..ottto..','.ocactdo.','otccatcdo','occcacddo','.dccacdd.','.occcddo.','..ooooo..']
};
const backCoat = ['..occdo..','.otttcdo.','otccccddo','occcccddo','.dcccccdo','.occdddo.','..ooooo..'];
const book = ['.ppp...ppp.', 'rppppdppppr', 'rplppdplppr', 'rrpppdppprr', 'fsrrrdrrrsf'];
const cover = {r:'#99454b', p:'#fff1bb', d:'#bf965e', l:'#dfc588', f:'#f4bb87', s:'#c78059'};
const clerk = {sprite:1, haircut:'sidepart', style:'glasses', garment:'apron', hair:'#51413d',
  highlight:'#926d51', skin:'#edbd90', cheek:'#bf8766', coat:'#508578', shade:'#345b53', trim:'#e2c394'};

function hair(ctx, cut, colors) {
  if (cut === 'bun') stamp(ctx, -8, -26, ['..ooo.', '.ohllo','ohllho','.ohhho','..oto.'], colors);
  if (cut === 'bob') stamp(ctx, -7, -22, ['.ohh.', 'ohhho','ohhho','ohhho','.ohho','.ohho','..oo.'], colors);
  if (cut === 'waves') stamp(ctx, -7, -24, ['..ohhl..', '.ohllhho','ohhho.oh','ohhho...','.ohhho..','..ohho..','..oho...'], colors);
  if (cut === 'sidepart') stamp(ctx, -3, -23, ['..llllh.', '.lllhhho','llhhho..','hhho....'], colors);
}

export function pixelPerson(ctx, x, y, person, {step = 0, left = false, back = false, reading = false} = {}, sheet) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(left ? -1 : 1, 1);
  stamp(ctx, -6, -1, ['..ssssssss..','ssssssssssss','.ssssssssss.'], {s:'rgba(73,49,38,.28)'});
  if (sheet?.height === 2 * WALK_HEIGHT) {
    const pose = step === 0 ? 0 : step > 0 ? 1 : 2;
    ctx.drawImage(sheet, (person.sprite * 3 + pose) * WALK_WIDTH, back ? WALK_HEIGHT : 0,
      WALK_WIDTH, WALK_HEIGHT, -WALK_WIDTH / 2, -WALK_HEIGHT, WALK_WIDTH, WALK_HEIGHT);
  } else {
    const colors = {o:'#43343a', h:person.hair, l:person.highlight, p:person.skin, f:person.skin,
      s:person.cheek, x:'#49333a', a:'#ffebc4', c:person.coat, d:person.shade, t:person.trim};
    const shoe = ['.ooo.', '.dddo', '.dtdo', 'ollto', 'ooooo'];
    const leather = {o:'#423435', d:'#5e575a', t:'#8c7870', l:'#bfa181'};
    stamp(ctx, 1 - step * 2, -5 - Number(step > 0), shoe, leather);
    stamp(ctx, -4 + step * 2, -5 - Number(step < 0), shoe, leather);
    ctx.translate(0, -Math.abs(step));
    stamp(ctx, -4, -12, back ? backCoat : garments[person.garment] || garments.jacket, colors);
    stamp(ctx, -2, -14, ['.sso', '.fpo', '..so'], colors);
    if (sheet) ctx.drawImage(sheet, person.sprite * 16, back ? 16 : 0, 16, 16, -8, -27, 16, 16);
    else {
      stamp(ctx, -6, -24, back ? nape : face, colors);
      hair(ctx, person.haircut, colors);
    }
    if (person.style === 'ribbon') stamp(ctx, -7, -22, ['rr.rr','.rtr.','.r.r.'], {r:'#a43d50',t:'#f0b481'});
    if (person.style === 'cap') stamp(ctx, -6, -25, ['...oooooo....','..otttccco...','.otccccccco..','odddddddddooo','.ooooooootto.'], colors);
    if (person.style === 'glasses' && !back) stamp(ctx, 0, -18, ['oootooo','olotolo','.o...o.'], {o:'#665659',l:'#d3c9a9',t:'#ad9072'});
    if (person.style === 'satchel') stamp(ctx, -4, -12, ['t.......','.t......','..t.....','...t....','....obbo','....bttb','....oooo'],
      {t:'#cea268',b:'#93603d',o:'#604636'});
    if (person.style === 'scarf') stamp(ctx, -3, -13, ['.ttttt.','..ccctt','.....tc','.....ct'], colors);
    if (!reading) stamp(ctx, -5 - step, -11 + step, ['.oo.', 'occo','ocdo','.fpo','.sso'], colors);
  }
  if (reading) stamp(ctx, -2, -11, book, cover);
  ctx.restore();
}

const heart = ['.o.o.', 'ohoho', 'ohhho', '.oho.', '..o..'];
const heartColors = {o:'#7b2f3b', h:'#e36d7e'};

export function paintPortrait(canvas, person, characters) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  pixelPerson(ctx, canvas.width / 2, canvas.height - 2, person, {}, characters);
}

export function paintRoom(canvas, shop, furnishings, characters) {
  return paintInterior(canvas, shop, seatPoint(shop), (ctx, x, y) =>
    pixelPerson(ctx, x, y, clerk, { left: true }, characters), furnishings);
}

const regularRoutes = [
  [[28, 67], [18, 84], [18, 112], [38, 112]],
  [[102, 114], [78, 111], [66, 103]]
];

export function regularProgress(visit, now) {
  const distance = Math.max(0, (now - visit.changedAt) / 1400);
  return visit.interested ? Math.min(1, visit.from + distance) : Math.max(0, visit.from - distance);
}

export function paintGuests(canvas, arrivals, now, still, furniture, characters, regulars = []) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const guests = arrivals.map(({ at, seed, person, tier = 0 }) => {
    const age = now - at;
    const spot = [42 + seed % 4 * 24, 56 + seed % 2 * 10];
    const route = [entrance, [80, 117], [80, spot[1]], spot];
    const progress = Math.min(1, age / 3200, (VISIT_MS - age) / 3200);
    const {x, y, dx, dy, distance} = walkRoute(route, still ? 1 : progress);
    const facing = age > VISIT_MS / 2 ? -1 : 1;
    const browsing = still || progress === 1;
    const step = browsing ? 0 : [0, 1, 0, -1][Math.floor(distance / 4) % 4];
    return { x, y, depth: y, person, step, left: browsing ? seed % 2 === 0 : dx * facing < 0,
      back: !browsing && dy * facing < 0, reading: browsing, fond: browsing && tier >= REGULAR_TIER };
  });
  regulars.forEach((visit, index) => {
    const progress = still ? Number(visit.interested) : regularProgress(visit, now);
    const { x, y, dx, dy, distance } = walkRoute(regularRoutes[index], progress);
    const moving = progress > 0 && progress < 1;
    const direction = visit.interested ? 1 : -1;
    guests.push({ x, y, depth: y, person: REGULARS[index].person,
      step: moving ? [0, 1, 0, -1][Math.floor(distance / 4) % 4] : 0,
      left: moving ? dx * direction < 0 : index === 1, back: moving && dy * direction < 0,
      reading: progress === 1 });
  });
  for (const item of [...furniture, ...guests].sort((a, b) => a.depth - b.depth)) {
    if (item.layer) ctx.drawImage(item.layer, 0, 0);
    else pixelPerson(ctx, item.x, item.y, item.person, item, characters);
  }
  // Close regulars show a small heart while they browse, drawn above furniture.
  for (const guest of guests) if (guest.fond) stamp(ctx, guest.x - 2, guest.y - 35, heart, heartColors);
}
