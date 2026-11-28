import { PET_FORM_DETAILS } from '../pet.js';

export const FAMILY_NAMES = { fire: '불 강아지', water: '물 고양이', grass: '풀 햄스터' };
const ACTIONS = { play: 'play', explore: 'explore', affection: 'pet' };
const MOVEMENTS = {
  water: { play: 'water-ripple', explore: 'water-glide', affection: 'water-curl' },
  grass: { play: 'grass-hop', explore: 'grass-sniff', affection: 'grass-tuck' }
};
export function familyPrecursor(form, habit) {
  const details = PET_FORM_DETAILS[form];
  const reaction = MOVEMENTS[details?.lineage]?.[habit];
  if (details?.stage === 2 && reaction) return { action: ACTIONS[habit], reaction, preview: true };
}

export function familyHabit(pet, leading) {
  const details = PET_FORM_DETAILS[pet.form];
  const habit = details.stage === 1 ? leading : details.habit;
  const reaction = MOVEMENTS[details.lineage]?.[habit];
  if (!reaction) return;
  return { action: ACTIONS[habit], reaction };
}

export function familyReaction(form, action) {
  const details = PET_FORM_DETAILS[form];
  const habit = action === 'play' ? details?.habit || 'play' : action === 'pet' ? 'affection' : action;
  return MOVEMENTS[details?.lineage]?.[habit];
}
