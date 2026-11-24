const WOOD = ['#c88a4d', '#694328', '#945c36'];
const TRIM = ['#edbc78', '#93633b', '#c18b4e'];
const BOOKS = ['#bd4d48', '#427785', '#dc9e37', '#776287', '#4e8463', '#db8554'];
// One bottom-center-aligned cell per furnishing in the optional local PNG.
const FURNISHINGS = ['seat', 'table', 'plant', 'cabinet', 'counter'];
const CELL_WIDTH = 48;
const CELL_HEIGHT = 40;

export async function loadFurnishingSheet() {
  try {
    const directory = await chrome.runtime.getPackageDirectoryEntry();
    const entry = await new Promise((resolve, reject) =>
      directory.getFile('local-art/furnishings.png', {}, resolve, reject));
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    const sheet = await createImageBitmap(file);
    if (sheet.width === CELL_WIDTH * FURNISHINGS.length && sheet.height === CELL_HEIGHT) return sheet;
    sheet.close();
  } catch {
    // A stock installation has no local artwork.
  }
  return null;
}

// Small, hand-drawn shop signs and foliage use the same pixel grid as the cast.
export function stamp(ctx, x, y, rows, palette) {
  rows.forEach((row, dy) => {
    [...row].forEach((key, dx) => {
      if (key === '.') return;
      ctx.fillStyle = palette[key];
      ctx.fillRect(x + dx, y + dy, 1, 1);
    });
  });
}

const leaves = ['....ddgg...', '..dgghggh..', '.dgghhhggd.', 'dghhggdghgd',
  '.ggggghhggd', 'dgghhggdgdd', '.dggdgggdd.', '..dddtddd..', '.....t.....'];
const greens = { d: '#365e43', g: '#638843', h: '#9eb84d', t: '#6c5334' };

export function project(x, y, z = 0) {
  return [Math.round(90 + x * .82 - (y - 34) * .86), Math.round(32 + x * .32 + (y - 34) * .58 - z)];
}

// Furniture and paths share floor coordinates. Height only affects the drawing.
function joinery(ctx) {
  function face(color, ...corners) {
    ctx.fillStyle = color;
    ctx.beginPath();
    corners.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.closePath();
    ctx.fill();
  }
  function tile(x, y, w, d, z, color) {
    face(color, project(x, y, z), project(x + w, y, z), project(x + w, y + d, z), project(x, y + d, z));
  }
  function box(x, y, w, d, base, h, [top, right, front]) {
    const end = project(x + w, y + d, base), high = project(x + w, y + d, base + h);
    face(right, project(x + w, y, base), end, high, project(x + w, y, base + h));
    face(front, project(x, y + d, base), end, high, project(x, y + d, base + h));
    tile(x, y, w, d, base + h, top);
  }
  return { tile, box };
}

function shelf({ box }, brush, x, n) {
  box(x, 35, 22, 8, 0, 28, WOOD);
  for (const base of [3, 12, 21]) {
    box(x + 1, 42, 20, 1, base, 7, ['#694836', '#694836', '#624535']);
    box(x, 35, 22, 9, base - 2, 2, TRIM);
  }
  box(x - 1, 34, 24, 10, 27, 2, TRIM);
  // Paint the spines last: at display scale the top planes of the ledges
  // otherwise obscure the thin books along the front of the shelf.
  for (const base of [3, 12, 21]) {
    for (let i = 0; i < 6; i++) {
      const [px, py] = project(x + 2 + i * 3.2, 44, base);
      const h = 4 + (i * 2 + n) % 4;
      brush.fillStyle = '#624636';
      brush.fillRect(px, py - h, 3, h);
      brush.fillStyle = BOOKS[(i + base + n) % BOOKS.length];
      brush.fillRect(px, py - h, 2, h - 1);
      brush.fillStyle = '#f2d7a1';
      brush.fillRect(px, py - h + 1, 1, 1);
    }
  }
}

function chair({ box }, x, y) {
  for (const dx of [-7, 5]) box(x + dx, y - 4, 3, 8, 0, 5, WOOD);
  box(x - 8, y - 8, 16, 3, 4, 10, WOOD);
  box(x - 7, y - 6, 14, 2, 8, 5, ['#e69c6d', '#883e37', '#bd6650']);
  box(x - 8, y - 6, 16, 12, 4, 3, ['#d78460', '#813f37', '#a85041']);
}

function planter(ctx, art, x, y) {
  art.box(x - 4, y - 4, 8, 8, 0, 6, ['#b87953', '#965b46', '#b97754']);
  art.box(x - 5, y - 5, 10, 10, 5, 2, ['#795c46', '#b37655', '#cf9465']);
  const [px, py] = project(x, y, 6);
  stamp(ctx, px - 5, py - 16, leaves, greens);
  stamp(ctx, px - 8, py - 11, leaves, greens);
  stamp(ctx, px - 1, py - 9, leaves, greens);
}

