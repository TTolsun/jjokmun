import { WATER_FORMS, GRASS_FORMS } from './pet-family-forms.js';

export const PET_FORM_DETAILS = {
  egg: { name: '알', stage: 0, description: '정원에 처음 데려온 알이에요.' },
  baby: { name: '새싹이', lineage: 'legacy', stage: 1, parent: 'egg', description: '따뜻하게 쓰다듬어 준 알에서 깨어났어요.' },
  runner: {
    name: '콩콩이', lineage: 'legacy', stage: 3, parent: 'baby', habit: 'play',
    description: '아기 때 공놀이를 즐겼어요. 뛰어노는 걸 좋아해요.'
  },
  scout: {
    name: '나들이', lineage: 'legacy', stage: 3, parent: 'baby', habit: 'explore',
    description: '아기 때 정원을 자주 탐색했어요. 낯선 곳이 궁금해요.'
  },
  cuddler: {
    name: '포근이', lineage: 'legacy', stage: 3, parent: 'baby', habit: 'affection',
    description: '아기 때 쓰다듬는 손길을 좋아했어요. 지금도 곁에 기대기를 좋아해요.'
  },
  'fire-pup': {
    name: '불뭉이', lineage: 'fire', stage: 1, parent: 'egg',
    description: '공을 보면 냅다 달려가지만, 가까이 가면 사뭇 조심스러워져요.',
    ballReaction: '불뭉이가 냅다 뛰어가더니 공 코앞에서 멈췄어요. 잠깐 보다가 한쪽 앞발로 콕 건드렸어요.'
  },
  'fire-runner': {
    name: '불달이', lineage: 'fire', stage: 2, parent: 'fire-pup', habit: 'play',
    description: '기다릴 때도 앞발 하나가 슬쩍 앞서요. 몇 걸음 뛰고 나서야 뒤를 돌아봐요.',
    ballReaction: '불달이가 공을 따라 발부터 내달렸어요. 몇 걸음 가서야 같이 오나 뒤를 봤어요.'
  },
  'fire-runner-runner': {
    name: '쌍불꼬리', lineage: 'fire', stage: 3, parent: 'fire-runner', habit: 'play',
    description: '달릴 때 꼬리 끝의 두 갈래 불꽃이 활짝 펼쳐져요.',
    ballReaction: '쌍불꼬리가 두 갈래 불꽃을 펼치며 굴러가는 공을 앞질렀어요.'
  },
  'fire-runner-scout': {
    name: '봉홧불이', lineage: 'fire', stage: 3, parent: 'fire-runner', habit: 'explore',
    description: '꼬리 끝의 불을 높이 들어 길을 살펴요.',
    ballReaction: '봉홧불이가 멈춰 서서 꼬리 끝을 높이 들고 공이 굴러간 쪽을 살폈어요.'
  },
  'fire-runner-cuddler': {
    name: '볕목도리', lineage: 'fire', stage: 3, parent: 'fire-runner', habit: 'affection',
    description: '긴 목을 따뜻한 불갈기가 감싸고 있어요.',
    ballReaction: '볕목도리가 따뜻한 목깃에 공을 안고 돌아왔어요.'
  },
  'fire-scout': {
    name: '잿코', lineage: 'fire', stage: 2, parent: 'fire-pup', habit: 'explore',
    description: '긴 귀가 내려오기 전에 코부터 흙에 대요. 냄새가 남아 있으면 한참 들여다봐요.',
    ballReaction: '잿코가 코부터 흙에 대고 공이 지나간 자리를 킁킁 맡았어요. 긴 귀가 뒤늦게 바닥에 닿았어요.'
  },
  'fire-scout-runner': {
    name: '펄럭귀', lineage: 'fire', stage: 3, parent: 'fire-scout', habit: 'play',
    description: '달릴 때 귀를 양옆으로 펼치고 앞발부터 뛰어들어요.',
    ballReaction: '펄럭귀가 귀를 활짝 펴고 앞발로 튀어 오른 공을 잡았어요.'
  },
  'fire-scout-scout': {
    name: '소용귀', lineage: 'fire', stage: 3, parent: 'fire-scout', habit: 'explore',
    description: '말린 귀 끝을 땅 가까이 대고 냄새를 쫓아요.',
    ballReaction: '소용귀가 귀 끝을 바닥에 대고 공이 멈춘 곳까지 찾아갔어요.'
  },
  'fire-scout-cuddler': {
    name: '품귀', lineage: 'fire', stage: 3, parent: 'fire-scout', habit: 'affection',
    description: '넓은 두 귀를 앞으로 늘어뜨려 품처럼 둘러요.',
    ballReaction: '품귀가 굴러온 공을 넓은 두 귀 사이에 살며시 품었어요.'
  },
  'fire-cuddler': {
    name: '온갈기', lineage: 'fire', stage: 2, parent: 'fire-pup', habit: 'affection',
    description: '공이 가까이 오면 갈기 아래에서 앞발 하나만 살짝 내밀어요.',
    ballReaction: '온갈기가 공을 내 쪽으로 살짝 밀었어요. 돌아온 공에 앞발 끝만 가만히 얹었어요.'
  },
  'fire-cuddler-runner': {
    name: '해갈기', lineage: 'fire', stage: 3, parent: 'fire-cuddler', habit: 'play',
    description: '뛸 때마다 햇살처럼 뻗은 갈기가 들썩여요.',
    ballReaction: '해갈기가 햇살 같은 갈기를 들썩이며 공 너머로 뛰어올랐어요.'
  },
  'fire-cuddler-scout': {
    name: '횃불마루', lineage: 'fire', stage: 3, parent: 'fire-cuddler', habit: 'explore',
    description: '이마 위로 솟은 불꽃이 앞길을 밝혀요.',
    ballReaction: '횃불마루가 이마의 불을 앞세워 그늘 아래 공을 비췄어요.'
  },
  'fire-cuddler-cuddler': {
    name: '아랫목', lineage: 'fire', stage: 3, parent: 'fire-cuddler', habit: 'affection',
    description: '둥글게 퍼진 갈기 속에 앞발을 포개요.',
    ballReaction: '아랫목이 둥근 갈기 사이로 앞발을 내밀어 공을 이쪽으로 살살 밀어 줬어요.'
  },
  ...WATER_FORMS,
  ...GRASS_FORMS
};
export const PET_FORMS = Object.keys(PET_FORM_DETAILS);
export const PET_FAMILIES = { fire: 'fire-pup', water: 'water-kitten', grass: 'grass-hamster' };
export const PET_TICK_MS = 20 * 60_000;

