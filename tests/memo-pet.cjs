const assert = require('node:assert/strict');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {extension} = require('./browser.cjs');

const load = file => import(pathToFileURL(path.join(extension, file)).href);
const at = (date, hour = 10) => Date.parse(`${date}T${String(hour).padStart(2, '0')}:00:00+09:00`);

function hatchedPet(now) {
  return {
    form: 'water-kitten', lineage: 'water', growthSeed: 7, startedAt: now, tickAt: now,
    hunger: 70, happiness: 40, energy: 80, health: 100, poop: 0,
    sleepStartedAt: 0, sleepTickAt: 0, sleepUntil: 0,
    care: 0, play: 3, explore: 1, affection: 5, digestion: 0, memoVisits: 0,
    discovered: ['egg', 'water-kitten']
  };
}

// Memo care applies once per kind and local date, ignores eggs, and never moves growth habits.
async function checkMemoCareRules() {
  const {applyMemoCare, applyPetAction, petHatched, petSubject, validatePet, PET_FORM_DETAILS} = await load('pet.js');
  const day = '2031-05-10';
  const now = at(day);
  const egg = {};
  applyPetAction(egg, 'adopt', now, () => 0.4);
  const untouched = structuredClone(egg.pet);
  assert.equal(applyMemoCare(egg, 'write', day, now + 1000), '');
  assert.deepEqual(egg.pet, untouched);
  assert.equal(petHatched(egg.pet, now), false);
  assert.equal(petHatched(egg.pet, now + 2 * 60_000), true);
  assert.equal(petHatched(undefined), false);

  const state = {pet: hatchedPet(now)};
  const name = petSubject(PET_FORM_DETAILS['water-kitten'].name);
  const habits = ({play, explore, affection}) => ({play, explore, affection});
  assert.equal(applyMemoCare(state, 'write', day, now), name + ' 새 쪽지를 받아 들고 배가 든든해졌어요.');
  assert.deepEqual([state.pet.hunger, state.pet.happiness, state.pet.wroteOn], [30, 48, day]);
  assert.equal(applyMemoCare(state, 'write', day, now + 1), '');
  assert.equal(state.pet.hunger, 30);
  assert.match(applyMemoCare(state, 'found', day, now + 2), /찾아온 쪽지에 답장이 붙자 신이 났어요/);
  assert.deepEqual([state.pet.hunger, state.pet.happiness, state.pet.foundOn], [15, 73, day]);
  assert.match(applyMemoCare(state, 'revisit', day, now + 3), /함께 들여다봤어요/);
  assert.deepEqual([state.pet.happiness, state.pet.repliedOn], [85, day]);
  for (const kind of ['found', 'revisit', 'write', 'unknown']) assert.equal(applyMemoCare(state, kind, day, now + 4), '');
  assert.deepEqual(habits(state.pet), {play: 3, explore: 1, affection: 5});
  const asleep = {pet: {...hatchedPet(now), sleepStartedAt: now, sleepTickAt: now, sleepUntil: now + 60 * 60_000}};
  assert.match(applyMemoCare(asleep, 'write', day, now + 1), /잠든 사이 머리맡에 새 쪽지를 두었어요/);
  assert.match(applyMemoCare(state, 'write', '2031-05-11', at('2031-05-11')), /새 쪽지를 받아 들고/);
  assert.equal(state.pet.wroteOn, '2031-05-11');

  const restored = validatePet(structuredClone(state.pet));
  assert.deepEqual([restored.wroteOn, restored.foundOn, restored.repliedOn], ['2031-05-11', day, day]);
  assert.equal('wroteOn' in validatePet(hatchedPet(now)), false);
  assert.throws(() => validatePet({...hatchedPet(now), foundOn: 'yesterday'}), /펫의 돌봄 기록/);
  assert.deepEqual(['불뭉이', '여울냥', '펫'].map(petSubject), ['불뭉이가', '여울냥이', '펫이']);
  console.log('PASS  memo care once per kind and day, egg and habit isolation, sleep wording and backup validation');
}

async function setDay(page, date) {
  await page.clock.setFixedTime(at(date));
  await page.reload();
  await page.locator('#memo-input').waitFor();
}

async function clearStatus(page, id) {
  await page.evaluate(id => { document.getElementById(id).textContent = ''; }, id);
}

async function writeMemo(page, text) {
  await clearStatus(page, 'home-status');
  await page.locator('#memo-input').fill(text);
  await page.locator('#memo-input').press('Enter');
  await page.locator('#home-status').getByText(/메모를 남겼어요/).waitFor();
  return page.locator('#home-status').textContent();
}

