import { PET_FORM_DETAILS } from '../pet.js';

export const FAMILY_NAMES = { fire: '불 강아지', water: '물 고양이', grass: '풀 햄스터' };
const ACTIONS = { play: 'play', explore: 'explore', affection: 'pet' };
const MOVEMENTS = {
  water: { play: 'water-ripple', explore: 'water-glide', affection: 'water-curl' },
  grass: { play: 'grass-hop', explore: 'grass-sniff', affection: 'grass-tuck' }
};
const BABY_HABITS = {
  water: {
    play: '공이 멈추면 꼬리 끝으로 톡 건드려요.',
    explore: '꼬리 끝을 얕은 물에 대고 물결을 따라 걸어요.',
    affection: '물기를 털고 꼬리를 몸에 감은 채 손에 기대요.'
  },
  grass: {
    play: '한쪽 볼에 씨앗을 넣은 채 공 곁을 종종걸음으로 돌아요.',
    explore: '코끝을 움직여 씨앗이 떨어진 자리를 찾아요.',
    affection: '씨앗을 넣어 둔 볼이 위로 가도록 고개를 살짝 돌려요.'
  }
};
const PRECURSORS = {
  'water-runner': {
    play: '공이 물에 닿기 전에 꼬리를 휘둘러 물결을 타고 돌아요.',
    explore: '달리다 멈춰 꼬리 끝으로 잔물결을 짚고 물가를 훑어요.',
    affection: '물결을 가르던 꼬리를 멈추고 손등에 말아 감아요.'
  },
  'water-scout': {
    play: '물 위를 살피다가 구르는 공을 보면 꼬리로 물살을 갈라요.',
    explore: '비친 모습이 흔들릴 때마다 꼬리 끝으로 물결을 짚어요.',
    affection: '앞발을 모아 앉고 길게 뻗었던 꼬리를 손 가까이 접어요.'
  },
  'water-cuddler': {
    play: '곁에 감아 둔 꼬리를 풀고 가볍게 튀어 올라 공을 건드려요.',
    explore: '몸을 감싸던 꼬리 끝부터 펴서 물가에 댑니다.',
    affection: '꼬리를 발끝까지 감고 손길이 닿는 쪽으로 가만히 돌아앉아요.'
  },
  'grass-runner': {
    play: '씨앗이 든 볼을 공에서 멀리 돌리고 짧게 두 번 뛰어요.',
    explore: '뛰다 멈추더니 비어 있는 볼 쪽을 돌려 흙냄새를 맡아요.',
    affection: '씨앗이 든 볼은 높이 둔 채 두 앞발을 손에 올려요.'
  },
  'grass-scout': {
    play: '냄새를 맡던 고개를 들고 씨앗을 넣은 볼을 감싸며 공을 쫓아요.',
    explore: '작은 씨앗을 찾고는 고개를 기울여 한쪽 볼에 넣어요.',
    affection: '찾아낸 씨앗을 볼에 넣고 빈 쪽 뺨을 손에 기대요.'
  },
  'grass-cuddler': {
    play: '손에 기대던 몸을 일으키고 씨앗을 챙긴 채 공 곁으로 뛰어요.',
    explore: '편하게 앉아 있다가 씨앗 냄새가 나면 코부터 내밀어요.',
    affection: '씨앗을 넣어 둔 쪽 볼을 한쪽 앞발로 받치고 몸을 둥글게 말아요.'
  }
};
export function familyPrecursor(form, habit) {
  const description = PRECURSORS[form]?.[habit];
  if (!description) return;
  return {
    action: ACTIONS[habit], reaction: MOVEMENTS[PET_FORM_DETAILS[form].lineage][habit],
    description, preview: true
  };
}

export function familyHabit(pet, leading) {
  const details = PET_FORM_DETAILS[pet.form];
  const habit = details.stage === 1 ? leading : details.habit;
  const reaction = MOVEMENTS[details.lineage]?.[habit];
  if (!reaction) return;
  return {
    action: ACTIONS[habit], reaction,
    description: details.stage === 1 ? BABY_HABITS[details.lineage][habit] : details.description
  };
}

export function familyReaction(form, action) {
  const details = PET_FORM_DETAILS[form];
  const habit = action === 'play' ? details?.habit || 'play' : action === 'pet' ? 'affection' : action;
  return MOVEMENTS[details?.lineage]?.[habit];
}
