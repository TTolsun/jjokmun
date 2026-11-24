const assert = require('node:assert/strict');

async function checkBookshop(session) {
  const page = await session.tab();
  const second = await session.tab();
  const start = Date.parse('2031-05-12T14:59:55Z');
  const waitText = (tab, id, value) => tab.waitForFunction(([id, value]) =>
    document.getElementById(id).textContent === value, [id, value]);
  try {
    await page.bringToFront();
    await page.clock.setFixedTime(start);
    await waitText(page, 'shop-crowd', '단골 0명 · 방문 중 0명');
    await waitText(page, 'shop-clock', '23:59:55');
    for (const [index, name] of ['봄의 기록', '겨울의 기록'].entries()) {
      await page.locator('#memo-input').fill(name);
      await page.locator('#memo-save').click();
      await waitText(page, 'shop-crowd', '단골 ' + (index + 1) + '명 · 방문 중 ' + (index + 1) + '명');
    }
    await page.locator('#reply-input').fill('좋은 책');
    await page.locator('#reply-save').click();
    await page.locator('#detail-replies').getByText('좋은 책').waitFor();
    assert.equal(await page.locator('#shop-book').textContent(), '겨울의 기록');
    const day = parseInt(await page.locator('#shop-day').textContent(), 10);
    await page.clock.setFixedTime(start + 10000);
    await waitText(page, 'shop-clock', '00:00:05');
    await waitText(page, 'shop-day', (day + 1) + '일차');
    await page.locator('#open-settings').click();
    await page.locator('#shop-name').fill('달빛 서점');
    await page.locator('#shop-name-form button').click();
    await waitText(second, 'shop-title', '달빛 서점');
    await page.reload();
    await require('./browser.cjs').selectFolder(page);
    await waitText(page, 'shop-title', '달빛 서점');
    await page.setViewportSize({ width: 360, height: 740 });
    assert.ok(await page.evaluate(() => {
      const name = document.querySelector('#shop-title').getBoundingClientRect();
      const time = document.querySelector('#shop-clock').getBoundingClientRect();
      return name.right <= time.left && time.top < name.bottom && time.right <= innerWidth;
    }));
    await page.evaluate(async () => {
      const { bookTraffic, visitsAt, newShop } = await import('./shop.js');
      const { validateBackup, emptyState } = await import('./store.js');
      const { mergeImport, undoImport } = await import('./imports.js');
      const traffic = bookTraffic([{id:'old', text:'old', replies:[]}], 0);
      for (const t of [25000, 50000, 75000]) {
        if (visitsAt(traffic, t).length !== 1 || visitsAt(traffic, t + 19000).length) throw Error('return visits');
      }
      const legacy = validateBackup({...emptyState(), shop:newShop()});
      const fresh = emptyState();
      const {undo} = mergeImport(fresh, legacy, '2031-05-12');
      fresh.shop.name = '수정한 이름';
      if (!undoImport(fresh, undo, '2031-05-12').conflicts || !fresh.shop) throw Error('shop undo');
    });
    const population = await page.evaluate(async () => {
      const {bookTraffic, visitsAt} = await import('./shop.js');
      const memos = Array.from({length:50000}, (_, i) => ({id:'memo-' + i, text:String(i), replies:[]}));
      const traffic = bookTraffic(memos, 25000);
      const look = memo => visitsAt(bookTraffic([memo], 25000), 25000)[0].person;
      const before = look(memos[100]);
      const styles = new Set(memos.slice(0, 1000).map(memo => JSON.stringify(look(memo))));
      const after = look({...memos[100], text:'수정됨'});
      return {size:traffic.readers.length, visible:visitsAt(traffic, 25000).length,
        variants:styles.size, stable:JSON.stringify(before) === JSON.stringify(after)};
    });
    assert.equal(population.size, 50000);
    assert.ok(population.visible <= 15 && population.visible > 0);
    assert.ok(population.variants > 950 && population.stable);
    const frames = await page.evaluate(async () => {
      const { paintGuests } = await import('./ui/shop-scene.js');
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 152;
      const sheet = document.createElement('canvas');
      sheet.width = 80;
      sheet.height = 32;
      const person = { sprite: 3, hair:'#544', highlight:'#975', coat:'#788', shade:'#455' };
      const visitors = [{ person, at:0, seed:0, bestseller:false }];
      const ctx = canvas.getContext('2d');
      const draw = ctx.drawImage.bind(ctx);
      const cells = [];
      ctx.drawImage = (source, ...args) => {
        if (source === sheet) cells.push(args.slice(0, 2));
        draw(source, ...args);
      };
      for (const now of [1400, 8000, 16600]) paintGuests(canvas, visitors, now, false, [], sheet);
      sheet.width = 360;
      sheet.height = 64;
      for (const now of [600, 1000, 1400, 8000]) paintGuests(canvas, visitors, now, false, [], sheet);
      paintGuests(canvas, visitors, 600, true, [], sheet);
      return cells;
    });
    assert.deepEqual(frames.slice(0, 3), [[48,16], [48,0], [48,0]]);
    assert.ok(new Set(frames.slice(3, 6).map(cell => cell[0])).size > 1);
    assert.deepEqual(frames.slice(-2), [[216,0], [216,0]]);
    for (let count = 2; count > 0; count--) {
      await page.locator('#archive-list button').first().click();
      await page.locator('#delete-memo').click();
      await page.locator('#delete-confirm').click();
      await waitText(page, 'memo-count', String(count - 1));
    }
    await waitText(page, 'shop-crowd', '단골 0명 · 방문 중 0명');
    console.log('PASS  real local midnight, recurring memo guests, empty shop, bestseller and custom shop name');
  } finally {
    await page.close();
    await second.close();
  }
}

module.exports = {checkBookshop};
