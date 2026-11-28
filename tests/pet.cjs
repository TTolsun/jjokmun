const assert = require('node:assert/strict');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {extension} = require('./browser.cjs');
const {petAction, petButton, liftPet, layPet, finishBallGame, confirmNewEgg} = require('./pet-controls.cjs');

const families = [['fire', 0], ['water', 0.4], ['grass', 0.8]];
const stages = [['runner', 'play'], ['scout', 'explore'], ['cuddler', 'pet']];
const clock = '2050-01-01T12:00:00+09:00';

function legacyPet(now, form = 'egg', discovered = ['egg']) {
  return {
    form, startedAt: now, tickAt: now, hunger: 32, happiness: 70, energy: 80,
    health: 100, poop: 0, sleepStartedAt: 0, sleepTickAt: 0, sleepUntil: 0,
    care: 0, play: 0, explore: 0, affection: 0, digestion: 0, memoVisits: 0,
    discovered
  };
}

async function checkPetClock() {
  const {PET_TICK_MS, applyPetAction, petView} = await import(pathToFileURL(path.join(extension, 'pet.js')).href);
  const noon = new Date(2050, 0, 1, 12).getTime();
  const state = {};
  applyPetAction(state, 'adopt', noon, () => 0);
  applyPetAction(state, 'pet', noon);
  assert.equal(petView(state.pet, noon + 60_000).form, 'egg');
  assert.equal(petView(state.pet, noon + 120_000).form, 'fire-pup');
  assert.equal(state.pet.form, 'egg', 'view should not mutate persisted state');
  applyPetAction(state, 'feed', noon + 120_000);
  const afterMeal = noon + 120_000 + PET_TICK_MS;
  assert.equal(petView(state.pet, afterMeal).poop, 1);
  applyPetAction(state, 'clean', afterMeal);
  assert.equal(petView(state.pet, afterMeal).poop, 0);

  const evening = new Date(2050, 0, 1, 22).getTime();
  const morning = new Date(2050, 0, 2, 6).getTime();
  applyPetAction(state, 'sleep', evening);
  assert.equal(petView(state.pet, evening + PET_TICK_MS).sleeping, true);
  assert.equal(petView(state.pet, morning).sleeping, false);
  assert.ok(petView(state.pet, evening + PET_TICK_MS).energy > state.pet.energy);
  console.log('PASS  timed hatching, digestion, cleaning and overnight sleep');
}

