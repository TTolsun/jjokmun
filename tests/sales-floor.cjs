const { openSection } = require('./browser.cjs');
const assert = require('node:assert/strict');

async function checkSalesFloor(session) {
  const page = await session.tab(undefined, 'test-vault', 'floor');
  const other = await session.tab(undefined, 'test-vault', 'floor');
  const read = () => page.evaluate(async () => (await (await import('./vault.js')).readPayload()).payload.state);
  try {
    await page.getByText('영업 1일차', {exact:true}).waitFor();
    const first = await read();
    assert.equal(first.memos.length, 0);
    assert.equal(await page.locator('#floor').getByText(/매출|판매액|영업 시작/).count(), 0);
    await page.clock.setFixedTime(first.business.started + 5000);
    // Drag the visible canopy to a non-grid-aligned position. Use its
    // actual rendered pixels, just like a pointer on the scaled canvas.
    const endpoints = await page.evaluate(async () => {
      const { project } = await import('./ui/shop-interior.js');
      const rect = document.querySelector('#business-people').getBoundingClientRect();
      return [[136,61],[79,100]].map(([x,y]) => {
        const [px,py] = project(x,y,19);
        return [rect.x + px*rect.width/256, rect.y + py*rect.height/152];
      });
    });
    await page.mouse.move(...endpoints[0]);
    await page.mouse.down();
    await page.mouse.move(...endpoints[1], {steps:7});
    await page.mouse.up();
    await other.waitForFunction(() => document.querySelector('#business-status') && document.querySelector('#furniture-handles button:nth-child(3)').style.left !== ''
      && Number.parseFloat(document.querySelector('#furniture-handles button:nth-child(3)').style.left) < 48);
    const moved = (await read()).business;
    assert.equal(moved.moves[0].key, 'cart');
    assert.ok(Math.abs(moved.moves[0].point[0]-79) <= 2 && Math.abs(moved.moves[0].point[1]-100) <= 2);
    await page.evaluate(async business => {
      const { emptyState, validateBackup } = await import('./store.js');
      const { firstBusiness } = await import('./business.js');
      const { mergeImport, undoImport } = await import('./imports.js');
      const fresh = firstBusiness(business.started + 1000);
      const target = { ...emptyState(), business: structuredClone(fresh) };
      const backup = validateBackup({ ...emptyState(), business });
      const { undo } = mergeImport(target, backup, '2030-01-01');
      if (target.business.moves[0]?.key !== 'cart') throw Error('first-day layout lost on restore');
      undoImport(target, undo, '2030-01-01');
      if (target.business.started !== fresh.started || target.business.moves.length) throw Error('first-day layout undo');
      business.moves[0].tick = -1;
      try { validateBackup({ ...emptyState(), business }); }
      catch { return; }
      throw Error('negative furniture move time accepted');
    }, moved);
    await page.reload();
    await page.getByText('영업 1일차', {exact:true}).waitFor();
    assert.deepEqual((await read()).business.moves, moved.moves);
    const timing = await page.evaluate(async b => {
      const { currentShift, firstBusiness, dayFor, defaultLayout, placementError } = await import('./business.js');
      const original = dayFor(firstBusiness(b.started));
      const shift = currentShift(b, b.started);
      if (original.stops[2] >= shift.day.stops[2]) throw Error('cart discovery');
      if (!placementError(defaultLayout(), 'cart', [96,116])) throw Error('door must remain clear');
      if (!placementError(defaultLayout(), 'cart', defaultLayout().desk)) throw Error('overlap');
      return { opens: shift.opens, close: shift.opens - 1000 };
    }, moved);
    await page.clock.setFixedTime(timing.close);
    await page.getByText(/다음 개점까지/).waitFor();
    await Promise.all([page.clock.setFixedTime(timing.opens + 2000), other.clock.setFixedTime(timing.opens + 2000)]);
    await Promise.all([page,other].map(tab => tab.getByText('영업 2일차', {exact:true}).waitFor()));
    const second = (await read()).business;
    assert.equal(second.days, 1);
    assert.deepEqual(second.opening.cart, moved.moves[0].point);
    await page.clock.setFixedTime(second.started + 35000);
    await page.waitForFunction(() => parseInt(document.querySelector('#floor-regulars').textContent, 10) > 0);
    const chair = page.getByRole('button', {name:'의자',exact:true});
    await chair.focus();
    await chair.press('ArrowRight');
    await page.waitForFunction(async () => {
      const state = (await (await import('./vault.js')).readPayload()).payload.state;
      return state.business.moves.some(m => m.key === 'chair');
    });
    const state = await read();
    await page.evaluate(async state => {
      const { emptyState, validateBackup } = await import('./store.js');
      const { firstBusiness, advanceBusiness, currentLayout } = await import('./business.js');
      const { mergeImport, undoImport } = await import('./imports.js');
      const copy = emptyState();
      copy.business = firstBusiness(1);
      const {undo} = mergeImport(copy, validateBackup(state), '2030-01-01');
      if (currentLayout(copy.business).chair[0] !== 31) throw Error('furniture restore');
      undoImport(copy, structuredClone(undo), '2030-01-01');
      if (copy.business.days !== 0) throw Error('business undo');
      advanceBusiness(copy.business, 864000000);
      if (copy.business.days < 100 || !copy.business.loyalty.includes(2)) throw Error('clock catch-up');
    }, state);
    assert.equal(await page.locator('#floor input:visible').count(), 0);
    assert.equal(await page.locator('.owners-pick').isVisible(), false);
    await page.locator('#open-archive').click();
    assert.deepEqual(await page.locator('.workspace input:visible').evaluateAll(inputs => inputs.map(input => input.id)), ['memo-input']);
    await page.locator('#memo-input').fill('주인이 권하는 여행기');
    await page.locator('#memo-save').click();
    await page.locator('#detail-original').getByText('주인이 권하는 여행기').waitFor();
    assert.deepEqual(await page.locator('.workspace input:visible').evaluateAll(inputs => inputs.map(input => input.id)), ['memo-input']);
    assert.equal(await page.locator('#edit-memo').isVisible(), false);
    await page.keyboard.press('Control+k');
    assert.equal(await page.locator('#archive-search').evaluate(input => input === document.activeElement), true);
    await page.locator('#memo-search > summary').click();
    await openSection(page, 'memo-tools');
    await page.locator('#display-memo').click();
    await page.locator('#detail-status').getByText('책방 매대에 추천글을 올렸어요.').waitFor();
    await page.locator('#floor-link').click();
    await page.locator('#business-pick').getByText('주인이 권하는 여행기').waitFor();
    await page.setViewportSize({ width:360, height:740 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.getByRole('link', {name:'손님 반응 보기'}).click();
    await page.locator('#shelf-title:focus').waitFor();
    assert.equal(await page.locator('#shop-book').innerText(), '주인이 권하는 여행기');
    await page.reload();
    await page.locator('#shelf-title:focus').waitFor();
    console.log('PASS  automatic shifts, live furniture drag, guest routes, loyalty, parallel clocks, restore and owner pick');
  } finally { await page.close(); await other.close(); }
}

module.exports = { checkSalesFloor };
