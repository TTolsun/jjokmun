import { COLLECTOR_REPUTATION, VISIT_MS, bookTraffic, newShop, operate, schedule, shiftSeconds, totals, upgradeCost } from '../shop.js';
import { element } from './dom.js';
import { displayGuests, guestPose, paintGuests, paintPortrait, paintRoom } from './shop-scene.js';
import { loadFurnishingSheet } from './shop-interior.js';

export function bindShop(change) {
  const mini = element('shop-mini');
  const miniature = mini.querySelector('canvas');
  const floor = element('shop-floor');
  let arrivals = [];
  const actors = element('shop-guests');
  const primary = element('shop-primary');
  const upgrade = element('shop-upgrade');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = motion.matches;
  let shop, visitors, duration, timer;
  let pending = false;
  let generation = 0;
  let selectedName;
  let roomLayout;
  let sheet;
  let loadingSheet;
  let furniture = [];
  let visibleGuests = [];

  function text(id, value) {
    const node = element(id);
    if (node.textContent !== value) node.textContent = value;
  }

  function draw() {
    if (!shop) return;
    const open = shop.openedAt > 0;
    const elapsed = open ? Math.max(0, (Date.now() - shop.openedAt) / 1000) : -1;
    const done = elapsed >= duration;
    const now = Date.now();
    const crowd = displayGuests(arrivals, now, reduced);
    visibleGuests = paintGuests(actors, visitors, elapsed, shop, reduced, selectedName, furniture, crowd);
    text('shop-crowd', crowd.length ? `베스트셀러 방문객 ${crowd.length}명` : '메모나 답장을 남기면 독자들이 찾아옵니다.');
    if (!mini.hidden) {
      const ctx = miniature.getContext('2d');
      ctx.drawImage(floor, 0, 0);
      ctx.drawImage(actors, 0, 0);
    }
    const result = totals(visitors, elapsed);
    const guest = visitors.find(v => v.person.name === selectedName);
    const pose = guestPose(guest, shop, elapsed, reduced);
    const preference = guest.person.seat === 'window' ? '창가' : '화분 옆';
    const taste = guest.person.plan === 'reading' ? '느긋한 독서' : '추천 판매';
    const activity = pose?.label || (elapsed < guest.enters ? '방문 예정' : '귀가 완료');
    text('shop-phase', !open ? '개점 준비' : done ? '오늘 영업 종료' : `영업 중 · ${Math.ceil(duration - elapsed)}초`);
    text('shop-sales', open ? `계산 ${result.served}/${visitors.length}명 · 매출 ${result.coins}잎전` : `방문 예정 ${visitors.length}명`);
    text('shop-guests-status', `${guest.person.name} · ${activity}`);
    let note = `좋아하는 자리 · ${preference}　/　좋아하는 방침 · ${taste}`;
    if (elapsed >= guest.paid) {
      const reason = guest.favorites.length ? guest.favorites.join(' · ') : '취향에 맞는 항목 없음';
      note = `구매 ${guest.coins}잎전　/　평판 +${guest.hearts} (${reason})`;
    } else if (pose?.reading) {
      note = guest.person.seat === shop.seat ? `“${preference}에 자리가 있네요. 한 장 더 읽고 갈래요.”` : `“다음에는 ${preference}에서 읽어 보고 싶어요.”`;
    } else if (pose?.browsing && !guest.reads) {
      note = '“오늘의 추천 책이군요. 이걸로 할게요.”';
    }
    text('shop-guest-note', note);
    element('shop-progress').value = Math.min(100, Math.max(0, 100 * elapsed / duration));
    primary.hidden = open && !done;
    primary.disabled = pending;
    text('shop-primary', done ? '오늘 매출 정산' : '가게 열기');
    if ((!open || done) && !arrivals.some(at => now < at + VISIT_MS)) stopTimer();
  }

  function stopTimer() {
    clearInterval(timer);
    timer = undefined;
  }

  function sync() {
    stopTimer();
    if (!shop || document.hidden) return;
    if (shop.openedAt || arrivals.some(at => Date.now() < at + VISIT_MS)) timer = setInterval(draw, reduced ? 650 : 125);
    draw();
  }

  function update(saved, memos) {
    if (memos) {
      const traffic = bookTraffic(memos, Date.now());
      arrivals = traffic.arrivals;
      text('shop-book', traffic.featured?.text || '첫 메모를 기다리는 중');
    }
    shop = saved || newShop();
    loadingSheet ??= loadFurnishingSheet().then(result => {
      sheet = result;
      if (sheet && shop) {
        furniture = paintRoom(element('shop-floor'), shop, sheet);
        draw();
      }
    });
    visitors = schedule(shop);
    const roster = element('shop-roster');
    if (!visitors.some(v => v.person.name === selectedName)) selectedName = visitors[0].person.name;
    const names = visitors.map(v => v.person.name);
    if (roster.children.length !== names.length || names.some((name, i) => name !== roster.children[i].textContent)) {
      roster.replaceChildren(...visitors.map(({ person }) => {
        const button = document.createElement('button');
        button.type = 'button';
        const portrait = document.createElement('canvas');
        portrait.width = 19;
        portrait.height = 21;
        portrait.setAttribute('aria-hidden', 'true');
        paintPortrait(portrait, person);
        button.append(portrait, person.name);
        return button;
      }));
    }
    for (const button of roster.children) button.setAttribute('aria-pressed', String(button.textContent === selectedName));
    duration = shiftSeconds(visitors);
    const layout = [shop.seat, shop.level, shop.plan].join('/');
    if (layout !== roomLayout) {
      furniture = paintRoom(element('shop-floor'), shop, sheet);
      roomLayout = layout;
    }
    text('shop-day', (shop.days + 1) + '일차');
    text('shop-coins', String(shop.coins));
    text('shop-hearts', String(shop.hearts));
    text('shop-regular', shop.hearts >= COLLECTOR_REPUTATION ? '헌책 수집가 별이 단골이 되었어요.'
      : `헌책 수집가 방문까지 평판 ${COLLECTOR_REPUTATION - shop.hearts} 남음`);
    element('shop-seat').value = shop.seat;
    element('shop-plan').value = shop.plan;
    element('shop-setup').disabled = Boolean(shop.openedAt) || pending;
    element('shop-setup').hidden = Boolean(shop.openedAt);
    const cost = upgradeCost(shop.level);
    upgrade.disabled = pending || Boolean(shop.openedAt) || shop.level >= 3 || shop.coins < cost;
    upgrade.hidden = Boolean(shop.openedAt);
    text('shop-upgrade', shop.level === 3 ? '서가 확장 완료' : `서가 확장 · ${cost}잎전`);
    text('shop-hint', shop.openedAt
      ? `오늘의 운영 · ${shop.seat === 'window' ? '창가 열람석' : '화분 옆 열람석'} / ${shop.plan === 'reading' ? '느긋한 독서' : '추천 판매'}`
      : (shop.plan === 'reading' ? `예정 손님 ${visitors.length}명 모두 열람석에서 책을 읽습니다.`
        : `추천대를 찾을 손님 ${visitors.filter(v => !v.reads).length}명 · 열람석을 이용할 손님 ${visitors.filter(v => v.reads).length}명 · 책값 +2잎전`));
    sync();
  }

  async function act(action, value) {
    if (!shop || pending) return;
    const turn = generation;
    const before = shop;
    const now = Date.now();
    const earnings = totals(visitors, Infinity);
    pending = true;
    update(shop);
    text('shop-message', '');
    try {
      let applied;
      await change(draft => {
        const current = draft.shop || newShop();
        if (current.days !== before.days || current.level !== before.level || current.openedAt !== before.openedAt
          || (action === 'open' && (before.seat !== current.seat || before.plan !== current.plan))) {
          throw new Error('다른 탭에서 운영 상태가 바뀌었어요. 다시 확인해 주세요.');
        }
        applied = operate(current, action, value, now);
        if (!applied) return false;
        draft.shop = current;
      });
      if (turn !== generation || !applied) return;
      if (action === 'open') element('shop-roster').querySelector('[aria-pressed="true"]').focus();
      if (action === 'settle') text('shop-message', `${before.days + 1}일차 결산 · 매출 +${earnings.coins}잎전, 평판 +${earnings.hearts}`);
      if (action === 'upgrade') text('shop-message', '서가를 늘렸어요. 다음 영업부터 손님이 한 명 더 찾아옵니다.');
    } catch (error) {
      if (turn === generation) text('shop-message', error.message || '운영 기록을 저장하지 못했습니다.');
    } finally {
      if (turn === generation) {
        pending = false;
        update(shop);
      }
    }
  }

  new IntersectionObserver(([entry]) => {
    mini.hidden = !shop || entry.isIntersecting;
    if (!mini.hidden) draw();
  }, {rootMargin: '-68px 0px 0px', threshold: 0.05}).observe(floor);
  actors.addEventListener('click', event => {
    const bounds = actors.getBoundingClientRect();
    const x = (event.clientX - bounds.left) * actors.width / bounds.width;
    const y = (event.clientY - bounds.top) * actors.height / bounds.height;
    const guest = visibleGuests.find(item => Math.abs(x - item.x) <= 8 && y >= item.y - 24 && y <= item.y + 2);
    if (guest) {
      element('shop-controls').open = true;
      element('shop-roster').children[guest.v.i]?.click();
    }
  });
  element('shop-roster').addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || !shop) return;
    selectedName = button.textContent;
    for (const item of button.parentElement.children) item.setAttribute('aria-pressed', String(item === button));
    draw();
  });
  element('shop-seat').addEventListener('change', event => act('seat', event.target.value));
  element('shop-plan').addEventListener('change', event => act('plan', event.target.value));
  primary.addEventListener('click', () => act(shop.openedAt ? 'settle' : 'open'));
  upgrade.addEventListener('click', () => act('upgrade'));
  document.addEventListener('visibilitychange', sync);
  function setMotion(value) {
    reduced = value;
    element('shop-motion').setAttribute('aria-pressed', String(value));
    sync();
  }
  setMotion(motion.matches);
  element('shop-motion').addEventListener('click', () => setMotion(!reduced));
  motion.addEventListener('change', () => setMotion(motion.matches));
  return { update, reset() {
    generation++;
    pending = false;
    shop = undefined;
    visitors = [];
    selectedName = undefined;
    roomLayout = undefined;
    furniture = [];
    visibleGuests = [];
    element('shop-roster').replaceChildren();
    stopTimer();
    arrivals = [];
    mini.hidden = true;
    element('shop-controls').open = false;
    for (const canvas of [miniature, actors, floor]) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    for (const id of ['shop-day', 'shop-coins', 'shop-hearts', 'shop-phase', 'shop-sales', 'shop-guests-status',
      'shop-guest-note', 'shop-message', 'shop-book', 'shop-crowd', 'shop-primary', 'shop-upgrade', 'shop-hint', 'shop-regular']) text(id, '');
    element('shop-progress').value = 0;
    element('shop-seat').selectedIndex = element('shop-plan').selectedIndex = 0;
  } };
}