async function checkGrowthPaths() {
  const {PET_FAMILIES, PET_FORM_DETAILS, applyPetAction, petEvolution, petView} =
    await import(pathToFileURL(path.join(extension, 'pet.js')).href);
  const noon = new Date(clock).getTime();
  const act = (state, action, time) => assert.ok(applyPetAction(state, action, time).changed, action);
  for (const [index, [family, draw]] of families.entries()) {
    const child = PET_FAMILIES[family];
    for (const [first, firstAction] of stages) {
      for (const [second, secondAction] of stages) {
        const state = {};
        assert.ok(applyPetAction(state, 'adopt', noon, () => draw).changed);
        assert.equal(state.pet.lineage, family);
        assert.equal(petView(state.pet, noon).lineage, undefined);
        for (let i = 0; i < 3; i++) act(state, 'pet', noon);
        assert.equal(state.pet.form, child);
        assert.equal(petEvolution(state.pet, noon + 60 * 60_000), null, 'time cannot grow a stage without habits');
        for (let i = 0; i < 3; i++) act(state, firstAction, noon);
        const firstForm = family + '-' + first;
        assert.equal(petView(state.pet, noon).form, child, 'activity cannot skip minimum stage time');
        state.pet = petEvolution(state.pet, noon + 30 * 60_000).pet;
        assert.equal(state.pet.form, firstForm);
        assert.deepEqual([state.pet.play, state.pet.explore, state.pet.affection], [0, 0, 0]);
        assert.equal(petEvolution(state.pet, state.pet.startedAt + 60 * 60_000), null, 'stage one habits cannot grow stage two');

        const secondStart = noon + 30 * 60_000;
        for (let i = 0; i < 3; i++) act(state, secondAction, secondStart);
        assert.equal(petView(state.pet, secondStart).form, firstForm);
        state.pet = petEvolution(state.pet, secondStart + 30 * 60_000).pet;
        const evolved = family + '-' + first + '-' + second;
        assert.equal(state.pet.form, evolved);
        assert.equal(PET_FORM_DETAILS[evolved].parent, firstForm);
        assert.deepEqual(state.pet.discovered, ['egg', child, firstForm, evolved]);
        const restAt = secondStart + 30 * 60_000;
        act(state, 'sleep', restAt);
        const reaction = applyPetAction(state, 'play', restAt + 60 * 60_000);
        assert.equal(reaction.event, PET_FORM_DETAILS[evolved].ballReaction);
        const [nextFamily, nextDraw] = families[(index + 1) % families.length];
        const discovered = [...state.pet.discovered];
        assert.ok(applyPetAction(state, 'newEgg', restAt + 60 * 60_000, () => nextDraw).changed);
        assert.equal(state.pet.lineage, nextFamily);
        assert.deepEqual(state.pet.discovered, discovered);
      }
    }
  }

  const fast = {};
  applyPetAction(fast, 'adopt', noon, () => 0);
  for (let i = 0; i < 3; i++) act(fast, 'pet', noon);
  for (let i = 0; i < 10; i++) act(fast, 'pet', noon);
  assert.equal(fast.pet.form, 'fire-pup', 'ten activities still need stage one time');
  fast.pet = petEvolution(fast.pet, noon + 15_000).pet;
  assert.equal(fast.pet.form, 'fire-cuddler');
  for (let i = 0; i < 10; i++) act(fast, 'pet', fast.pet.startedAt);
  assert.equal(fast.pet.form, 'fire-cuddler', 'ten activities still need stage two time');
  assert.equal(petEvolution(fast.pet, noon + 60_000).pet.form, 'fire-cuddler-cuddler');

  const clean = {pet: {...legacyPet(noon, 'fire-pup', ['egg', 'fire-pup']), lineage: 'fire', hunger: 90, poop: 1, health: 50}};
  for (const action of ['feed', 'snack', 'clean', 'heal', 'sleep', 'wake', 'memo']) act(clean, action, noon);
  assert.deepEqual([clean.pet.play, clean.pet.explore, clean.pet.affection], [0, 0, 0]);
  assert.equal(petEvolution(clean.pet, noon + 60 * 60_000), null, 'maintenance alone cannot select a route');
  assert.equal(Object.values(PET_FORM_DETAILS).filter(form => form.lineage !== 'legacy').length, 40);
  assert.equal(Object.values(PET_FORM_DETAILS).filter(form => form.lineage !== 'legacy' && form.stage === 3).length, 27);
  console.log('PASS  40 forms, all 27 ordered final routes, stage isolation and maintenance without an evolution bias');
}

