import { PET_FORM_DETAILS } from '../pet.js';
import { element } from './dom.js';
import { FAMILY_NAMES } from './pet-family-motion.js';

const GROUP_NAMES = { egg: '알', ...FAMILY_NAMES, legacy: '예전 정원' };
export const STAGE_NAMES = ['알', '아기', '첫 번째 진화', '두 번째 진화'];
const forms = Object.keys(PET_FORM_DETAILS);

function groupOf(form) {
  return PET_FORM_DETAILS[form]?.lineage || 'egg';
}

export function familyPath(form, discovered) {
  const path = [];
  for (let key = form; FAMILY_NAMES[groupOf(key)]; key = PET_FORM_DETAILS[key].parent) {
    path.unshift(!discovered || discovered.includes(key) ? PET_FORM_DETAILS[key].name : '미발견');
  }
  return path.join(' → ');
}

function node(tag, className, text) {
  const item = document.createElement(tag);
  item.className = className;
  item.textContent = text;
  return item;
}

function entry(form, current, discovered) {
  const details = PET_FORM_DETAILS[form];
  const card = document.createElement('li');
  card.dataset.discoveredForm = form;
  const portrait = document.createElement('img');
  portrait.src = `art/${form}.png`;
  portrait.alt = '';
  const copy = document.createElement('div');
  const title = node('h4', 'collection-name', details.name);
  if (form === current) title.append(node('span', 'collection-current', '돌보는 중'));
  copy.append(title);
  if (details.stage > 1 && FAMILY_NAMES[details.lineage]) {
    copy.append(node('p', 'collection-path', familyPath(form, discovered)));
  }
  copy.append(node('p', 'collection-description', details.description));
  card.append(portrait, copy);
  return card;
}

export function bindPetCollection() {
  const guide = element('pet-collection-guide');
  const filters = element('pet-collection-families');
  const book = element('pet-collection');
  const progress = element('pet-discovery-progress');
  let discovered = [];
  let current;
  let selected;
  let lastKey;

  function renderGroup() {
    for (const button of filters.children) {
      button.setAttribute('aria-pressed', String(button.dataset.group === selected));
    }
    book.replaceChildren();
    if (!discovered.length) {
      book.append(node('p', 'collection-empty', '정원에서 알을 데려오면 첫 모습이 도감에 기록돼요.'));
      return;
    }
    const family = forms.filter(form => groupOf(form) === selected);
    for (const [stage, label] of STAGE_NAMES.entries()) {
      const members = family.filter(form => PET_FORM_DETAILS[form].stage === stage);
      if (!members.length) continue;
      const seen = members.filter(form => discovered.includes(form));
      const section = document.createElement('section');
      const heading = node('h3', 'collection-stage', selected === 'legacy' && stage === 3 ? '마지막 성장' : label);
      heading.append(node('span', 'collection-stage-count', `${seen.length} / ${members.length} 발견`));
      section.append(heading);
      if (seen.length) {
        const list = document.createElement('ul');
        list.append(...seen.map(form => entry(form, current, discovered)));
        section.append(list);
      } else {
        section.append(node('p', 'collection-unseen', '아직 만나지 못한 모습이에요.'));
      }
      book.append(section);
    }
    if (selected === 'egg' && discovered.length === 1) {
      book.append(node('p', 'collection-tip', '알이 부화하면 아기 펫의 계열이 도감에 나타나요.'));
    }
  }

  for (const [key, name] of Object.entries(GROUP_NAMES)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = name;
    button.dataset.group = key;
    button.addEventListener('click', () => {
      selected = key;
      renderGroup();
      book.scrollTop = 0;
    });
    filters.append(button);
  }

  guide.addEventListener('toggle', () => {
    if (!guide.open) return;
    selected = groupOf(current);
    renderGroup();
    book.scrollTop = 0;
  });
  guide.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !guide.open) return;
    event.preventDefault();
    guide.open = false;
    element('pet-collection-open').focus();
  });

  function update(nextDiscovered, activeForm) {
    const key = [activeForm, ...nextDiscovered].join('|');
    if (key === lastKey) return;
    lastKey = key;
    const followingCurrent = selected === groupOf(current);
    current = activeForm;
    discovered = nextDiscovered;
    const groups = new Set(discovered.map(groupOf));
    const total = forms.filter(form => groupOf(form) !== 'legacy' || groups.has('legacy')).length;
    const count = `${discovered.length} / ${total} 발견`;
    element('pet-collection-count').textContent = count;
    element('pet-discovery-total').textContent = `전체 ${total}종 중 ${discovered.length}종 발견`;
    progress.max = total;
    progress.value = discovered.length;
    filters.hidden = groups.size < 2;
    for (const button of filters.children) button.hidden = !groups.has(button.dataset.group);
    if (guide.open) {
      if (followingCurrent || !groups.has(selected)) selected = groupOf(current);
      renderGroup();
    }
  }

  function reset() {
    guide.open = false;
    lastKey = current = selected = undefined;
    discovered = [];
    book.replaceChildren();
    filters.hidden = true;
    for (const button of filters.children) {
      button.hidden = true;
      button.removeAttribute('aria-pressed');
    }
    element('pet-collection-count').textContent = '';
    element('pet-discovery-total').textContent = '';
    progress.removeAttribute('value');
    progress.removeAttribute('max');
  }

  return { update, reset };
}