async function reply(page, text) {
  await clearStatus(page, 'detail-status');
  await page.locator('#reply-input').fill(text);
  await page.locator('#reply-input').press('Enter');
  await page.locator('#detail-status').getByText(/답장을 저장했어요/).waitFor();
  return page.locator('#detail-status').textContent();
}

const readState = page => page.evaluate(async () => (await import('./vault.js')).transact());

// A hatched pet brings back one older memo a day; answering or putting it back is shared by tabs,
// and writing or rereading memos feeds the pet only once a day for each kind.
async function checkFoundNotes(session) {
  const [first, second, third] = ['2031-05-10', '2031-05-11', '2031-05-12'];
  const pages = [];
  const open = async date => {
    const page = await session.tab(date);
    pages.push(page);
    await setDay(page, date);
    return page;
  };
  try {
    const page = await open(first);
    assert.equal(await writeMemo(page, '창가 화분에 물 주기'), '메모를 남겼어요.');
    await page.evaluate(async pet => {
      await (await import('./vault.js')).transact(state => { state.pet = pet; });
    }, hatchedPet(at(first)));
    await setDay(page, first);
    assert.equal(await page.locator('#found-note').isVisible(), false, 'a memo from today is never found');
    assert.deepEqual((await readState(page)).daily, [{date: first, memoId: null, folded: false}]);
    assert.match(await writeMemo(page, '다음 주 회의 자료 정리'), /새 쪽지를 받아 들고 배가 든든해졌어요/);
    assert.equal(await writeMemo(page, '저녁에 읽을 책 고르기'), '메모를 남겼어요.');
    assert.equal((await readState(page)).pet.hunger, 30);

    const today = await open(second);
    const peer = await open(second);
    const card = today.locator('#found-note');
    await card.waitFor();
    await peer.locator('#found-note').waitFor();
    const picked = (await readState(today)).daily.find(entry => entry.date === second).memoId;
    const memo = (await readState(today)).memos.find(record => record.id === picked);
    assert.equal(await today.locator('#found-note-excerpt').textContent(), memo.text);
    assert.equal(await peer.locator('#found-note-excerpt').textContent(), memo.text);
    assert.match(await today.locator('#found-note-title').textContent(), /정원에서 묻어 둔 쪽지를 찾아왔어요/);
    assert.equal(await today.locator('#found-note-date').textContent(), '5월 10일에 쓴 메모 · 1일 전');
    await today.locator('#pet-expand.has-note[aria-label$="펫이 쪽지를 찾아왔어요"]').waitFor();

    await today.locator('#found-note-open').click();
    await today.locator('#reply-input:focus').waitFor();
    await today.locator('#found-note-hint').getByText(/찾아온 쪽지예요/).waitFor();
    assert.match(await reply(today, '다시 보니 자료가 거의 다 모였다'), /신이 났어요/);
    await today.locator('#found-note.answered').waitFor();
    await today.locator('#pet-expand:not(.has-note)').waitFor();
    assert.equal(await today.locator('#found-note-fold').isVisible(), false);
    assert.equal(await today.locator('#found-note-hint').isVisible(), false);
    await peer.locator('#found-note.answered').waitFor();
    assert.equal(await reply(today, '하나 더 적어 둔다'), '답장을 저장했어요.');

    const other = (await readState(today)).memos.find(record => record.id !== picked);
    await today.locator('.archive-entry').filter({hasText: other.text}).click();
    assert.match(await reply(today, '이것도 다시 읽었다'), /다시 펼친 쪽지를 함께 들여다봤어요/);
    assert.match(await writeMemo(today, '이틀째 메모'), /배가 든든해졌어요/);

    const later = await open(third);
    await later.locator('#found-note').waitFor();
    const next = (await readState(later)).daily.find(entry => entry.date === third);
    assert.notEqual(next.memoId, picked, 'yesterday\'s note is skipped while others remain');
    await later.locator('#found-note-fold').click();
    await later.locator('#home-status').getByText('쪽지를 정원에 다시 묻어 두었어요.').waitFor();
    await later.locator('#found-note').waitFor({state: 'hidden'});
    assert.equal((await readState(later)).daily.find(entry => entry.date === third).folded, true);
    await setDay(later, third);
    assert.equal(await later.locator('#found-note').isVisible(), false, 'a note put back stays put back');
    const folded = (await readState(later)).memos.find(record => record.id === next.memoId);
    await later.locator('.archive-entry').filter({hasText: folded.text}).click();
    assert.match(await reply(later, '묻어 둔 쪽지도 결국 읽었다'), /함께 들여다봤어요/);
    console.log('PASS  pet-found daily notes, shared answers and put-backs, and once-a-day memo care');
  } finally {
    for (const page of pages) await page.close();
  }
}

module.exports = {checkMemoCareRules, checkFoundNotes};