async function checkAdoptionBackups() {
  const {PET_FAMILIES, applyPetAction, petView} = await import(pathToFileURL(path.join(extension, 'pet.js')).href);
  const {emptyState, validateBackup} = await import(pathToFileURL(path.join(extension, 'store.js')).href);
  const {mergeImport} = await import(pathToFileURL(path.join(extension, 'imports.js')).href);
  const now = Date.now() - 1000;
  const day = '2031-05-13';
  const noRedraw = () => { throw new Error('a stored egg should not draw its lineage again'); };
  const edges = [
    ['fire', 1 / 3 - Number.EPSILON], ['water', 1 / 3],
    ['water', 2 / 3 - Number.EPSILON], ['grass', 2 / 3]
  ];
  for (const [family, draw] of [...families, ...edges]) {
    const source = emptyState();
    let draws = 0;
    applyPetAction(source, 'adopt', now, () => { draws += 1; return draw; });
    assert.equal(draws, 1);
    assert.equal(source.pet.lineage, family);
    assert.equal(petView(source.pet, now).lineage, undefined);
    applyPetAction(source, 'pet', now, noRedraw);
    const restored = emptyState();
    mergeImport(restored, validateBackup(JSON.parse(JSON.stringify(source))), day);
    assert.deepEqual(restored.pet, source.pet);
    for (let i = 0; i < 2; i++) applyPetAction(restored, 'pet', now, noRedraw);
    assert.equal(restored.pet.form, PET_FAMILIES[family]);
    assert.deepEqual(restored.pet.discovered, ['egg', PET_FAMILIES[family]]);
  }
  console.log('PASS  equal-sized adoption buckets, hidden egg lineage and stable hatch through backup restore');
}

async function checkLegacyPetBackups() {
  const {emptyState, validateBackup} = await import(pathToFileURL(path.join(extension, 'store.js')).href);
  const {mergeImport, undoImport} = await import(pathToFileURL(path.join(extension, 'imports.js')).href);
  const {applyPetAction} = await import(pathToFileURL(path.join(extension, 'pet.js')).href);
  const now = Date.now();
  const day = '2031-05-13';
  const seed = emptyState();
  seed.pet = legacyPet(now, 'baby', ['egg', 'baby', 'runner']);
  seed.memos.push({id: 'old-pet-note', text: '예전 새싹이 기록', createdOn: day, updatedAt: 1, replies: []});
  const legacy = validateBackup(seed);
  assert.equal(legacy.pet.form, 'baby');
  const empty = emptyState();
  const restored = mergeImport(empty, legacy, day);
  assert.equal(empty.pet.form, 'baby');
  assert.deepEqual(empty.memos, seed.memos);
  assert.deepEqual(empty.pet.discovered, seed.pet.discovered);
  assert.equal(undoImport(empty, restored.undo, day).conflicts, 0);
  assert.equal(empty.pet, undefined);
  assert.deepEqual(empty.memos, []);

  const active = emptyState();
  applyPetAction(active, 'adopt', now, () => 0);
  const original = structuredClone(active.pet);
  const merged = mergeImport(active, legacy, day);
  assert.equal(active.pet.form, 'egg');
  assert.equal(active.pet.lineage, 'fire');
  assert.deepEqual(active.pet.discovered, ['egg', 'baby', 'runner']);
  assert.ok(merged.undo);
  undoImport(active, merged.undo, day);
  assert.deepEqual(active.pet, original);

  const grass = emptyState();
  applyPetAction(grass, 'adopt', now, () => 0.8);
  for (let i = 0; i < 3; i++) applyPetAction(grass, 'pet', now);
  mergeImport(grass, legacy, day);
  assert.equal(grass.pet.form, 'grass-hamster');
  assert.deepEqual(grass.pet.discovered, ['egg', 'grass-hamster', 'baby', 'runner']);

  const egg = {pet: legacyPet(now)};
  for (let i = 0; i < 3; i++) applyPetAction(egg, 'pet', now);
  assert.equal(egg.pet.form, 'baby');
  console.log('PASS  old eggs still hatch into legacy pets, and old backups preserve pets, discoveries and memos');
}

