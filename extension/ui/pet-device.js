import { createBallGame, pressBallGame } from '../ball-game.js';
import { element } from './dom.js';

const MENUS = {
  egg: { title: '알 돌보기', actions: ['adopt', 'pet'] },
  food: { title: '먹이 주기', actions: ['feed', 'snack'] },
  activity: { title: '함께 놀기', actions: ['play', 'explore', 'pet'] },
  clean: { title: '정원 청소', actions: ['clean'] },
  lamp: { title: '조명', actions: ['sleep', 'wake'] },
  heal: { title: '치료', actions: ['heal'] },
  status: { title: '펫 상태' },
  restart: { title: '새 알', actions: ['newEgg'] }
};
const PANELS = { clock: 'pet-clock', status: 'pet-state', menu: 'pet-menu', confirm: 'pet-confirm', game: 'pet-game' };
const KEYS = { a: 'a', b: 'b', c: 'c', ArrowRight: 'a' };
const DIRECTION_NAMES = { left: '왼쪽', center: '가운데', right: '오른쪽' };
const FORMAT_TIME = new Intl.DateTimeFormat('ko-KR', { hour: 'numeric', minute: '2-digit', hour12: false });
const FORMAT_DAY = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' });

function keysFor(pet) {
  if (!pet) return ['egg'];
  if (pet.form === 'egg') return ['egg', 'status'];
  const keys = ['food', 'activity', 'clean', 'lamp', 'heal', 'status'];
  if (pet.available.includes('newEgg')) keys.push('restart');
  return keys;
}

// Both sprites use object-fit: contain. The miniature centers the art; the full sprite rests on the floor.
function faceY(box, image, bottomAligned) {
  const height = image.naturalWidth
    ? Math.min(box.height, box.width * image.naturalHeight / image.naturalWidth)
    : box.height;
  return box.top + (box.height - height) * (bottomAligned ? 1 : 0.5) + height * 0.4;
}

