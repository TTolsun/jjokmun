import { petView, applyPetAction, petEvolution, dominantPetHabit, PET_FORM_DETAILS } from '../pet.js';
import { element } from './dom.js';
import { bindPetCollection, familyPath, STAGE_NAMES } from './pet-collection.js';
import { bindPetDevice } from './pet-device.js';
import { FAMILY_NAMES, familyHabit, familyPrecursor, familyReaction } from './pet-family-motion.js';

const METERS = ['hunger', 'happiness', 'energy', 'health', 'growth'];
const MAX_TIMEOUT_DELAY = 2_147_483_647;
const CARE_STATUS = {
  feed: '밥을 줬어요.', snack: '간식을 줬어요.', play: '공놀이를 마쳤어요.',
  explore: '정원 탐색을 마쳤어요.', pet: '쓰다듬었어요.', clean: '청소했어요.',
  sleep: '재웠어요.', wake: '깨웠어요.', heal: '치료했어요.'
};
const EFFECTS = { feed: '♪', snack: '♪', play: '✦', explore: '✧', clean: '✧', sleep: 'z z', wake: '☀', heal: '✚', pet: '♥', memo: '♥' };
const BABY_POSES = { feed: 'feed', snack: 'feed', play: 'play', explore: 'explore', pet: 'pet', memo: 'pet' };
const HABITS = {
  play: { action: 'play' },
  explore: { action: 'explore' },
  affection: { action: 'pet' }
};
const FIRE_PUP_HABITS = {
  play: { action: 'play', reaction: 'pup-tap' },
  explore: { action: 'explore', reaction: 'sniff' },
  affection: { action: 'pet', reaction: 'nestle' }
};
const ACTIVE_HABITS = {
  play: '이번 성장기에는 공놀이를 가장 자주 했어요.',
  explore: '이번 성장기에는 정원을 가장 자주 탐색했어요.',
  affection: '이번 성장기에는 쓰다듬으며 가장 자주 교감했어요.'
};
const FIRE_MOTIONS = {
  'fire-runner': ['play', 'look-back'],
  'fire-scout': ['explore', 'nose-first'],
  'fire-cuddler': ['pet', 'nestle'],
  'fire-runner-runner': ['play', 'dash'],
  'fire-runner-scout': ['explore', 'beacon'],
  'fire-runner-cuddler': ['pet', 'nestle'],
  'fire-scout-runner': ['play', 'flutter'],
  'fire-scout-scout': ['explore', 'sniff'],
  'fire-scout-cuddler': ['pet', 'nestle'],
  'fire-cuddler-runner': ['play', 'flutter'],
  'fire-cuddler-scout': ['explore', 'beacon'],
  'fire-cuddler-cuddler': ['pet', 'nestle']
};
const PLAY_MOTIONS = {
  'fire-pup': 'pup-tap', 'fire-runner': 'look-back', 'fire-scout': 'nose-first', 'fire-cuddler': 'paw-rest',
  'fire-scout-runner': 'flutter', 'fire-runner-scout': 'beacon',
  'fire-scout-scout': 'sniff', 'fire-cuddler-scout': 'beacon', 'fire-scout-cuddler': 'nestle',
  'fire-cuddler-cuddler': 'nestle', 'fire-runner-cuddler': 'nestle',
  'fire-cuddler-runner': 'flutter'
};
const HABIT_ACTIONS = { play: 'play', explore: 'explore', affection: 'pet' };
const FIRE_PRECURSORS = {
  'fire-runner': {
    play: 'dash',
    explore: 'beacon',
    affection: 'nestle'
  },
  'fire-scout': {
    play: 'flutter',
    explore: 'sniff',
    affection: 'nestle'
  },
  'fire-cuddler': {
    play: 'flutter',
    explore: 'beacon',
    affection: 'nestle'
  }
};
const NEEDS = {
  feed: '빈 그릇을 바라보고 있어요. 배가 고픈가 봐요.', play: '같이 놀고 싶어요.', clean: '정원을 청소해 주세요.',
  sleep: '자꾸 눈을 비비네요. 졸린가 봐요.', heal: '몸이 아파요.', pet: '곁에서 돌봐 주세요.'
};
const ADULT_NEEDS = { feed: '배가 고파 보여요.', sleep: '기력이 떨어졌어요.' };
const ADULT_NEED_SYMBOLS = { feed: '🍎', sleep: '🌙', heal: '🩹', clean: '🧹', play: '🎾' };

function formName(form) {
  return PET_FORM_DETAILS[form]?.name;
}