const HATCH_TIME = 2 * 60_000;
const FAMILY_KEYS = Object.keys(PET_FAMILIES);
const LEGACY_GROWTH = { duration: 8 * 60_000, minAge: 0 };
const GROWTH_RULES = [null, { duration: 8 * 60_000, minAge: 15_000 }, { duration: 12 * 60_000, minAge: 45_000 }];
const BRANCHES = { play: 'runner', explore: 'scout', affection: 'cuddler' };
const CARE_ACTIONS = ['feed', 'snack', 'play', 'explore', 'clean', 'sleep', 'heal', 'pet'];
const scores = ['affection', 'play', 'explore'];
const clamp = (value) => Math.min(100, Math.max(0, value));
const validTime = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000;
const range = (value, max) => Number.isInteger(value) && value >= 0 && value <= max;

function isNight(now) {
  const hour = new Date(now).getHours();
  return hour < 6 || hour >= 20;
}

function sleepEnd(now) {
  if (!isNight(now)) return now + 3 * PET_TICK_MS;
  const morning = new Date(now);
  if (morning.getHours() >= 20) morning.setDate(morning.getDate() + 1);
  morning.setHours(6, 0, 0, 0);
  return morning.getTime();
}

function growthRules(form) {
  return form === 'baby' ? LEGACY_GROWTH : GROWTH_RULES[PET_FORM_DETAILS[form].stage];
}

function newEgg(now, lineage, discovered = ['egg']) {
  return {
    form: 'egg', lineage, startedAt: now, tickAt: now, hunger: 0, happiness: 70, energy: 90,
    health: 100, poop: 0, sleepStartedAt: 0, sleepTickAt: 0, sleepUntil: 0,
    care: 0, play: 0, explore: 0, affection: 0,
    digestion: 0, memoVisits: 0, discovered: [...discovered]
  };
}

