const assert = require('node:assert/strict');

const menus = {
  adopt: 'egg', pet: 'activity', feed: 'food', snack: 'food',
  play: 'activity', explore: 'activity', sleep: 'lamp', newEgg: 'restart'
};

function petButton(page, letter) {
  return page.locator('#pet-' + letter).click();
}

async function liftPet(page) {
  const popover = page.locator('#pet-popover');
  if (await popover.isVisible()) return;
  await page.locator('#pet-expand').click();
  await popover.waitFor();
}

async function layPet(page) {
  await petButton(page, 'c');
  await page.locator('#pet-popover').waitFor({state:'hidden'});
}

async function petAction(page, action) {
  await liftPet(page);
  const ready = page.locator('#pet-device[aria-busy="false"]');
  const option = page.locator('#pet-menu [data-pet-action="' + action + '"]');
  await ready.waitFor();
  if (!await option.isVisible()) {
    const category = action === 'pet' && await page.locator('#pet-habitat[data-form="egg"]').count()
      ? 'egg' : menus[action];
    await page.locator('#pet-icon-strip [data-pet-menu="' + category + '"]').click();
  }
  await option.click();
  await ready.waitFor();
}

async function finishBallGame(page) {
  const game = page.locator('#pet-game');
  await page.locator('#pet-game[data-phase="ready"]').waitFor();
  await petButton(page, 'b');
  for (let turn = 1; turn <= 3; turn++) {
    await page.locator('#pet-game[data-phase="aim"]').waitFor();
    let aligned = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      aligned = await game.evaluate(node => node.dataset.direction === node.dataset.target);
      if (aligned) break;
      await petButton(page, 'a');
    }
    assert.ok(aligned, 'A cycles through all three directions');
    await petButton(page, 'b');
    await page.locator('#pet-habitat:has(#pet-game[data-phase="result"]) #pet-game-ball[data-hit="true"]').waitFor();
    await petButton(page, 'b');
  }
  await page.locator('#pet-game[data-phase="complete"]').waitFor();
  await page.locator('#pet-game-score').getByText('3번 중 3번 받았어요').waitFor();
  await page.locator('#pet-game-message').getByText(/공놀이를 마쳤어요/).waitFor();
}

async function confirmNewEgg(page) {
  await page.locator('#pet-device[data-mode="confirm"]').waitFor();
  await petButton(page, 'a');
  await petButton(page, 'b');
}

module.exports = {petAction, petButton, liftPet, layPet, finishBallGame, confirmNewEgg};
