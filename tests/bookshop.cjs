const assert = require('node:assert/strict');

async function checkBookshop(session) {
  const a = await session.tab();
  const b = await session.tab();
  const start = new Date('2031-05-12T10:00:00Z');
  const shopState = page => page.evaluate(async () => (await (await import('./vault.js')).transact()).shop);
  try {
    for (const page of [a, b]) {
      await page.clock.setFixedTime(start);
      await page.locator('#open-shop').click();
    }
    assert.equal(await a.locator('#shop-upgrade').isDisabled(), true);
    await a.locator('#shop-seat').selectOption('garden');
    await b.waitForFunction(() => document.querySelector('#shop-seat').value === 'garden');
    await a.locator('#shop-plan').selectOption('picks');
    await b.waitForFunction(() => document.querySelector('#shop-plan').value === 'picks');
    assert.match(await b.locator('#shop-hint').textContent(), /추천대를 찾을 손님 1명.*열람석을 이용할 손님 2명/);
    await a.getByRole('button', {name: '가게 열기'}).click();
    await b.bringToFront();
    await b.waitForFunction(() => document.querySelector('#shop-phase').textContent.startsWith('영업 중'));
    await b.clock.setFixedTime(new Date(start.getTime() + 6500));
    await b.getByRole('button', {name: '도담', exact: true}).focus();
    await b.keyboard.press('Enter');
    assert.match(await b.locator('#shop-guests-status').textContent(), /도담.*추천 도서 고르는 중/);
    await b.emulateMedia({reducedMotion:'reduce'});
    await b.waitForFunction(() => document.querySelector('#shop-motion').getAttribute('aria-pressed') === 'true');
    await b.locator('#shop-motion').click();
    assert.equal(await b.locator('#shop-motion').getAttribute('aria-pressed'), 'false');
    await b.getByRole('button', {name: '유리', exact: true}).click();
    await b.clock.setFixedTime(new Date(start.getTime() + 8000));
    await b.waitForFunction(() => document.querySelector('#shop-guests-status').textContent.includes('독서 중'));
    await b.getByRole('button', {name: '도담', exact: true}).click();
    assert.match(await b.locator('#shop-guest-note').textContent(), /화분 옆/);
    const seatPixel = await b.evaluate(async () => {
      const {project} = await import('./ui/shop-interior.js');
      const [x, y] = project(173, 78);
      const canvas = document.querySelector('#shop-guests');
      return {x: x * canvas.clientWidth / canvas.width, y: (y - 8) * canvas.clientHeight / canvas.height};
    });
    await b.locator('#shop-guests').click({position: seatPixel});
    assert.equal(await b.getByRole('button', {name: '유리', exact: true}).getAttribute('aria-pressed'), 'true');
    assert.equal(await b.locator('#shop-seat').isDisabled(), true);
    await b.reload();
    await b.locator('#open-shop').click();
    assert.equal((await shopState(b)).openedAt, start.getTime());
    for (const page of [a, b]) {
      await page.bringToFront();
      await page.clock.setFixedTime(new Date(start.getTime() + 60000));
      await page.getByRole('button', {name: '오늘 매출 정산'}).waitFor();
    }
    const sales = await a.locator('#shop-sales').textContent();
    const earned = Number(/매출 (\d+)잎전/.exec(sales)[1]);
    await a.getByRole('button', {name: '도담', exact: true}).click();
    assert.match(await a.locator('#shop-guest-note').textContent(), /구매 \d+잎전.*평판 \+\d+.*운영 방침/);
    await Promise.all([a, b].map(page => page.evaluate(() => {
      const button = document.querySelector('#shop-primary');
      if (button.textContent === '오늘 매출 정산') button.click();
    })));
    await b.waitForFunction(() => document.querySelector('#shop-day').textContent === '2일차');
    const closed = await shopState(b);
    assert.equal(closed.days, 1);
    assert.equal(closed.coins, earned);
    await b.locator('#shop-upgrade').click();
    await a.bringToFront();
    await a.waitForFunction(() => document.querySelector('#shop-sales').textContent.includes('4명'));
    assert.equal((await shopState(a)).coins, earned - 18);

    await a.evaluate(async () => {
      const {emptyState, validateBackup} = await import('./store.js');
      const {mergeImport, undoImport} = await import('./imports.js');
      const {transact} = await import('./vault.js');
      const backup = validateBackup({...emptyState(), shop: (await transact()).shop});
      const fresh = emptyState();
      const day = '2031-05-12';
      const {undo} = mergeImport(fresh, backup, day);
      if (fresh.shop.level !== 2) throw Error('shop restore');
      undoImport(fresh, undo, day);
      if (fresh.shop !== undefined) throw Error('shop undo');
      const next = mergeImport(fresh, backup, day);
      fresh.shop.seat = 'window';
      if (!undoImport(fresh, next.undo, day).conflicts || fresh.shop.seat !== 'window') throw Error('lost newer shop');
      if (mergeImport(fresh, backup, day).undo) throw Error('overwrote existing shop');
      const {schedule, newShop, COLLECTOR_REPUTATION} = await import('./shop.js');
      const popular = newShop();
      popular.hearts = COLLECTOR_REPUTATION;
      if (schedule(popular).at(-1).person.name !== '헌책 수집가 별') throw Error('missing regular');
    });
    console.log('PASS  shop layout and policy sync, guest activity, resume, single settlement, expansion, backup and selective undo');
  } finally {
    await a.close();
    await b.close();
  }
}

module.exports = {checkBookshop};