function drawLineage(random) {
  return FAMILY_KEYS[Math.floor(random() * FAMILY_KEYS.length)];
}

export function validatePet(value) {
  const fields = ['hunger', 'happiness', 'energy', 'health'];
  const counts = ['care', ...scores];
  if (!value || !PET_FORMS.includes(value.form)
      || (value.lineage !== undefined && value.lineage !== 'legacy' && !FAMILY_KEYS.includes(value.lineage))
      || (value.form !== 'egg' && PET_FORM_DETAILS[value.form].lineage !== (value.lineage ?? 'legacy'))
      || !validTime(value.startedAt) || !validTime(value.tickAt)
      || !fields.every(key => range(value[key], 100))
      || !counts.every(key => range(value[key], 100))
      || !range(value.poop, 3) || !range(value.digestion, 1) || !range(value.memoVisits, 2)
      || !validTime(value.sleepStartedAt) || !validTime(value.sleepTickAt) || !validTime(value.sleepUntil)
      || value.sleepStartedAt > value.sleepTickAt || value.sleepTickAt > value.sleepUntil
      || !Array.isArray(value.discovered) || value.discovered.length > PET_FORMS.length
      || !value.discovered.every(form => PET_FORMS.includes(form))
      || new Set(value.discovered).size !== value.discovered.length
      || !value.discovered.includes(value.form) || !value.discovered.includes('egg')) {
    throw new Error('펫의 돌봄 기록이 올바르지 않습니다.');
  }
  const clean = newEgg(value.startedAt, value.lineage, value.discovered);
  for (const key of Object.keys(clean)) {
    if (key !== 'discovered') clean[key] = value[key];
  }
  if (value.lineage === undefined) delete clean.lineage;
  return clean;
}

function advance(pet, now) {
  const elapsed = Math.floor((now - pet.tickAt) / PET_TICK_MS);
  if (pet.form === 'egg') return;
  const rest = Math.floor((Math.min(now, pet.sleepUntil) - pet.sleepTickAt) / PET_TICK_MS);
  if (rest > 0) {
    pet.energy = clamp(pet.energy + rest * 24);
    pet.sleepTickAt += rest * PET_TICK_MS;
  }
  if (elapsed <= 0) return;
  pet.tickAt += elapsed * PET_TICK_MS;
  // After a long absence, keep the pet recoverable and bound the catch-up work.
  for (let index = Math.min(elapsed, 72) - 1; index >= 0; index -= 1) {
    const tick = pet.tickAt - index * PET_TICK_MS;
    const asleep = tick > pet.sleepStartedAt && tick <= pet.sleepUntil;
    pet.hunger = clamp(pet.hunger + (asleep ? 1 : 8));
    if (!asleep) pet.energy = clamp(pet.energy - (isNight(tick) ? 9 : 5));
    pet.happiness = clamp(pet.happiness - (asleep ? 1 : 4));
    if (pet.digestion > 0 && --pet.digestion === 0) pet.poop = Math.min(3, pet.poop + 1);
    if (pet.hunger >= (asleep ? 90 : 75) || pet.poop >= 2) pet.health = Math.max(15, pet.health - 5);
    else if (asleep && pet.hunger <= 55) pet.health = clamp(pet.health + 2);
  }
}

function hasHabits(pet) {
  return pet.play + pet.explore + pet.affection >= 6;
}

export function dominantPetHabit(pet) {
  const strongest = scores.reduce((best, key) => pet[key] > pet[best] ? key : best);
  return pet[strongest] > 0 ? strongest : undefined;
}

function growthProgress(pet, now) {
  const elapsed = Math.max(0, now - pet.startedAt);
  if (pet.form === 'egg') return Math.min(1, Math.max(pet.care / 3, Math.min(pet.care, 1) * elapsed / HATCH_TIME));
  const rules = growthRules(pet.form);
  if (!rules) return 1;
  const progress = Math.max(pet.care / 10, Math.min(pet.care / 5, 1) * elapsed / rules.duration);
  const limit = !hasHabits(pet) ? 0.9 : elapsed < rules.minAge ? 0.99 : 1;
  return Math.min(limit, progress);
}

