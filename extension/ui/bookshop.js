import { DEFAULT_NAME, REGULAR_TIER, bookTraffic, newShop, regularOf, visitsAt } from '../shop.js';
import { localDate } from '../store.js';
import { element } from './dom.js';
import { paintGuests, paintPortrait, paintRoom } from './shop-scene.js';
import { loadCharacterSheet, loadFurnishingSheet } from './shop-interior.js';

const clock = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

export function bindShop() {
  const mini = element('shop-mini');
  const miniature = mini.querySelector('canvas');
  const floor = element('shop-floor');
  const actors = element('shop-guests');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let shop, traffic, firstDate, sheet, characters, loading, layout, timer;
  let furniture = [];
  let closeRegularCount = 0;

  function text(id, value) {
    if (element(id).textContent !== value) element(id).textContent = value;
  }

  function draw() {
    if (!shop) return;
    const now = new Date();
    const day = localDate(now);
    const elapsed = Math.max(0, (Date.parse(day) - Date.parse(firstDate || day)) / 86400000);
    text('shop-day', (elapsed + 1) + '일차');
    text('shop-clock', clock.format(now));
    const arrivals = visitsAt(traffic, now.getTime());
    text('shop-crowd', '단골 ' + traffic.readers.length + '명 · 방문 중 ' + arrivals.length + '명'
      + (closeRegularCount ? ' · 반가운 단골 이상 ' + closeRegularCount + '명' : ''));
    paintGuests(actors, arrivals, now.getTime(), motion.matches, furniture, characters);
    if (!mini.hidden) {
      const ctx = miniature.getContext('2d');
      ctx.drawImage(floor, 0, 0);
      ctx.drawImage(actors, 0, 0);
    }
  }

  function sync() {
    clearInterval(timer);
    if (!shop || document.hidden) return;
    draw();
    timer = setInterval(draw, motion.matches || !traffic.readers.length ? 500 : 125);
  }

  new IntersectionObserver(([entry]) => {
    mini.hidden = !shop || entry.isIntersecting;
    if (!mini.hidden) draw();
  }, {rootMargin: '-68px 0px 0px', threshold: 0.05}).observe(floor);
  document.addEventListener('visibilitychange', sync);
  motion.addEventListener('change', sync);

  return {
    update(state) {
      shop = state.shop || newShop();
      traffic = bookTraffic(state.memos, Date.now(), state.daily);
      closeRegularCount = traffic.readers.filter(reader => reader.tier >= REGULAR_TIER).length;
      firstDate = state.daily.reduce((first, item) => item.date < first ? item.date : first, localDate());
      text('shop-title', shop.name || DEFAULT_NAME);
      mini.setAttribute('aria-label', (shop.name || DEFAULT_NAME) + '으로 이동');
      text('shop-book', traffic.featured?.text || '첫 메모를 기다리는 중');
      loading ??= Promise.all([loadFurnishingSheet(), loadCharacterSheet()]).then(result => {
        [sheet, characters] = result;
        if (shop && (sheet || characters)) {
          furniture = paintRoom(floor, shop, sheet, characters);
          draw();
        }
      });
      const nextLayout = [shop.seat, shop.level, shop.plan].join('/');
      if (nextLayout !== layout) {
        furniture = paintRoom(floor, shop, sheet, characters);
        layout = nextLayout;
      }
      draw();
      sync();
    },
    portrait(canvas, memoId) {
      paintPortrait(canvas, regularOf(memoId).person, characters);
    },
    reset() {
      clearInterval(timer);
      shop = traffic = layout = undefined;
      furniture = [];
      mini.hidden = true;
      mini.setAttribute('aria-label', '책방으로 이동');
      for (const canvas of [miniature, floor, actors]) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
      for (const id of ['shop-title', 'shop-book', 'shop-crowd', 'shop-clock', 'shop-day']) text(id, '');
    }
  };
}