async function checkPet(session) {
  const page = await session.tab(undefined, 'test-vault', 'pet');
  const peer = await session.tab(undefined, 'test-vault', 'pet');
  await page.bringToFront();
  const startedAt = new Date(clock).getTime();
  await page.addInitScript(() => { Math.random = () => 0; });
  await page.evaluate(() => { Math.random = () => 0; });
  const action = name => petAction(page, name);
  const idle = page.locator('#pet-device[data-mode="idle"]');
  const play = async () => {
    await action('play');
    await finishBallGame(page);
  };
  const collapsed = page.locator('#pet-expand[aria-expanded="false"]');
  const closeGame = () => layPet(page);
  const readPet = target => target.evaluate(async () => (await (await import('./vault.js')).transact()).pet);
  const showForm = async form => {
    const selector = '#pet-habitat[data-form="' + form + '"]';
    await page.locator(selector).waitFor({state:'attached'});
    await peer.locator(selector).waitFor({state:'attached'});
  };
  const later = async minutes => {
    await page.clock.setFixedTime(new Date(startedAt + minutes * 60_000));
    await page.reload();
  };
  const discovered = page.locator('#pet-collection li:not(.undiscovered)');
  const memo = '창가에서 불 강아지를 만난 날';
  try {
    await page.clock.setFixedTime(startedAt);
    await peer.clock.setFixedTime(startedAt);
    await page.locator('#pet').waitFor();
    await collapsed.waitFor();
    await action('adopt');
    await page.locator('#pet-status').getByText(/알을 데려왔어요/).waitFor();
    await idle.waitFor();
    await peer.locator('#pet-lcd-name').getByText('알', {exact: true}).waitFor({state:'attached'});
    const egg = await readPet(page);
    assert.equal(egg.form, 'egg');
    assert.equal(egg.lineage, 'fire');
    assert.deepEqual(await readPet(peer), egg);

    await action('pet');
    await page.locator('#pet-status').getByText(/알이 손길에/).waitFor();
    await later(2);
    await showForm('fire-pup');
    assert.equal((await readPet(peer)).form, 'fire-pup');

    const hatched = await readPet(page);
    await liftPet(page);
    await idle.waitFor();
    await page.keyboard.press('b');
    await page.locator('#pet-device[data-mode="clock"] #pet-clock').waitFor();
    assert.equal(await page.locator('#pet-clock-time').getAttribute('datetime'), new Date(startedAt + 120_000).toISOString());
    await page.keyboard.press('Escape');
    await collapsed.waitFor();
    await liftPet(page);
    await page.keyboard.press('a');
    const selected = page.locator('#pet-icon-strip [aria-pressed="true"]');
    const first = await selected.getAttribute('data-pet-menu');
    await page.keyboard.press('ArrowRight');
    assert.notEqual(await selected.getAttribute('data-pet-menu'), first);
    await page.keyboard.press('b');
    await page.locator('#pet-device[data-mode="menu"]').waitFor();
    await page.keyboard.press('c');
    await collapsed.waitFor();

    await action('feed');
    await page.waitForFunction(hunger => document.querySelector('#pet-hunger').value < hunger, hatched.hunger, {timeout: 10000});
    const beforeGame = await readPet(page);
    await action('play');
    await page.keyboard.press('b');
    await page.locator('#pet-game[data-phase="aim"]').waitFor();
    await page.keyboard.press('b');
    await page.locator('#pet-game[data-phase="result"]').waitFor();
    const score = await page.locator('#pet-game-score').textContent();
    await page.locator('#memo-input').click();
    await page.locator('#memo-input:focus').waitFor();
    await page.keyboard.type('abc');
    assert.equal(await page.locator('#memo-input').inputValue(), 'abc');
    assert.equal(await page.locator('#pet-game').getAttribute('data-phase'), 'result');
    assert.equal(await page.locator('#pet-game-score').textContent(), score);
    await page.locator('#pet-c').focus();
    await page.locator('#pet-c:focus').waitFor();
    await page.keyboard.press('c');
    await collapsed.waitFor();
    assert.deepEqual(await readPet(page), beforeGame);
    assert.deepEqual(await readPet(peer), beforeGame);

    await play();
    await page.locator('#pet-status').getByText(/공/).waitFor();
    const fed = await readPet(page);
    assert.ok(fed.hunger < hatched.hunger);
    assert.equal(fed.play, beforeGame.play + 2, 'a completed game counts as one play action');
    await closeGame();
    assert.deepEqual(await readPet(page), fed);
    await page.reload();
    await collapsed.waitFor();
    assert.deepEqual(await readPet(page), fed);

    await page.locator('#memo-input').fill(memo);
    await page.locator('#memo-save').click();
    await page.locator(':is(#detail-original, #detail-preview):visible').getByText(memo).waitFor();
    await page.locator('#pet-read-memo').click();
    await liftPet(page);
    await page.locator('#pet-memo-excerpt').getByText(memo).waitFor();
    await page.locator('#detail-dialog:visible').waitFor();
    await page.locator('#reply-input').fill('같은 화면에 답장을 남겼다.');
    await page.locator('#reply-save').click();
    await page.locator('#detail-replies').getByText('같은 화면에 답장을 남겼다.').waitFor();
    assert.equal(await page.locator('#pet-memo-excerpt').textContent(), memo);
    assert.equal((await readPet(page)).memoVisits, 1);

    for (let i = 0; i < 2; i++) {
      await play();
      await closeGame();
    }
    await page.locator('#pet-growth[value="40"]').waitFor({state:'attached'});
    await later(20);
    await showForm('fire-runner');
    assert.ok((await readPet(peer)).discovered.includes('fire-runner'));
    for (let i = 0; i < 3; i++) await action('explore');
    await page.locator('#pet-habit').getByText(/꼬리 끝 불을 높이고/).waitFor();
    await page.locator('#pet-habitat[data-preview="true"]').waitFor();
    await page.locator('#pet-sprite[src$="fire-runner-habit-explore.png"]').evaluate(img => img.decode());
    await page.waitForFunction(() => document.querySelector('#pet-growth').value >= 30, null, {timeout: 10000});
    assert.equal((await readPet(page)).explore, 6);
    await later(50);
    await showForm('fire-runner-scout');
    assert.ok((await readPet(peer)).discovered.includes('fire-runner-scout'));
    assert.equal(await discovered.count(), 4);
    assert.match(await page.locator('#pet-collection-count').innerText(), /4 \/ 40/);

    await liftPet(page);
    await page.locator('#pet-icon-strip [data-pet-menu="status"]').click();
    await page.locator('#pet-state[data-page="meters"] progress#pet-hunger').waitFor();
    await petButton(page, 'a');
    await page.locator('#pet-path').getByText('불뭉이 → 불달이 → 봉홧불이').waitFor();
    await page.locator('#pet-collection-panel > summary').click();
    await page.locator('[data-discovered-form="fire-runner-scout"]').getByText('봉홧불이', {exact: true}).waitFor();
    await page.locator('#pet-collection-panel > summary').click();
    await play();
    await page.locator('#pet-status').getByText(/봉홧불이가.*공/).waitFor();
    await page.locator('#pet-habitat[data-reaction="beacon"]').waitFor();
    await page.locator('#pet-sprite[src$="fire-runner-scout-play.png"]').evaluate(img => img.decode());
    await closeGame();
    for (const width of [320, 640, 1280]) {
      await page.setViewportSize({width, height: 720});
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width, 'pet fits the viewport');
    }

    const recorded = (await readPet(page)).discovered;
    await action('newEgg');
    await layPet(page);
    assert.deepEqual((await readPet(page)).discovered, recorded);
    await action('newEgg');
    await confirmNewEgg(page);
    await showForm('egg');
    assert.equal((await readPet(page)).lineage, 'fire');
    assert.deepEqual((await readPet(page)).discovered, recorded);

    const reversed = {
      ...legacyPet(startedAt + 50 * 60_000, 'fire-scout-runner', ['egg', 'fire-pup', 'fire-scout', 'fire-scout-runner']),
      lineage: 'fire'
    };
    await page.evaluate(async pet => {
      const {transact} = await import('./vault.js');
      await transact(state => { state.pet = pet; });
    }, reversed);
    await page.reload();
    await liftPet(page);
    await page.locator('#pet-icon-strip [data-pet-menu="status"]').click();
    await petButton(page, 'a');
    await page.locator('#pet-path').getByText('불뭉이 → 잿코 → 펄럭귀').waitFor();
    await petButton(page, 'c');
    await play();
    await page.locator('#pet-status').getByText(/펄럭귀가.*공/).waitFor();
    await page.locator('#pet-habitat[data-reaction="flutter"]').waitFor();
    await page.locator('#pet-sprite[src$="fire-scout-runner-play.png"]').evaluate(img => img.decode());
    await closeGame();

    const old = legacyPet(startedAt + 50 * 60_000, 'cuddler', ['egg', 'baby', 'cuddler']);
    await page.evaluate(async oldPet => {
      const {transact} = await import('./vault.js');
      await transact(state => { state.pet = oldPet; });
    }, old);
    await page.reload();
    await page.locator('#pet-summary-sprite[src$="/cuddler.png"]').evaluate(img => img.decode());
    assert.deepEqual((await readPet(page)).discovered, old.discovered);
    assert.match(await page.locator('#pet-collection-count').innerText(), /3 \/ 44/);
    await action('newEgg');
    await confirmNewEgg(page);
    await page.locator('#pet-habitat[data-form="egg"]').waitFor({state:'attached'});
    assert.equal((await readPet(page)).lineage, 'fire');
    assert.deepEqual((await readPet(page)).discovered, old.discovered);
    console.log('PASS  three-button menus, cancel and commit ball game, fire pet care, two timed stages, reaction image, cross-tab persistence, memo reading, legacy pets, collection and responsive layout');
  } finally {
    await peer.close();
    await page.close();
  }
}

