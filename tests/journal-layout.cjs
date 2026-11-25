const assert = require('node:assert/strict');
const { openSection } = require('./browser.cjs');

async function checkJournalLayout(session) {
  const yesterday = await session.tab('2050-01-01');
  try {
    await yesterday.locator('#memo-input').fill('입간판에 걸어 둘 메모');
    await yesterday.locator('#memo-save').click();
    await yesterday.locator('#detail-original').getByText('입간판에 걸어 둘 메모').waitFor();
  } finally { await yesterday.close(); }
  const page = await session.tab('2050-01-02');
  const click = selector => page.locator(selector).click();
  try {
    await page.setViewportSize({ width: 360, height: 640 });
    await page.locator('#memo-input').fill('창가의 책을 다시 펼쳤다.');
    await click('#memo-save');
    await openSection(page, 'reply-compose');
    await page.locator('#reply-input').fill('책 사이에 편지가 있었다.');
    await click('#reply-save');
    await page.locator('#detail-replies').getByText('책 사이에 편지가 있었다.').waitFor();
    await click('#reply-compose > summary');
    await openSection(page, 'memo-tools');
    await click('#edit-memo');
    const actions = await page.locator('#memo-tools .detail-actions').boundingBox();
    const label = await page.locator('#edit-form label').boundingBox();
    assert.ok(label.y > actions.y + actions.height, 'editing label must clear the last button row');
    await click('#edit-cancel');
    await click('#detail-replies [data-action="delete"]');
    await click('#reply-dialog-confirm');
    await page.locator('#reply-compose > summary:focus').waitFor();
    await page.locator('.archive-entry').first().press('ArrowUp');
    await page.locator('#memo-search > summary:focus').waitFor();

    await openSection(page, 'folder-files');
    await click('#floor-link');
    await page.locator('#daily-request').getByText(/다시 찾아요$/).waitFor();
    await click('#defer-memo');
    await page.locator('#daily-empty').getByText('오늘은 다시 찾는 책을 접어두었어요.').waitFor();
    await click('#open-archive');
    await click('#open-settings');
    for (const id of ['storage-tools', 'backup-tools', 'about-tools']) await openSection(page, id);
    for (const width of [320, 360, 640, 768, 1280]) {
      await page.setViewportSize({ width, height: 640 });
      for (const selector of ['#scan-files', '#shop-name-form button']) {
        assert.equal(await page.locator(selector).evaluate(button => {
          const range = document.createRange();
          range.selectNodeContents(button);
          return range.getClientRects().length;
        }), 1, selector + ' should fit on one line at width ' + width);
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    await page.setViewportSize({ width: 360, height: 640 });
    const dialog = page.locator('#settings-dialog');
    const position = await page.evaluate(() => scrollY);
    await dialog.hover();
    await page.mouse.wheel(0, 1000);
    await page.waitForFunction(() => {
      const dialog = document.querySelector('#settings-dialog');
      return dialog.scrollTop > 0 && dialog.scrollTop + dialog.clientHeight >= dialog.scrollHeight - 1;
    });
    await page.mouse.wheel(0, 800);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(() => scrollY), position);
    assert.ok(await page.locator('#settings-close').evaluate(button => {
      const rect = button.getBoundingClientRect();
      return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === button;
    }));
    await click('#settings-close');
    await click('#floor-link');
    await page.locator('#floor-title:focus').waitFor();
    const day = await page.locator('#business-day').boundingBox();
    const header = await page.locator('.site-header').boundingBox();
    assert.ok(day.y >= header.y + header.height);
    console.log('PASS  journal button labels, edit spacing, keyboard focus, dialog scrolling and return to floor');
  } finally { await page.close(); }
}

module.exports = { checkJournalLayout };