function startGrowthStage(pet) {
  pet.care = 0;
  for (const key of scores) pet[key] = 0;
}

function mature(pet, now) {
  if (growthProgress(pet, now) < 1) return null;
  const previous = pet.form;
  let event;
  if (previous === 'egg') {
    pet.form = PET_FAMILIES[pet.lineage] ?? 'baby';
    pet.hunger = 32;
    pet.energy = 80;
    startGrowthStage(pet);
    pet.tickAt = Math.max(pet.tickAt, now);
    event = '알에서 아기 펫이 태어났어요!';
  } else if (growthRules(previous)) {
    const branch = BRANCHES[dominantPetHabit(pet)];
    if (previous === 'baby') pet.form = branch;
    else {
      const prefix = PET_FORM_DETAILS[previous].stage === 1 ? pet.lineage : previous;
      pet.form = prefix + '-' + branch;
    }
    if (PET_FORM_DETAILS[pet.form].stage === 2) {
      startGrowthStage(pet);
      pet.energy = Math.max(pet.energy, 80);
    }
    event = PET_FORM_DETAILS[pet.form].name + '의 모습으로 성장했어요!';
  } else {
    return null;
  }
  pet.startedAt = Math.max(pet.startedAt, now);
  if (!pet.discovered.includes(pet.form)) pet.discovered.push(pet.form);
  return event;
}

function timedGrowth(pet) {
  if (pet.form === 'egg') return pet.care > 0 ? pet.startedAt + HATCH_TIME : Infinity;
  const rules = growthRules(pet.form);
  if (!rules || !hasHabits(pet)) return Infinity;
  const delay = pet.care >= 10 ? 0 : Math.ceil(rules.duration / Math.min(pet.care / 5, 1));
  return pet.startedAt + Math.max(rules.minAge, delay);
}

function settle(pet, now) {
  const timedTransition = timedGrowth(pet);
  let event = null;
  if (timedTransition <= now) {
    advance(pet, timedTransition);
    event = mature(pet, timedTransition);
  }
  advance(pet, now);
  return event;
}

export function petEvolution(pet, now = Date.now()) {
  if (!pet || timedGrowth(pet) > now) return null;
  const next = { ...pet, discovered: [...pet.discovered] };
  const event = settle(next, now);
  return event ? { pet: next, event } : null;
}

function actionList(pet, now) {
  if (pet.form === 'egg') return ['pet'];
  if (pet.sleepUntil > now) return ['wake'];
  const ready = {
    feed: pet.hunger >= 20,
    snack: pet.hunger >= 8 && pet.happiness < 100,
    play: pet.energy >= 18,
    explore: pet.energy >= 10,
    sleep: pet.energy < 100 || isNight(now),
    clean: pet.poop > 0,
    heal: pet.health < 100,
    pet: true
  };
  const actions = CARE_ACTIONS.filter(action => ready[action]);
  actions.push('memo');
  if (PET_FORM_DETAILS[pet.form].stage === 3) actions.push('newEgg');
  return actions;
}

export function petView(pet, now = Date.now()) {
  if (!pet) return null;
  const next = { ...pet, discovered: [...pet.discovered] };
  settle(next, now);
  const needs = [];
  if (next.hunger >= 55) needs.push('feed');
  if (next.happiness <= 30) needs.push('play');
  if (next.poop) needs.push('clean');
  if (next.energy <= 30) needs.push('sleep');
  if (next.health < 85) needs.push('heal');
  return {
    ...next, stage: PET_FORM_DETAILS[next.form].stage,
    lineage: next.form === 'egg' ? undefined : next.lineage ?? 'legacy',
    habitReady: Boolean(growthRules(next.form)) && hasHabits(next),
    sleeping: next.sleepUntil > now, night: isNight(now),
    growth: Math.floor(growthProgress(next, now) * 100), needs, available: actionList(next, now)
  };
}