async function checkFamilyCollection(session) {
  const page = await session.tab(undefined, 'test-vault', 'pet');
  const now = new Date(clock).getTime();
  const collection = page.locator('#pet-collection');
  try {
    for (const [family, draw] of families.slice(1)) {
      const child = family === 'water' ? 'water-kitten' : 'grass-hamster';
      await page.evaluate(async () => {
        const {transact} = await import('./vault.js');
        await transact(state => { delete state.pet; });
      });
      await page.clock.setFixedTime(now);
      await page.reload();
      await page.evaluate(draw => { Math.random = () => draw; }, draw);
      await petAction(page, 'adopt');
      await page.locator('#pet-status').getByText(/알을 데려왔어요/).waitFor();
      await page.locator('#pet-lcd-name').getByText('알', {exact: true}).waitFor();
      await page.locator('#pet-sprite[src$="/egg.png"]').waitFor();
      assert.match(await page.locator('#pet-collection-count').textContent(), /1 \/ 40/);
      assert.equal(await collection.locator('img[src*="' + family + '-"]').count(), 0);
      assert.equal(await collection.locator('[data-discovered-form]').count(), 1);
      assert.doesNotMatch(await collection.textContent(), /불 강아지|물 고양이|풀 햄스터/);
      await petAction(page, 'pet');
      await page.clock.setFixedTime(now + 120_000);
      await page.reload();
      await page.locator('#pet-habitat[data-form="' + child + '"]').waitFor({state:'attached'});
      await page.locator('#pet-summary-sprite[src$="/' + child + '.png"]').evaluate(img => img.decode());
      await liftPet(page);
      await page.locator('#pet-collection-panel > summary').click();
      await collection.locator('[data-discovered-form="' + child + '"]').waitFor({state:'attached'});
      assert.match(await page.locator('#pet-collection-count').textContent(), /2 \/ 40/);
      for (const [other] of families) {
        if (family !== other) assert.equal(await collection.locator('img[src*="' + other + '-"]').count(), 0);
      }

      await petAction(page, 'play');
      await finishBallGame(page);
      await page.locator('#pet-status').getByText(/공/).waitFor();
      await page.locator('#pet-sprite[src$="' + child + '-play.png"]').evaluate(img => img.decode());
      await layPet(page);
    }
    console.log('PASS  seeded water and grass hatches, unrevealed collections, sprites and play reactions');
  } finally {
    await page.close();
  }
}