export function bindPetDevice(act, editorReturn) {
  const shell = element('pet-device');
  const trigger = element('pet-expand');
  const popover = element('pet-popover');
  const summarySprite = element('pet-summary-sprite');
  const habitat = element('pet-habitat');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const buttonB = element('pet-b');
  const icons = [...shell.querySelectorAll('[data-pet-menu]')];
  const actions = [...shell.querySelectorAll('[data-pet-action]')];
  const confirmButtons = [shell.querySelector('[data-pet-keep]'), shell.querySelector('[data-pet-confirm]')];
  const lanes = [...shell.querySelectorAll('[data-ball-direction]')];
  let pet;
  let working = false;
  let active = false;
  let expanded = false;
  let motion;
  let faceHeightFraction;
  let mode = 'idle';
  let menuKey;
  let selectedAction;
  let confirm = 0;
  let statusPage = 0;
  let game;
  let gameOwner;

  function choices() {
    if (menuKey === 'egg') return [pet ? 'pet' : 'adopt', 'back'];
    if (menuKey === 'lamp') return [pet?.sleeping ? 'wake' : 'sleep', 'back'];
    return [...(MENUS[menuKey]?.actions || []), 'back'];
  }

  function available(action) {
    return action === 'back' || (pet?.available || ['adopt']).includes(action);
  }

  function place(lifting = false) {
    if (!expanded || motion) return;
    const viewport = window.visualViewport;
    const margin = 10;
    const width = viewport?.width ?? window.innerWidth;
    const height = viewport?.height ?? window.innerHeight;
    popover.style.setProperty('--pet-view-width', `${width}px`);
    popover.style.setProperty('--pet-view-height', `${height}px`);
    const viewLeft = (viewport?.offsetLeft ?? 0) + margin;
    const viewTop = (viewport?.offsetTop ?? 0) + margin;
    const anchor = summarySprite.getBoundingClientRect();
    const anchorX = anchor.left + anchor.width / 2;
    const anchorY = faceY(anchor, summarySprite, false);
    const box = popover.getBoundingClientRect();
    const screen = habitat.getBoundingClientRect();
    if (lifting) {
      // Remember the idle pose so the overlay stays put while the pet plays or changes panels.
      const spriteBox = element('pet-sprite-button').getBoundingClientRect();
      faceHeightFraction = (faceY(spriteBox, element('pet-sprite'), true) - screen.top) / (screen.height || 1);
    }
    const originX = screen.left + screen.width / 2 - box.left;
    const originY = screen.top + screen.height * faceHeightFraction - box.top;
    const lastLeft = width + viewLeft - box.width - 2 * margin;
    const lastTop = height + viewTop - box.height - 2 * margin;
    const left = Math.max(viewLeft, Math.min(anchorX - originX, lastLeft));
    const top = Math.max(viewTop, Math.min(anchorY - originY, lastTop));
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
  }

  function animateDevice(direction) {
    const mini = trigger.getBoundingClientRect();
    const full = shell.getBoundingClientRect();
    const box = popover.getBoundingClientRect();
    const sprite = element('pet-sprite-button').getBoundingClientRect();
    const x = sprite.left + sprite.width / 2;
    const y = faceY(sprite, element('pet-sprite'), true);
    popover.style.transformOrigin = `${x - box.left}px ${y - box.top}px`;
    const scale = mini.width / full.width;
    // Scaling around the face moves the shell edges. Land them on the miniature.
    const dx = mini.left - (x + (full.left - x) * scale);
    const dy = mini.top - (y + (full.top - y) * scale);
    const dock = `translate(${dx}px, ${dy}px) scale(${scale})`;
    return popover.animate([{ transform: dock }, { transform: 'none' }], {
      duration: 180, easing: 'cubic-bezier(.2, .7, .2, 1)', direction, fill: 'both'
    });
  }

  function open() {
    if (!active || !popover.hidden) return;
    editorReturn.capture();
    expanded = true;
    trigger.setAttribute('aria-expanded', 'true');
    popover.hidden = false;
    popover.inert = false;
    popover.showPopover();
    popover.scrollTop = 0;
    place(true);
    if (!reducedMotion.matches) {
      motion = animateDevice('normal');
      motion.onfinish = () => {
        motion.cancel();
        motion = undefined;
        place();
      };
    }
    element('pet-a').focus({ preventScroll: true });
  }

  function finishClose(restoreFocus) {
    if (motion) {
      motion.onfinish = null;
      motion.cancel();
      motion = undefined;
    }
    game = gameOwner = undefined;
    idle();
    popover.hidePopover();
    popover.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    render();
    if (restoreFocus) {
      if (!editorReturn.restore()) trigger.focus({ preventScroll: true });
    } else {
      editorReturn.reset();
    }
  }

  function close(restoreFocus = true) {
    if (popover.hidden || (!expanded && restoreFocus)) {
      if (!restoreFocus) editorReturn.reset();
      return;
    }
    expanded = false;
    if (!restoreFocus || reducedMotion.matches) {
      finishClose(restoreFocus);
      return;
    }
    popover.inert = true;
    if (motion) {
      // A quick Escape retraces the lift from the currently visible frame.
      motion.reverse();
    } else {
      motion = animateDevice('reverse');
    }
    motion.onfinish = () => {
      const focus = document.activeElement;
      finishClose(focus === document.body || popover.contains(focus) || focus === trigger);
    };
  }

  function renderGame() {
    const panel = element('pet-game');
    const ball = element('pet-game-ball');
    if (!game || mode !== 'game') {
      delete panel.dataset.phase;
      delete panel.dataset.target;
      delete panel.dataset.direction;
      element('pet-game-message').textContent = '';
      element('pet-game-score').textContent = '';
      ball.hidden = true;
      delete ball.dataset.direction;
      delete ball.dataset.hit;
      return;
    }
    const { phase, turn, turns, target, direction, hits, lastHit } = game;
    panel.dataset.phase = phase;
    panel.dataset.target = target || '';
    panel.dataset.direction = phase === 'ready' ? '' : direction;
    element('pet-game-lanes').hidden = phase === 'ready' || phase === 'complete';
    ball.hidden = phase !== 'result';
    ball.dataset.direction = direction;
    ball.dataset.hit = String(lastHit === true);
    const text = phase === 'ready' ? 'B로 시작'
      : phase === 'aim' ? `${DIRECTION_NAMES[target]}에 던져요.`
        : phase === 'result' ? lastHit ? '받았어요!' : '놓쳤어요.'
          : working ? '저장 중' : '공놀이를 마쳤어요.';
    const message = element('pet-game-message');
    if (message.textContent !== text) message.textContent = text;
    element('pet-game-score').textContent = phase === 'complete' ? `${turns}번 중 ${hits}번 받았어요` : `${turn || 1} / ${turns}회 · 성공 ${hits}`;
    for (const lane of lanes) {
      const key = lane.dataset.ballDirection;
      lane.dataset.target = String(key === target);
      lane.setAttribute('aria-pressed', String(key === direction));
      lane.disabled = phase !== 'aim';
      lane.setAttribute('aria-label', DIRECTION_NAMES[key] + (key === target ? ' · 공을 받을 곳' : ''));
    }
  }

  function render() {
    const focus = document.activeElement;
    const keys = keysFor(pet);
    shell.dataset.mode = mode;
    shell.setAttribute('aria-busy', String(working));
    buttonB.querySelector('span').textContent = mode === 'idle' ? '시계' : '결정';
    element('pet-c').querySelector('span').textContent = game && game.phase !== 'complete' ? '끝내고 닫기' : '닫기';
    const spriteButton = element('pet-sprite-button');
    spriteButton.tabIndex = mode === 'game' ? -1 : 0;
    spriteButton.setAttribute('aria-hidden', String(mode === 'game'));
    element('pet-screen-label').textContent = mode === 'clock' ? '시계' : mode === 'game' ? '미니게임'
      : mode === 'status' ? `상태 ${statusPage + 1}/2` : mode === 'confirm' ? '새 알' : mode === 'idle' ? '' : MENUS[menuKey]?.title || '돌봄';
    element('pet-state').dataset.page = statusPage ? 'overview' : 'meters';
    element('pet-attention').hidden = !pet || pet.sleeping || !pet.needs.length;
    for (const [panelMode, id] of Object.entries(PANELS)) element(id).hidden = mode !== panelMode;
    for (const icon of icons) {
      const key = icon.dataset.petMenu;
      icon.hidden = !keys.includes(key);
      icon.disabled = working;
      icon.setAttribute('aria-pressed', String(mode !== 'idle' && menuKey === key));
    }
    const options = mode === 'menu' ? choices() : [];
    if (!options.includes(selectedAction) || !available(selectedAction)) {
      selectedAction = options.find(available) || options[0];
    }
    for (const button of actions) {
      const action = button.dataset.petAction;
      if (action === 'play') button.textContent = game && game.phase !== 'complete' ? '공놀이 계속' : '공놀이';
      button.hidden = !options.includes(action);
      button.setAttribute('aria-disabled', String(working || !available(action)));
      button.setAttribute('aria-pressed', String(action === selectedAction));
    }
    if (mode === 'menu') {
      element('pet-menu-title').textContent = MENUS[menuKey].title;
      element('pet-menu-help').textContent = working ? '저장 중'
        : !options.some(action => action !== 'back' && available(action)) ? '지금은 할 수 없어요.' : '';
    }
    confirmButtons.forEach((button, index) => button.setAttribute('aria-pressed', String(confirm === index)));
    if (mode === 'clock') {
      const now = new Date();
      const time = element('pet-clock-time');
      time.dateTime = now.toISOString();
      time.textContent = FORMAT_TIME.format(now);
      element('pet-clock-date').textContent = FORMAT_DAY.format(now);
      element('pet-time').textContent = (pet?.night ?? (now.getHours() < 6 || now.getHours() >= 20)) ? '밤' : '낮';
    }
    renderGame();
    if (shell.contains(focus) && (focus.closest('[hidden]') || focus.matches(':disabled'))) {
      buttonB.focus({ preventScroll: true });
    }
  }

  function openMenu(key) {
    if (!active || !expanded || working || !keysFor(pet).includes(key)) return;
    if (game?.phase === 'complete') game = gameOwner = undefined;
    menuKey = key;
    selectedAction = undefined;
    statusPage = 0;
    mode = key === 'status' ? 'status' : 'menu';
    render();
    element('pet-menu').scrollTop = 0;
  }

  function selectMenu() {
    const keys = keysFor(pet);
    menuKey = keys[(keys.indexOf(menuKey) + 1) % keys.length];
    mode = 'select';
  }

  function idle() {
    mode = 'idle';
    menuKey = selectedAction = undefined;
  }

  function choose(action) {
    if (!active || !expanded || working || !available(action)) return;
    if (action === 'back') {
      mode = 'select';
      render();
      return;
    }
    if (action === 'newEgg') {
      mode = 'confirm';
      confirm = 0;
      render();
      return;
    }
    if (action === 'play') {
      if (!game) {
        game = createBallGame();
        gameOwner = { form: pet.form, startedAt: pet.startedAt };
      }
      mode = 'game';
      render();
      return;
    }
    idle();
    render();
    void act(action);
  }

  function sendBall(button) {
    if (game.phase === 'complete') {
      if (working || button === 'a') return;
      game = gameOwner = undefined;
      idle();
      render();
      return;
    }
    const next = pressBallGame(game, button);
    if (!next) idle();
    else {
      game = next;
      if (next.phase === 'complete') void act('play', gameOwner);
    }
    render();
  }

  function press(button) {
    if (!active || !expanded) return;
    if (button === 'c') {
      close();
      return;
    }
    if (mode === 'game') {
      sendBall(button);
      return;
    }
    if (mode === 'confirm') {
      if (button === 'a') confirm = 1 - confirm;
      else if (!working) {
        if (confirm) {
          idle();
          void act('newEgg');
        } else mode = 'menu';
      }
    } else if (mode === 'menu') {
      if (button === 'a') {
        const options = choices().filter(available);
        selectedAction = options[(options.indexOf(selectedAction) + 1) % options.length];
        const row = actions.find(item => item.dataset.petAction === selectedAction);
        const panel = element('pet-menu');
        const bounds = panel.getBoundingClientRect();
        const position = row?.getBoundingClientRect();
        if (position && position.bottom > bounds.bottom) panel.scrollTop += position.bottom - bounds.bottom;
        if (position && position.top < bounds.top) panel.scrollTop -= bounds.top - position.top;
      } else choose(selectedAction);
    } else if (mode === 'idle' || mode === 'select') {
      if (button === 'a') selectMenu();
      else if (mode === 'idle') mode = 'clock';
      else openMenu(menuKey);
    } else if (mode === 'status' && button === 'a') statusPage = 1 - statusPage;
    else if (mode === 'clock' || mode === 'status') idle();
    render();
  }

  trigger.addEventListener('click', open);
  const reposition = () => place();
  window.addEventListener('scroll', reposition, { passive: true });
  window.addEventListener('resize', reposition);
  window.visualViewport?.addEventListener('scroll', reposition);
  window.visualViewport?.addEventListener('resize', reposition);
  const geometry = new ResizeObserver(reposition);
  geometry.observe(popover);
  geometry.observe(document.querySelector('.workspace'));

  for (const key of ['a', 'b', 'c']) {
    element('pet-' + key).addEventListener('click', () => press(key));
  }
  for (const icon of icons) icon.addEventListener('click', () => openMenu(icon.dataset.petMenu));
  for (const button of actions) button.addEventListener('click', () => choose(button.dataset.petAction));
  confirmButtons.forEach((button, index) => button.addEventListener('click', () => {
    confirm = index;
    press('b');
  }));
  for (const lane of lanes) lane.addEventListener('click', () => {
    if (game?.phase !== 'aim') return;
    while (game.direction !== lane.dataset.ballDirection) game = pressBallGame(game, 'a');
    render();
  });
  document.addEventListener('keydown', event => {
    if (!active || !expanded || event.defaultPrevented || event.repeat || event.isComposing
      || event.ctrlKey || event.metaKey || event.altKey || document.querySelector('dialog[open]')) return;
    const character = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (character === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.target !== document.body && !popover.contains(event.target)) return;
    const key = KEYS[character] || (character === 'Enter' && !event.target.closest?.('button, summary, a') ? 'b' : undefined);
    if (!key) return;
    event.preventDefault();
    press(key);
  }, { capture: true });

  function update(value, pending) {
    active = true;
    pet = value;
    working = pending;
    if (game && (!pet || gameOwner.form !== pet.form || gameOwner.startedAt !== pet.startedAt)) {
      game = gameOwner = undefined;
      idle();
    }
    if (menuKey && !keysFor(pet).includes(menuKey) && mode !== 'game') idle();
    render();
  }

  function reset() {
    active = false;
    pet = undefined;
    working = false;
    game = gameOwner = undefined;
    close(false);
    idle();
    render();
    for (const id of ['pet-clock-time', 'pet-clock-date', 'pet-time', 'pet-menu-title', 'pet-menu-help']) element(id).textContent = '';
    element('pet-clock-time').removeAttribute('datetime');
  }

  return { update, reset, isIdle: () => expanded && (mode === 'idle' || mode === 'select') };
}