export function paintInterior(canvas, shop, seat, drawClerk, sheet) {
  const ctx = canvas.getContext('2d');
  const { tile, box } = joinery(ctx);
  ctx.fillStyle = '#9eb681';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let row = 0; row < 16; row++) {
    for (let col = 0; col < 22; col++) {
      const x = col * 13 + (row * 17 % 11), y = row * 11 + (col * 7 % 8);
      ctx.fillStyle = (col + row) % 3 ? '#9bb58d' : '#c6ce9c';
      ctx.fillRect(x, y, 3, 1);
      ctx.fillRect(x + 2, y - 1, 1, 1);
    }
  }
  // A garden hedge behind the high walls gives the cutaway a setting in the alley.
  for (let x = -10; x < canvas.width; x += 9) {
    const y = Math.abs(x - 90) * .42 - 3;
    if (y < -8) continue;
    stamp(ctx, x, Math.round(y), leaves, greens);
    stamp(ctx, x + 3, Math.round(y) - 5, leaves, greens);
  }
  // The brick lane and doorstep continue the route through the open storefront.
  tile(-14, 121, 235, 17, -4, '#a48c77');
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 15; i++) {
      tile(-14 + 16 * i + row % 2 * 7, 121 + row * 6, 15, 5, -4,
        ['#d3b99c', '#c5a992', '#cfb098'][(i + row) % 3]);
    }
  }
  box(82, 120, 25, 7, -4, 2, TRIM);
  box(-2, 32, 196, 89, -4, 4, ['#bd9267', '#826b55', '#977961']);
  for (let row = 0; row < 11; row++) {
    const y = 34 + row * 8;
    for (let x = row % 2 ? -16 : 0; x < 192; x += 32) {
      const start = Math.max(x, 0), end = Math.min(x + 32, 192);
      const w = end - start, d = Math.min(8, 120 - y);
      tile(start, y, w, d, 0, '#a4754c');
      tile(start + .5, y + .5, w - 1, d - .5, 0,
        ['#deab71', '#d49f67', '#e6b87c'][(row + Math.ceil((x + 16) / 32)) % 3]);
      tile(start + w * .17, y + 3, w * .42, .8, 0, '#c49160');
    }
  }
  // Two cutaway walls, a bank of windows and a painted baseboard.
  box(-2, 32, 3, 88, 0, 25, ['#e7c394', '#efe2bb', '#ad906d']);
  box(0, 32, 192, 3, 0, 25, ['#f2d6a6', '#ac895f', '#ad7853']);
  for (let row = 0; row < 5; row++) {
    for (let x = row % 2 ? -5 : 0; x < 192; x += 11) {
      const start = Math.max(0, x);
      const color = ['#c89365', '#cc996f', '#c08b62'][(Math.ceil((x + 5) / 11) + row) % 3];
      box(start, 34, Math.min(192, x + 10) - start, 1, 4 + row * 4, 3, [color, color, color]);
    }
  }
  box(0, 32, 192, 4, 23, 3, ['#825737', '#4d392d', '#634230']);
  for (let y = 43; y < 112; y += 18) {
    box(1, y, 1, 16, 8, 13, ['#9d805c', '#836e54', '#a7855d']);
    box(2, y + 1, 1, 14, 9, 10, ['#cce4cf', '#a9cfca', '#bcd4b7']);
    box(3, y + 7, 1, 1, 9, 10, TRIM);
    box(3, y, 2, 16, 7, 2, TRIM);
    for (let stripe = 0; stripe < 4; stripe++) {
      const shade = stripe % 2 ? ['#ffe3a9', '#dabc8e', '#bba584'] : ['#bb6e56', '#a45842', '#8c4f42'];
      box(-3, y + stripe * 4, 7, 4, 20, 3, shade);
    }
  }
  box(1, 35, 2, 84, 0, 4, WOOD);
  box(2, 34, 190, 2, 0, 4, WOOD);
  for (let x = 12; x < 192; x += 32) box(x, 34, 2, 2, 0, 24, TRIM);
  // An open-book sign marks the shop even when visitors cover the shelves.
  box(119, 35, 30, 2, 8, 14, WOOD);
  box(120, 37, 28, 1, 9, 12, ['#829985', '#557361', '#557361']);
  box(126, 38, 8, 1, 12, 6, ['#f9e6ac', '#d6bf8e', '#fff0c2']);
  box(135, 38, 8, 1, 13, 6, ['#f9e6ac', '#d6bf8e', '#e8cf97']);
  const [clockX, clockY] = project(164, 37, 21);
  stamp(ctx, clockX - 4, clockY, ['..oooo..','.obbbbo.','obppppbo','obppxpbo','obppxxbo','obppppbo','.obbbbo.','..oooo..'],
    {o:'#593e30', b:'#c39453', p:'#ffe6ad', x:'#5d5144'});
  tile(46, 60, 84, 27, 0, '#697a63');
  tile(48, 62, 80, 23, 0, '#e3cf9a');
  tile(50, 64, 76, 19, 0, '#8da684');
  for (let x = 51; x < 125; x += 8) tile(x, 71, 3, 3, 0, '#b5ba8b');
  for (let x = 47; x < 129; x += 4) {
    tile(x, 59, 2, 2, 0, '#e9d7a3');
    tile(x, 86, 2, 2, 0, '#e9d7a3');
  }
  tile(83, 111, 22, 9, 0, '#ab8261');
  for (let y = 112; y < 120; y += 3) tile(84, y, 20, 1, 0, '#d7b17a');

  // Cache each furnishing so moving customers can pass both behind and in front of it.
  const pieces = [];
  function furnish(x, y, paint, sprite) {
    const layer = document.createElement('canvas');
    layer.width = canvas.width;
    layer.height = canvas.height;
    const brush = layer.getContext('2d');
    const [px, py] = project(x, y);
    if (sheet && sprite) {
      const column = FURNISHINGS.indexOf(sprite);
      brush.drawImage(sheet, column * CELL_WIDTH, 0, CELL_WIDTH, CELL_HEIGHT,
        px - CELL_WIDTH / 2, py - CELL_HEIGHT + 4, CELL_WIDTH, CELL_HEIGHT);
    } else {
      paint(joinery(brush), brush);
    }
    pieces.push({ depth: py, layer });
  }
  for (let n = 0; n <= shop.level; n++) furnish(47 + 22 * n, 42, (art, brush) => shelf(art, brush, 36 + 22 * n, n));
  // A tall periodical rack fills the rear corner without obstructing an aisle.
  furnish(14, 66, ({ box }) => {
    box(8, 57, 10, 8, 0, 21, WOOD);
    for (const base of [3, 11]) {
      for (let i = 0; i < 2; i++) {
        const cover = BOOKS[i + (base === 3 ? 1 : 3)];
        box(8 + i * 5, 65, 5, 1, base, 7, ['#f6e6b6', cover, cover]);
        box(9 + i * 5, 66, 3, 1, base + 4, 1, TRIM);
      }
      box(7, 62, 12, 6, base, 2, TRIM);
    }
  });
  furnish(114, 71, ({ box }, brush) => {
    // The rolling book cart sits off the walking route along the central rug.
    for (const x of [106, 121]) box(x, 70, 3, 3, 0, 3, ['#77604c', '#493d36', '#554632']);
    box(104, 62, 20, 11, 3, 3, WOOD);
    box(104, 62, 2, 10, 4, 9, TRIM);
    box(121, 62, 2, 10, 4, 9, TRIM);
    box(104, 62, 20, 11, 9, 2, ['#dbb67e', '#825637', '#a66d42']);
    const [x,y] = project(111, 68, 11);
    stamp(brush, x - 4, y - 7, ['....gg...', '.p.ggh.pg','ppp.g.ppp','.pgggg.p.', '...ggg...', '...avv...', '...vva...'],
      {p:'#d8766c', g:'#49734b', h:'#a4b759', a:'#e9c185', v:'#668e92'});
    box(117, 64, 5, 6, 11, 2, ['#a54b46', '#6c453a', '#f1dba7']);
  });
  furnish(42, 103, ({ box }, brush) => {
    box(24, 95, 37, 12, 1, 6, WOOD);
    box(23, 94, 39, 14, 7, 2, TRIM);
    for (const [i, color] of BOOKS.slice(0, 3).entries()) {
      const x = 26 + i * 11;
      box(x, 96, 8, 8, 9, 2, ['#f4e3b2', '#ad8f6b', '#f4e3b2']);
      box(x, 96, 8, 8, 11, 1, [color, color, color]);
      box(x + 2, 98, 4, 2, 12, 0, ['#f9dfa4', color, color]);
    }
    box(49, 94, 10, 2, 9, 8, ['#ffe7a6', '#aa7941', '#cb874a']);
    const [px, py] = project(53, 97, 16);
    stamp(brush, px - 2, py, ['x.x.x', 'xxxxx', '.xxx.', '.ggg.'], {x:'#fff0ae', g:'#774c30'});
  });
  furnish(...seat, art => chair(art, ...seat), 'seat');
  furnish(seat[0] - 13, seat[1] + 5, ({ box, tile }) => {
    const x = seat[0] - 23, y = seat[1] + 1;
    box(x + 6, y + 4, 6, 4, 0, 8, WOOD);
    box(x, y, 19, 13, 7, 2, ['#e9c59a', '#995f39', '#b57d4c']);
    tile(x + 2, y, 6, 13, 9, '#598a80');
    box(x + 9, y + 3, 3, 3, 9, 3, ['#875b40', '#e3cba0', '#fff2c8']);
    box(x + 4, y + 3, 3, 3, 9, 4, ['#ffd280', '#b86445', '#cc7951']);
  }, 'table');
  furnish(seat[0] - 10, seat[1] - 5, ({ box }) => {
    const x = seat[0] - 13, y = seat[1] - 5;
    box(x, y, 3, 3, 0, 14, WOOD);
    box(x - 3, y - 3, 9, 9, 12, 4, ['#f9e7a1', '#ca9155', '#eabf71']);
    box(x - 1, y - 1, 5, 5, 16, 2, ['#ffedb3', '#c49c69', '#e5c37d']);
  });
  for (const [x, y] of [[15, 49], [171, 48], [184, 62]]) {
    furnish(x, y, (art, brush) => planter(brush, art, x, y), 'plant');
  }
  // A glass-front case holds the collector's clothbound editions.
  furnish(151, 47, ({ box }) => {
    box(140, 36, 21, 10, 0, 14, WOOD);
    box(141, 45, 19, 2, 4, 8, ['#a7cdc0', '#58837c', '#628c81']);
    for (let i = 0; i < 4; i++) {
      const color = BOOKS[(i + 1) % BOOKS.length];
      box(142 + i * 4, 46, 3, 1, 5, 5 + i % 2, ['#f4d99a', color, color]);
    }
    box(149, 46, 1, 1, 4, 9, TRIM);
    box(139, 35, 23, 13, 13, 2, TRIM);
  }, 'cabinet');
  furnish(144, 76, (art, brush) => drawClerk(brush, ...project(144, 76)));
  furnish(143, 89, ({ box }) => {
    box(124, 80, 39, 12, 0, 9, WOOD);
    box(123, 79, 41, 14, 9, 2, TRIM);
    box(128, 82, 10, 7, 11, 3, ['#839f95', '#474d47', '#5e6b61']);
    box(129, 82, 8, 2, 14, 4, ['#668581', '#515f54', '#aac7b2']);
    box(148, 81, 9, 6, 11, 2, ['#fff1cf', '#ba956c', '#bb7258']);
    for (let x = 126; x < 161; x += 9) {
      box(x, 92, 7, 1, 2, 5, ['#bb8c59', '#875532', '#a76c43']);
    }
  }, 'counter');
  furnish(72, 122, ({ box }, brush) => {
    box(66, 119, 10, 4, -3, 15, WOOD);
    box(67, 122, 8, 1, 0, 10, ['#efd298', '#6f573d', '#385849']);
    const [x,y] = project(67, 125, 8);
    stamp(brush, x, y, ['.p.p.', 'ppppp', 'ppgpp', '.ggg.', '..g..'], {p:'#ffe7ac', g:'#9fb581'});
  });
  // Low street-facing walls frame the open door while keeping the room visible.
  for (const [start, end] of [[0, 78], [110, 192]]) {
    furnish(end, 121, ({ box }) => {
      box(start, 119, end - start, 3, -4, 7, ['#ae815a', '#956a4f', '#e5cc9e']);
      for (let x = start + 7; x < end - 8; x += 19) {
        box(x, 122, 9, 1, -2, 4, ['#754f38', '#654d3c', '#705643']);
        box(x + 1, 123, 3, 1, -1, 2, ['#b0d1c5', '#699189', '#91b5a5']);
        box(x + 5, 123, 3, 1, -1, 2, ['#c3d9c7', '#699189', '#91b5a5']);
      }
      box(start, 119, end - start, 4, 3, 2, ['#64816c', '#384e49', '#486a58']);
      box(start, 119, end - start, 4, 5, 1, ['#76583c', '#51392c', '#51392c']);
    });
  }
  furnish(192, 120, ({ box }) => {
    box(190, 34, 3, 86, -4, 7, ['#a88464', '#cfb991', '#cfb991']);
    for (let y = 40; y < 110; y += 18) box(193, y, 1, 9, -2, 4, ['#82634e', '#718d80', '#536f61']);
    box(190, 34, 4, 86, 3, 2, ['#6b8a71', '#405c4e', '#405c4e']);
    box(190, 34, 4, 86, 5, 1, ['#775b41', '#574132', '#574132']);
  });
  return pieces;
}
