import { DEFAULT_NAME, REGULARS, REGULAR_TIER, bookTraffic, newShop, regularOf, shelfReactions, visitsAt } from '../shop.js';
import { localDate } from '../store.js';
import { element } from './dom.js';
import { paintGuests, paintPortrait, paintRoom, regularProgress } from './shop-scene.js';
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
  let regulars = [];
  const cards = REGULARS.map(regular => {
    const card = element('shelf-reader-template').content.firstElementChild.cloneNode(true);
    card.id = 'regular-' + regular.id;
    card.querySelector('h4').textContent = regular.name;
    card.querySelector('.regular-wish').textContent = regular.wish;
    paintPortrait(card.querySelector('canvas'), regular.person);
    element('shop-regulars').append(card);
    return card;
  });

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
    text('shop-crowd', '매대 단골 2명 · 메모 단골 방문 중 ' + arrivals.length + '명'
      + (closeRegularCount ? ' · 반가운 단골 이상 ' + closeRegularCount + '명' : ''));
    paintGuests(actors, arrivals, now.getTime(), motion.matches, furniture, characters, regulars);
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
    update(state, date) {
      shop = state.shop || newShop();
      traffic = bookTraffic(state.memos, Date.now(), state.daily);
      closeRegularCount = traffic.readers.filter(reader => reader.tier >= REGULAR_TIER).length;
      firstDate = state.daily.reduce((first, item) => item.date < first ? item.date : first, localDate());
      text('shop-title', shop.name || DEFAULT_NAME);
      mini.setAttribute('aria-label', (shop.name || DEFAULT_NAME) + '으로 이동');
      const memo = state.memos.find(item => item.id === shop.displayMemoId);
      text('shop-book', memo?.text || (state.memos.length ? '어떤 메모를 권할까요?' : '첫 메모를 쓰면 진열할 수 있어요.'));
      element('shop-book').disabled = !memo;
      element('choose-display').disabled = !state.memos.length;
      const now = Date.now();
      regulars = shelfReactions(memo, date).map(({ interested, reason }, i) => {
        const card = cards[i];
        card.classList.toggle('interested', interested);
        const reaction = card.querySelector('.regular-reaction');
        const message = reason && (interested ? '매대에서 읽는 중 · ' : '') + reason;
        if (reaction.textContent !== message) reaction.textContent = message;
        const previous = regulars[i];
        if (previous?.interested === interested) return previous;
        return { interested, from: previous ? regularProgress(previous, now) : Number(interested), changedAt: now };
      });
      loading ??= Promise.all([loadFurnishingSheet(), loadCharacterSheet()]).then(result => {
        [sheet, characters] = result;
        cards.forEach((card, i) => paintPortrait(card.querySelector('canvas'), REGULARS[i].person, characters));
        if (shop && (sheet || characters)) {
          furniture = paintRoom(floor, shop, sheet, characters);
          draw();
        }
      });
      const nextLayout = [shop.seat, shop.level, shop.plan, Boolean(memo)].join('/');
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
      regulars = [];
      for (const card of cards) {
        card.classList.remove('interested');
        card.querySelector('.regular-reaction').textContent = '';
      }
      mini.hidden = true;
      mini.setAttribute('aria-label', '책방으로 이동');
      for (const canvas of [miniature, floor, actors]) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
      for (const id of ['shop-title', 'shop-book', 'shop-crowd', 'shop-clock', 'shop-day']) text(id, '');
    }
  };
}
