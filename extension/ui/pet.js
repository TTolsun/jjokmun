import { petView, applyPetAction, petEvolution, dominantPetHabit, PET_FORM_DETAILS } from '../pet.js';
import { element } from './dom.js';
import { bindPetCollection, familyPath, STAGE_NAMES } from './pet-collection.js';
import { bindPetDevice } from './pet-device.js';
import { FAMILY_NAMES, familyHabit, familyPrecursor, familyReaction } from './pet-family-motion.js';

const METERS = ['hunger', 'happiness', 'energy', 'health', 'growth'];
const MAX_TIMEOUT_DELAY = 2_147_483_647;
const EFFECTS = { feed: '♪', snack: '♪', play: '✦', explore: '✧', clean: '✧', sleep: 'z z', wake: '☀', heal: '✚', pet: '♥', memo: '♥' };
const BABY_POSES = { feed: 'feed', snack: 'feed', play: 'play', explore: 'explore', pet: 'pet', memo: 'pet' };
const HABITS = {
  play: { action: 'play', description: '공을 발앞에 밀어 두고 같이 뛰놀기를 기다려요.' },
  explore: { action: 'explore', description: '잎사귀 뒤에 뭐가 있는지 고개를 빼꼼 내밀어요.' },
  affection: { action: 'pet', description: '곁으로 다가와 머리를 살짝 기대요.' }
};
const FIRE_PUP_HABITS = {
  play: { action: 'play', reaction: 'pup-tap', description: '공이 구르면 냅다 뛰다가 코앞에서 딱 멈춰요.' },
  explore: { action: 'explore', reaction: 'sniff', description: '아래로 처진 귀를 풀잎에 대고 낯선 냄새를 맡아요.' },
  affection: { action: 'pet', reaction: 'nestle', description: '손에 머리를 기대면 가슴의 불씨 무늬가 반짝여요.' }
};
const ACTIVE_HABITS = {
  play: '이번 성장기에는 공놀이를 가장 자주 했어요.',
  explore: '이번 성장기에는 정원을 가장 자주 탐색했어요.',
  affection: '이번 성장기에는 쓰다듬으며 가장 자주 교감했어요.'
};
const FIRE_MOTIONS = {
  'fire-runner': ['play', 'look-back', '앞발부터 내딛고서야 뒤를 힐끗 봐요.'],
  'fire-scout': ['explore', 'nose-first', '코부터 흙에 대요. 긴 귀는 한 박자 늦게 따라 내려와요.'],
  'fire-cuddler': ['pet', 'nestle', '갈기 아래에서 앞발 하나만 내밀고 곁에 앉아요.'],
  'fire-runner-runner': ['play', 'dash', '꼬리 끝이 두 갈래로 펼쳐지고 발밑 불씨가 튀어요.'],
  'fire-runner-scout': ['explore', 'beacon', '긴 다리로 서서 꼬리 끝 불빛을 위로 들어 길을 살펴요.'],
  'fire-runner-cuddler': ['pet', 'nestle', '긴 목에 불갈기를 둘러 감고 곁으로 와요.'],
  'fire-scout-runner': ['play', 'flutter', '양쪽 귀를 활짝 펴고 앞발부터 통통 뛰어요.'],
  'fire-scout-scout': ['explore', 'sniff', '귀 끝을 소용돌이처럼 말고 땅 가까이에서 냄새를 따라가요.'],
  'fire-scout-cuddler': ['pet', 'nestle', '넓은 귀를 앞쪽으로 늘어뜨려 두 앞발을 감싸요.'],
  'fire-cuddler-runner': ['play', 'flutter', '해처럼 뻗은 갈기가 쿵쿵 뛸 때마다 들썩여요.'],
  'fire-cuddler-scout': ['explore', 'beacon', '이마 위에 솟은 털불이 고개보다 먼저 길을 비춰요.'],
  'fire-cuddler-cuddler': ['pet', 'nestle', '둥글게 퍼진 갈기 속에 앞발을 파묻어요.']
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
    play: ['dash', '공을 앞지르려 길게 내딛자 꼬리의 불꽃이 두 갈래로 일렁여요.'],
    explore: ['beacon', '달리다 멈춰 꼬리 끝 불을 높이고, 공이 지나간 쪽의 풀숲을 살펴요.'],
    affection: ['nestle', '긴 목을 손에 기대자 갈기의 불빛이 목둘레를 따라 번져요.']
  },
  'fire-scout': {
    play: ['flutter', '냄새를 맡다가 공 소리에 긴 귀를 양옆으로 펴고 앞발부터 뛰어들어요.'],
    explore: ['sniff', '긴 귀 끝이 살짝 말려요. 코와 귀를 바닥 가까이 대고 냄새를 쫓아요.'],
    affection: ['nestle', '머리를 숙여 손에 기대며 두 귀를 앞쪽으로 늘어뜨려요.']
  },
  'fire-cuddler': {
    play: ['flutter', '공을 보고 벌떡 뛰자 부드럽던 갈기가 햇살처럼 여러 방향으로 뻗어요.'],
    explore: ['beacon', '그늘을 들여다볼 때 이마 위 갈기가 불꽃처럼 솟아 먼저 안쪽을 비춰요.'],
    affection: ['nestle', '곁에 앉아 앞발을 포개자 갈기가 둥글게 퍼져 발을 덮어요.']
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
  if (next) return { action: HABIT_ACTIONS[habit], reaction: next[0], description: next[1], preview: true };
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
      const [action, reaction, description] = fire;
      return { action, reaction, description };
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
    const hint = element('pet-habit');
    hint.textContent = habit && (habit.preview || motion === habit.action) ? habit.description : '';
    hint.hidden = !hint.textContent;
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
        status.textContent = result.event || '펫 상태가 바뀌었어요. 지금 할 수 있는 행동을 골라 주세요.';
        if (result.changed) {
          const [habitAction, motion, description] = FIRE_MOTIONS[current?.form] || [];
          const next = action === 'explore' || action === 'pet'
            ? precursor(current?.form, action === 'pet' ? 'affection' : action) : undefined;
          const reaction = familyReaction(current?.form, action) || (action === 'play'
            ? PLAY_MOTIONS[current?.form] || (motion && 'dash') : action === habitAction ? motion : undefined);
          if (next) {
            status.textContent += ' ' + next.description;
          } else if ((action === 'explore' || action === 'pet') && action === habitAction) {
            status.textContent += ' ' + description;
          }
          const cueAfterPlay = action === 'play' && PET_FORM_DETAILS[current?.form]?.stage === 2;
          showEffect(action, next?.reaction || reaction, Boolean(next), cueAfterPlay);
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
    element('pet-habit').textContent = '';
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
