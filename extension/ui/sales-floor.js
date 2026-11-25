import { advanceBusiness, currentLayout, currentShift, defaultLayout, firstBusiness, floorPoint,
  FURNITURE, moveFurniture, placementError } from '../business.js';
import { DEFAULT_NAME, newShop, regularOf } from '../shop.js';
import { element } from './dom.js';
import { project } from './shop-interior.js';
import { paintRoom, pixelPerson } from './shop-scene.js';

const people = Array.from({ length: 10 }, (_, i) => regularOf('shopper-' + i).person);
function text(id, value) {
  if (element(id).textContent !== value) element(id).textContent = value;
}
function floorDelta(dx, dy) {
  const det = .82 * .58 + .86 * .32;
  return [(.58 * dx + .86 * dy) / det, (.82 * dy - .32 * dx) / det];
}

export function bindSalesFloor(change) {
  const stage = element('sales-floor');
  const floor = element('business-room');
  const actors = element('business-people');
  const ctx = actors.getContext('2d');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const handles = {};
  let state, layout, pieces = [], artKey, drag, timer, pending, retry, busy = false, failed = false, generation = 0;

  function reset() {
    clearInterval(timer);
    generation++;
    state = layout = artKey = drag = undefined;
    pending = retry = undefined;
    stage.classList.remove('dragging');
    pieces = [];
    busy = failed = false;
    element('retry-floor').hidden = true;
    floor.getContext('2d').clearRect(0, 0, floor.width, floor.height);
    ctx.clearRect(0, 0, actors.width, actors.height);
    for (const id of ['floor-title','business-pick','business-status','floor-event','business-day',
      'business-phase','floor-guests','floor-regulars']) text(id, '');
  }

  async function save(mutate) {
    if (!state || busy) return;
    const owner = generation;
    busy = true;
    failed = false;
    element('retry-floor').hidden = true;
    try {
      pending = change(draft => mutate(draft, Date.now()));
      await pending;
    } catch (error) {
      if (generation === owner) {
        failed = true;
        retry = mutate;
        element('retry-floor').hidden = false;
        text('business-status', error.message || '영업 기록을 저장하지 못했어요.');
      }
    } finally {
      if (generation === owner) busy = false;
    }
  }
  function syncClock() {
    return save((draft, now) => {
      if (draft.business) return advanceBusiness(draft.business, now);
      draft.business = firstBusiness(now);
    });
  }
  element('retry-floor').addEventListener('click', () => {
    text('business-status', '');
    if (retry) save(retry);
    else syncClock();
  });

  function commit(key, origin, point) {
    if (busy) {
      const owner = generation;
      pending?.catch(() => {}).then(() => {
        if (generation === owner && state) commit(key, origin, point);
      });
      return;
    }
    const error = placementError(layout, key, point);
    text('business-status', error);
    if (error) return;
    save((draft, now) => {
      if (!draft.business) return false;
      const [x,y] = currentLayout(draft.business)[key];
      if (x !== origin[0] || y !== origin[1]) throw Error('다른 탭에서 가구를 옮겼어요. 새 위치에서 다시 잡아 주세요.');
      return moveFurniture(draft.business, key, point, now);
    });
  }

  function pointer(event) {
    const rect = actors.getBoundingClientRect();
    return [(event.clientX - rect.left) * floor.width / rect.width, (event.clientY - rect.top) * floor.height / rect.height];
  }
  function hit(x, y) {
    if (x < 0 || y < 0 || x >= floor.width || y >= floor.height) return;
    // Only the visible furniture pixels are draggable. Tall shelves and the
    // cashier belong to the same depth ordering used to draw the room.
    for (const piece of [...pieces].sort((a,b) => b.depth - a.depth)) {
      if (!piece.layer.getContext('2d').getImageData(Math.floor(x), Math.floor(y), 1, 1).data[3]) continue;
      return piece.key;
    }
  }
  stage.addEventListener('pointerdown', event => {
    if (!state?.business || busy || drag || event.button !== 0) return;
    const start = pointer(event);
    const key = hit(...start);
    if (!key) return;
    const origin = layout[key];
    drag = { key, start, origin, point: origin, id: event.pointerId, error: '' };
    stage.setPointerCapture(event.pointerId);
    handles[key].focus({ preventScroll: true });
    stage.classList.add('dragging');
    text('business-status', FURNITURE[key].name);
    draw();
  });
  function track(event) {
    const [px,py] = pointer(event);
    const [dx,dy] = floorDelta(px - drag.start[0], py - drag.start[1]);
    drag.point = [Math.round(drag.origin[0]+dx), Math.round(drag.origin[1]+dy)];
    drag.error = placementError(layout, drag.key, drag.point);
    text('business-status', drag.error || FURNITURE[drag.key].name);
  }
  stage.addEventListener('pointermove', event => {
    if (!drag) {
      stage.style.cursor = hit(...pointer(event)) ? 'grab' : '';
      return;
    }
    if (drag.id !== event.pointerId) return;
    track(event);
    draw();
  });
  function release(event, apply) {
    if (event.pointerId !== drag?.id) return;
    if (apply) track(event);
    const item = drag;
    drag = undefined;
    stage.classList.remove('dragging');
    if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
    if (apply) commit(item.key, item.origin, item.point);
    else text('business-status', '');
    draw();
  }
  stage.addEventListener('pointerup', e => release(e, true));
  stage.addEventListener('pointercancel', e => release(e, false));
  stage.addEventListener('lostpointercapture', e => release(e, false));

  for (const [key, item] of Object.entries(FURNITURE)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = item.name;
    button.addEventListener('keydown', event => {
      const delta = { ArrowLeft: [-2,0], ArrowRight: [2,0], ArrowUp: [0,-2], ArrowDown: [0,2] }[event.key];
      if (!delta || !layout) return;
      event.preventDefault();
      const [x,y] = layout[key];
      commit(key, [x,y], [x+delta[0], y+delta[1]]);
    });
    element('furniture-handles').append(button);
    handles[key] = button;
  }

  function paint(frame, progress, losses, loyalty) {
    ctx.clearRect(0,0,actors.width,actors.height);
    let shiftX = 0, shiftY = 0;
    if (drag) {
      const [x,y] = project(...drag.origin);
      const [nx,ny] = project(...drag.point);
      shiftX = nx-x; shiftY = ny-y;
      const [fx,fy] = drag.point;
      const [l,t,r,b] = FURNITURE[drag.key].box;
      const corners = [[l,t],[r,t],[r,b],[l,b]].map(([dx,dy]) => project(fx+dx,fy+dy));
      ctx.fillStyle = drag.error ? '#a53c35' : '#548560';
      ctx.beginPath();
      corners.forEach(([cx,cy], i) => i ? ctx.lineTo(cx,cy) : ctx.moveTo(cx,cy));
      ctx.closePath();
      ctx.fill();
    }
    const layers = pieces.map(piece => drag && piece.key === drag.key
      ? { ...piece, depth: piece.depth + shiftY, moving: true } : piece);
    for (const guest of frame.people) {
      const [ax,ay] = project(...floorPoint(guest.from));
      const [bx,by] = project(...floorPoint(guest.cell));
      const t = motion.matches ? 1 : progress;
      const x = Math.round(ax + (bx-ax)*t), y = Math.round(ay + (by-ay)*t);
      layers.push({ depth: y, guest, x, y, pose: { step: !motion.matches && guest.from !== guest.cell && t < .65 ? 1 : 0,
        left: bx < ax, back: by < ay, reading: guest.carrying || guest.phase === 'read' } });
    }
    for (const item of layers.sort((a,b) => a.depth - b.depth)) {
      if (item.layer) {
        ctx.globalAlpha = item.moving ? .72 : 1;
        ctx.drawImage(item.layer, item.moving ? shiftX : 0, item.moving ? shiftY : 0);
        ctx.globalAlpha = 1;
      } else {
        const g = item.guest;
        pixelPerson(ctx,item.x,item.y,people[g.id],item.pose);
        const waiting = g.phase === 'queue' && g.cell === g.from;
        if (waiting || g.phase === 'leave' || loyalty[g.id] >= 2) {
          ctx.fillStyle = g.phase === 'leave' ? '#a44132' : waiting ? '#604622' : '#885260';
          ctx.fillRect(item.x-4,item.y-33,9,8);
          ctx.fillStyle = '#fff4ce';
          ctx.font = 'bold 8px sans-serif';
          ctx.fillText(waiting || g.phase === 'leave' ? '!' : '♥', item.x-3,item.y-26);
        }
      }
    }
    for (const cell of losses) {
      const [x,y] = project(...floorPoint(cell));
      ctx.fillStyle = '#a74938'; ctx.fillRect(x-2,y-1,5,2);
    }
  }

  function draw() {
    if (!state) return;
    const b = state.business;
    if (!b) {
      if (!busy && !failed && !document.hidden) syncClock();
      return;
    }
    const now = Date.now();
    const shift = currentShift(b,now);
    if (now >= shift.opens && !busy && !failed) syncClock();
    const loyalty = [...b.loyalty];
    for (const id of shift.frame.buyers) loyalty[id]++;
    paint(shift.frame, shift.elapsed % 1, shift.closed ? shift.day.losses : [], loyalty);
    text('business-day', '영업 ' + (b.days+1) + '일차');
    text('business-phase', shift.closed ? '다음 개점까지 ' + Math.max(0,Math.ceil((shift.opens-now)/1000)) + '초' : '영업 중');
    text('floor-guests', shift.frame.people.length + '명');
    text('floor-regulars', loyalty.filter(n => n >= 2).length + '명');
    const names = ['문학 서가','여행 서가','신간 매대'];
    const best = names.filter((_, i) => shift.day.stops[i] === Math.max(...shift.day.stops));
    const closing = '오늘 손님들이 가장 많이 멈춘 곳은 ' + best.join('·') + '입니다.'
      + (shift.day.losses.length ? ' 붉은 표시는 기다리던 손님이 책을 놓고 떠난 자리예요.' : '');
    text('floor-event', shift.closed ? closing : shift.frame.event);
  }
  function update(next) {
    state = next;
    layout = state.business ? currentLayout(state.business) : defaultLayout();
    const memo = state.memos.find(item => item.id === state.shop?.displayMemoId);
    element('business-pick').parentElement.hidden = !memo;
    text('business-pick', memo?.text || '');
    text('floor-title', state.shop?.name || DEFAULT_NAME);
    const key = JSON.stringify([layout, Boolean(memo)]);
    if (artKey !== key) {
      pieces = paintRoom(floor, { ...newShop(), floorLayout: layout, displayMemoId: memo?.id });
      for (const [id,pos] of Object.entries(layout)) {
        const [x,y] = project(...pos);
        handles[id].style.left = x / floor.width * 100 + '%';
        handles[id].style.top = y / floor.height * 100 + '%';
      }
      artKey = key;
    }
    clearInterval(timer);
    draw();
    if (!document.hidden) timer = setInterval(draw, motion.matches ? 250 : 100);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearInterval(timer);
    else if (state) update(state);
  });
  return { update, reset };
}