function precursor(form, habit) {
  const next = FIRE_PRECURSORS[form]?.[habit];
  if (next) return { action: HABIT_ACTIONS[habit], reaction: next, preview: true };
  return familyPrecursor(form, habit);
}

function growthHint(pet) {
  if (!FAMILY_NAMES[pet?.lineage] || pet.stage < 1 || pet.stage >= 3) return '';
  return ACTIVE_HABITS[dominantPetHabit(pet)] || '';
}

function growthTime(pet, now) {
  if (!Number.isFinite(pet?.nextGrowthAt)) return '완료';
  const remaining = Math.max(0, pet.nextGrowthAt - now);
  if (remaining < 60000) return '1분 미만';
  const minutes = Math.ceil(remaining / 60000);
  if (minutes >= 60) return `${Math.floor(minutes / 60)}시간${minutes % 60 ? ' ' + (minutes % 60) + '분' : ''} 남음`;
  return `${minutes}분 남음`;
}

export function bindPet(change, saveError, editorReturn) {
  const habitat = element('pet-habitat');
  const sprite = element('pet-sprite');
  const summarySprite = element('pet-summary-sprite');
  const spriteButton = element('pet-sprite-button');
  const device = bindPetDevice(act, editorReturn);
  const collection = bindPetCollection();
  const status = element('pet-status');
  const meters = METERS.map(key => [key, element('pet-' + key)]);
  let current;
  let pending;
  let active = false;
  let effectTimer;
  let growthTimer;
  let scheduledGrowth;
  let habit;
  let lastHabit = 0;
  let retryGrowthAt = 0;

  function scheduleGrowth(at, now) {
    if (at === scheduledGrowth) return;
    clearTimeout(growthTimer);
    scheduledGrowth = Number.isFinite(at) ? at : undefined;
    if (scheduledGrowth === undefined) return;
    const delay = Math.min(MAX_TIMEOUT_DELAY, Math.max(0, scheduledGrowth - now));
    growthTimer = setTimeout(() => {
      scheduledGrowth = undefined;
      if (active) render(current);
    }, delay);
  }

  function habitOf(pet) {
    const next = pet?.stage === 2 && precursor(pet.form, dominantPetHabit(pet));
    if (next) return next;
    const fire = FIRE_MOTIONS[pet?.form];
    if (fire) {
      const [action, reaction] = fire;
      return { action, reaction };
    }
    const details = PET_FORM_DETAILS[pet?.form];
    const leading = details?.stage === 1 ? dominantPetHabit(pet) : undefined;
    if (pet?.form === 'fire-pup') return FIRE_PUP_HABITS[leading];
    if (FAMILY_NAMES[details?.lineage]) return familyHabit(pet, leading);
    return HABITS[details?.stage === 1 ? dominantPetHabit(pet) : details?.habit];
  }

  function render(value) {
    active = true;
    current = value;
    const now = Date.now();
    const pet = petView(current, now);
    const evolved = pet?.form !== current?.form;
    if (evolved && !pending && now >= retryGrowthAt) void saveGrowth();
    scheduleGrowth(evolved && !pending ? retryGrowthAt : pet?.nextGrowthAt, now);
    const form = pet?.form || 'egg';
    const stage = pet?.stage ?? (form === 'egg' ? 0 : form === 'baby' ? 1 : 3);
    const motion = habitat.dataset.motion;
    const available = pet?.available || ['adopt'];
    const conditions = pet?.needs.map(need => (stage > 1 || motion) && ADULT_NEEDS[need] || NEEDS[need]).filter(Boolean).slice(0, 2).join(' ');
    const needSymbol = element('pet-need-symbol');
    needSymbol.textContent = stage > 1 && !pet.sleeping ? ADULT_NEED_SYMBOLS[pet.needs[0]] || '' : '';
    needSymbol.hidden = !needSymbol.textContent;
    const name = pet ? formName(form) : '낯선 알';
    element('pet-name').textContent = name;
    element('pet-lcd-name').textContent = name;
    const stageLabel = element('pet-stage-label');
    stageLabel.hidden = !pet;
    stageLabel.textContent = stage > 0 && FAMILY_NAMES[pet?.lineage] ? FAMILY_NAMES[pet.lineage] + ' · ' + STAGE_NAMES[stage]
      : form !== 'egg' && form !== 'baby' ? '새싹이 가족 · 성장 완료' : STAGE_NAMES[stage];
    const path = element('pet-path');
    path.textContent = stage > 1 ? familyPath(form) : '';
    path.hidden = !path.textContent;
    const nextGrowth = element('pet-growth-hint');
    nextGrowth.textContent = growthHint(pet);
    nextGrowth.hidden = !nextGrowth.textContent;
    const condition = element('pet-condition');
    condition.textContent = pet?.sleeping ? '잠들었어요.' : conditions || '';
    condition.hidden = !condition.textContent;
    habit = pet?.sleeping || pet?.needs.includes('heal') ? undefined : habitOf(pet);
    habitat.dataset.form = form;
    habitat.dataset.stage = stage;
    habitat.classList.toggle('pet-night', Boolean(pet?.night));
    habitat.classList.toggle('pet-sleeping', Boolean(pet?.sleeping));
    habitat.classList.toggle('pet-sick', Boolean(pet?.needs.includes('heal')));
    const idlePose = pet?.needs.includes('heal') ? 'sick' : pet?.needs.includes('feed') ? 'hungry' : pet?.needs.includes('sleep') ? 'tired' : '';
    const modern = stage > 0 && Boolean(FAMILY_NAMES[pet?.lineage]);
    const actionPose = modern && motion === 'wake' ? 'wake' : BABY_POSES[motion];
    const pose = stage === 1 ? (pet.sleeping ? 'sleep' : actionPose || idlePose)
      : stage === 2 && habitat.dataset.preview === 'true' ? 'habit-' + motion
        : modern && motion === 'play' ? 'play' : '';
    const source = `art/${form}${pose ? '-' + pose : ''}.png`;
    if (sprite.getAttribute('src') !== source) sprite.src = source;
    const summarySource = `art/${form}.png`;
    if (summarySprite.getAttribute('src') !== summarySource) summarySprite.src = summarySource;
    summarySprite.parentElement.classList.toggle('pet-night', Boolean(pet?.night || pet?.sleeping));
    sprite.alt = name;
    spriteButton.disabled = !available.includes('pet');
    spriteButton.setAttribute('aria-disabled', String(Boolean(pending) || spriteButton.disabled));
    spriteButton.setAttribute('aria-label', form === 'egg' ? '알 쓰다듬기' : name + ' 쓰다듬기');
    element('pet-poop').hidden = !pet?.poop;
    element('pet-meters').hidden = !pet;
    for (const [key, meter] of meters) {
      const score = Math.round(pet?.[key] ?? 0);
      meter.closest('div').hidden = form === 'egg' && key !== 'growth';
      meter.value = score;
      if (key === 'growth') {
        const time = pet ? growthTime(pet, now) : '';
        meter.nextElementSibling.textContent = time;
        meter.setAttribute('aria-valuetext', time);
      } else {
        meter.nextElementSibling.textContent = score;
      }
    }
    device.update(pet, Boolean(pending));
    collection.update(pet?.discovered || [], pet?.form);
  }

  function clearEffect() {
    clearTimeout(effectTimer);
    delete habitat.dataset.motion;
    delete habitat.dataset.reaction;
    delete habitat.dataset.preview;
    element('pet-effect').textContent = '';
  }

  function showEffect(action, reaction, preview = false, followUp) {
    clearEffect();
    lastHabit = Date.now();
    // Restart the animation when the same action was just used.
    void sprite.offsetWidth;
    habitat.dataset.motion = action;
    if (reaction) habitat.dataset.reaction = reaction;
    if (preview) habitat.dataset.preview = 'true';
    const characterPlay = action === 'play' && FAMILY_NAMES[PET_FORM_DETAILS[current?.form]?.lineage];
    element('pet-effect').textContent = characterPlay || preview ? '' : EFFECTS[action] || '✦';
    render(current);
    effectTimer = setTimeout(() => {
      clearEffect();
      render(current);
      if (followUp && current && device.isIdle() && !pending && !document.hidden) {
        const next = precursor(current.form, dominantPetHabit(current));
        if (next?.action === 'play') showEffect(next.action, next.reaction, true);
      }
    }, action === 'evolve' ? 1750 : 1300);
  }

  async function saveGrowth() {
    const request = {};
    pending = request;
    try {
      let evolution;
      let previousForm;
      await change(state => {
        previousForm = state.pet?.form;
        evolution = petEvolution(state.pet);
        if (!evolution) return false;
        state.pet = evolution.pet;
        return true;
      });
      if (pending === request && evolution) showEvolution(previousForm, evolution.event);
    } catch (error) {
      if (pending === request) {
        retryGrowthAt = Date.now() + 15000;
        status.textContent = saveError(error);
      }
    } finally {
      if (pending === request) {
        pending = undefined;
        render(current);
      }
    }
  }

  function showEvolution(previousForm, event) {
    const form = current?.form;
    status.textContent = FAMILY_NAMES[PET_FORM_DETAILS[form]?.lineage] && FAMILY_NAMES[PET_FORM_DETAILS[previousForm]?.lineage]
      ? `${formName(previousForm)}에서 ${formName(form)} 모습으로 자랐어요. 앞서 함께 지낸 날들은 그대로 이어져요.`
      : event;
    if (!document.hidden && device.isIdle()) showEffect('evolve');
  }

  async function act(action, gameOwner) {
    if (!active || pending) return;
    const request = {};
    pending = request;
    render(current);
    const roll = action === 'adopt' || action === 'newEgg' ? Math.random() : undefined;
    try {
      let result;
      let previousForm;
      await change(state => {
        previousForm = state.pet?.form;
        const now = Date.now();
        const playable = gameOwner && petView(state.pet, now);
        if (gameOwner && (playable?.form !== gameOwner.form || playable?.startedAt !== gameOwner.startedAt)) {
          result = { changed: false, event: '펫 상태가 바뀌어 이번 공놀이를 기록하지 못했어요.' };
          return false;
        }
        result = applyPetAction(state, action, now, roll === undefined ? undefined : () => roll);
        return result.changed;
      });
      if (pending !== request) return;
      if (result.changed && previousForm && current?.form !== previousForm && action !== 'newEgg') {
        showEvolution(previousForm, result.event);
      } else {
        if (result.changed) {
          status.textContent = CARE_STATUS[action] ?? result.event;
          const [habitAction, motion] = FIRE_MOTIONS[current?.form] || [];
          const next = action === 'explore' || action === 'pet'
            ? precursor(current?.form, action === 'pet' ? 'affection' : action) : undefined;
          const reaction = familyReaction(current?.form, action) || (action === 'play'
            ? PLAY_MOTIONS[current?.form] || (motion && 'dash') : action === habitAction ? motion : undefined);
          const cueAfterPlay = action === 'play' && PET_FORM_DETAILS[current?.form]?.stage === 2;
          showEffect(action, next?.reaction || reaction, Boolean(next), cueAfterPlay);
        } else {
          status.textContent = result.event || '펫 상태가 바뀌었어요. 지금 할 수 있는 행동을 골라 주세요.';
        }
      }
    } catch (error) {
      if (pending === request) status.textContent = saveError(error);
    } finally {
      if (pending === request) {
        pending = undefined;
        render(current);
      }
    }
  }

  spriteButton.addEventListener('click', () => {
    if (device.isIdle()) act('pet');
  });
  document.addEventListener('visibilitychange', () => {
    if (active && !document.hidden) render(current);
  });
  setInterval(() => {
    if (!active || document.hidden) return;
    render(current);
    const now = Date.now();
    if (device.isIdle() && habit && !pending && !habitat.dataset.motion && now - lastHabit >= 15000) {
      lastHabit = now;
      showEffect(habit.action, habit.reaction, habit.preview);
    }
  }, 5000);

  function reset() {
    active = false;
    current = pending = undefined;
    scheduleGrowth(undefined, Date.now());
    device.reset();
    status.textContent = '';
    clearEffect();
    collection.reset();
    element('pet-name').textContent = '';
    element('pet-lcd-name').textContent = '';
    element('pet-condition').textContent = '';
    for (const id of ['pet-stage-label', 'pet-path', 'pet-growth-hint']) {
      const label = element(id);
      label.textContent = '';
      label.hidden = true;
    }
    habit = undefined;
    lastHabit = 0;
    retryGrowthAt = 0;
    element('pet-memo-excerpt').textContent = '';
    element('pet-memo-excerpt').hidden = true;
    element('pet-need-symbol').textContent = '';
    element('pet-need-symbol').hidden = true;
    element('pet-poop').hidden = true;
    element('pet-meters').hidden = true;
    for (const [, meter] of meters) {
      meter.removeAttribute('value');
      meter.removeAttribute('aria-valuetext');
      meter.nextElementSibling.textContent = '';
    }
    habitat.classList.remove('pet-night', 'pet-sleeping', 'pet-sick');
    delete habitat.dataset.form;
    delete habitat.dataset.stage;
    sprite.removeAttribute('src');
    sprite.alt = '';
    summarySprite.removeAttribute('src');
    summarySprite.parentElement.classList.remove('pet-night');
  }

  function readMemo(message) {
    status.textContent = message;
    if (device.isIdle()) showEffect('memo');
  }

  return { render, reset, readMemo };
}