export function applyPetAction(state, action, now = Date.now(), random = Math.random) {
  if (!state.pet) {
    if (action !== 'adopt') return { changed: false, event: '' };
    state.pet = newEgg(now, drawLineage(random));
    return { changed: true, event: '따뜻한 알을 데려왔어요.' };
  }
  const pet = { ...state.pet, discovered: [...state.pet.discovered] };
  const evolution = settle(pet, now);
  if (!actionList(pet, now).includes(action)) {
    if (evolution) state.pet = pet;
    return { changed: Boolean(evolution), event: evolution || '' };
  }
  if (action === 'memo' && pet.memoVisits === 2) {
    if (evolution) state.pet = pet;
    return { changed: Boolean(evolution), event: evolution || '펫이 글을 읽는 동안 곁에 앉았어요.' };
  }
  let event;
  if (action === 'newEgg') {
    state.pet = newEgg(now, drawLineage(random), pet.discovered);
    return { changed: true, event: '새 알을 데려왔어요. 만난 펫은 도감에 남아요.' };
  }
  switch (action) {
    case 'feed':
      pet.hunger = clamp(pet.hunger - 32);
      if (pet.digestion > 0) pet.poop = Math.min(3, pet.poop + 1);
      pet.digestion = 1;
      event = pet.hunger >= 40 ? '펫이 밥그릇을 싹 비웠어요. 아직 배가 고파 보여요.' : '펫이 밥을 다 먹고 입가를 핥았어요.';
      break;
    case 'snack':
      pet.hunger = clamp(pet.hunger - 8);
      pet.happiness = clamp(pet.happiness + 12);
      event = '펫이 간식을 한입씩 오물오물 씹었어요.';
      break;
    case 'play':
      pet.energy = clamp(pet.energy - 18);
      pet.hunger = clamp(pet.hunger + 8);
      pet.happiness = clamp(pet.happiness + 22);
      pet.play += 2;
      event = PET_FORM_DETAILS[pet.form].ballReaction
        ?? (pet.energy < 18 ? '펫이 공을 물고 돌아오더니 바닥에 털썩 앉았어요.' : '펫이 통통 튀는 공을 쫓아갔어요!');
      break;
    case 'explore':
      pet.energy = clamp(pet.energy - 10);
      pet.happiness = clamp(pet.happiness + 12);
      pet.explore += 2;
      event = PET_FORM_DETAILS[pet.form].exploreReaction
        ?? (pet.explore % 4 === 0 ? '펫이 바스락거리는 잎을 한 장 뒤집었어요.' : '펫이 바닥을 킁킁거리다가 씨앗 하나를 찾았어요.');
      break;
    case 'clean':
      pet.poop = 0;
      event = '방을 말끔히 치웠어요.';
      break;
    case 'sleep':
      pet.sleepStartedAt = now;
      pet.sleepTickAt = now;
      pet.sleepUntil = sleepEnd(now);
      event = isNight(now) ? '펫이 몸을 동그랗게 말고 아침까지 잠들었어요.' : '펫이 눈을 감고 낮잠을 자기 시작했어요.';
      break;
    case 'wake':
      pet.sleepUntil = Math.max(pet.sleepTickAt, now);
      event = pet.energy <= 30 ? '펫이 눈을 비볐어요. 여전히 졸려 보여요.' : '펫이 눈을 뜨고 기지개를 켰어요.';
      break;
    case 'heal':
      pet.health = clamp(pet.health + 35);
      event = '펫이 한결 편안해졌어요.';
      break;
    case 'pet':
      pet.happiness = clamp(pet.happiness + 7);
      pet.affection += 2;
      event = PET_FORM_DETAILS[pet.form].petReaction
        ?? (pet.form === 'egg' ? '알이 손길에 살짝 흔들렸어요.' : '펫이 손길에 눈을 감았어요.');
      break;
    case 'memo':
      pet.happiness = clamp(pet.happiness + 5);
      pet.memoVisits += 1;
      event = '펫이 글을 읽는 동안 곁에 앉았어요.';
      break;
  }
  if (pet.form === 'egg' || growthRules(pet.form)) {
    if (action !== 'wake' && action !== 'sleep' && action !== 'memo') pet.care = clamp(pet.care + 1);
  }
  for (const key of scores) pet[key] = clamp(pet[key]);
  state.pet = pet;
  return { changed: true, event: mature(pet, now) || evolution || event };
}