async function checkPetDeviceGeometry(session) {
  const page = await session.tab(undefined, 'test-vault', 'pet');
  const widths = [320, 768, 1280, 1600];
  const parts = ['#pet-device', '#pet-device .pet-lcd', '#pet-habitat'];
  const baselines = new Map();
  const size = () => page.evaluate(selectors => selectors.map(selector => {
    const {width, height} = document.querySelector(selector).getBoundingClientRect();
    return [width, height];
  }), parts);
  const mode = async expected => {
    await page.locator('#pet-device[data-mode="' + expected + '"]').waitFor();
  };
  const compare = async (width, state) => {
    const before = baselines.get(width);
    const after = await size();
    for (const [index, [w, h]] of after.entries()) {
      assert.ok(Math.abs(w - before[index][0]) <= 1 && Math.abs(h - before[index][1]) <= 1,
        parts[index] + ' changes shape at ' + width + 'px in ' + state + ': ' + before[index] + ' → ' + after[index]);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
  };

  try {
    for (const width of widths) {
      await page.setViewportSize({width, height: 800});
      const miniature = await page.locator('#pet-expand').boundingBox();
      await liftPet(page);
      await mode('idle');
      const baseline = await size();
      baselines.set(width, baseline);
      const [[shellWidth, shellHeight], [lcdWidth, lcdHeight]] = baseline;
      const [firstWidth, firstHeight] = baselines.get(widths[0])[0];
      assert.ok(Math.abs(shellWidth / shellHeight - firstWidth / firstHeight) < 0.02,
        'the shell keeps its shape when resized');
      assert.ok(shellWidth > miniature.width && shellHeight > miniature.height, 'the device enlarges');
      assert.ok(Math.abs(shellWidth / shellHeight - miniature.width / miniature.height) < 0.02,
        'the shell keeps its shape when lifted');
      assert.ok(lcdWidth < shellWidth && lcdHeight < shellHeight, 'LCD stays inset within the device');
      await petButton(page, 'b');
      await mode('clock');
      await compare(width, 'clock');
      await layPet(page);
      await liftPet(page);
      await page.locator('[data-pet-menu="status"]').click();
      await mode('status');
      await compare(width, 'status meters');
      await petButton(page, 'a');
      await page.locator('#pet-state[data-page="overview"]').waitFor();
      await compare(width, 'status overview');
      await layPet(page);
      await liftPet(page);
      await page.locator('[data-pet-menu="food"]').click();
      await mode('menu');
      await compare(width, 'food menu');
      await petAction(page, 'play');
      await mode('game');
      await compare(width, 'game ready');
      await petButton(page, 'b');
      await page.locator('#pet-game[data-phase="aim"]').waitFor();
      await compare(width, 'game aim');
      await petButton(page, 'b');
      await page.locator('#pet-game[data-phase="result"]').waitFor();
      await compare(width, 'game result');
      await layPet(page);
    }

    await page.evaluate(async () => {
      const {transact} = await import('./vault.js');
      await transact(state => { state.pet.hunger = 80; });
    });
    await page.reload();
    await liftPet(page);
    await page.locator('#pet-attention').waitFor();
    for (const width of widths) {
      await page.setViewportSize({width, height: 800});
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await compare(width, 'attention indicator');
    }
    console.log('PASS  device and LCD dimensions remain stable across all panels and attention at 320–1600px');
  } finally {
    await page.close();
  }
}

module.exports = {
  checkPet, checkPetClock, checkGrowthPaths, checkAdoptionBackups, checkLegacyPetBackups,
  checkFamilyCollection, checkPetDeviceGeometry
};
