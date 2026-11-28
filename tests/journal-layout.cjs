const assert = require('node:assert/strict');
const { openSection } = require('./browser.cjs');

async function checkJournalLayout(session) {
  const yesterday = await session.tab('2050-01-01');
  try {
    await yesterday.evaluate(async () => {
      const { transact } = await import('./vault.js');
      await transact(state => {
        for (let n = 1; n <= 24; n++) {
          state.memos.push({ id: 'layout-' + n, text: '서가의 기록 ' + n, createdOn: '2050-01-01', updatedAt: n, replies: [] });
        }
        const memo = state.memos.at(-1);
        for (let n = 1; n <= 16; n++) {
          memo.replies.push({ id: 'reply-' + n, text: '서가를 다시 찾은 날 ' + n, createdOn: memo.createdOn, createdAt: n });
        }
      });
    });
    await yesterday.locator('#memo-input').fill('입간판에 걸어 둘 메모');
    await yesterday.locator('#memo-save').click();
    await yesterday.locator(':is(#detail-original, #detail-preview):visible').getByText('입간판에 걸어 둘 메모').waitFor();
  } finally { await yesterday.close(); }
  const page = await session.tab('2050-01-02');
  const click = selector => page.locator(selector).click();
  try {
    const archive = page.locator('.archive');
    const toggle = page.locator('#archive-toggle');
    for (const width of [1280, 631]) {
      await page.setViewportSize({ width, height: 640 });
      await page.evaluate(() => window.scrollTo(0, 0));
      const list = await archive.boundingBox();
      const writing = await page.locator('#memo-input').boundingBox();
      assert.ok(list.x + list.width <= writing.x && list.y <= writing.y, 'archive starts beside the composer');
      await archive.locator('[data-memo-id="layout-24"]').click();
      const reply = page.locator('[data-reply-id="reply-16"] p');
      await reply.evaluate(node => node.scrollIntoView({ block: 'center' }));
      assert.ok(await page.evaluate(() => scrollY > 0));
      const reading = await reply.boundingBox();
      const sidebar = await archive.boundingBox();
      assert.ok(sidebar.x + sidebar.width <= reading.x && sidebar.y >= 0 && sidebar.y < reading.y);
      assert.ok(await reply.evaluate(node => {
        const rect = node.getBoundingClientRect();
        return node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
      }), 'the last reply stays uncovered');
      const scroll = await page.evaluate(() => scrollY);
      await archive.hover();
      await page.mouse.wheel(0, 180);
      await page.waitForFunction(() => document.querySelector('.archive').scrollTop > 0);
      assert.equal(await page.evaluate(() => scrollY), scroll);
      await archive.evaluate(node => { node.scrollTop = 0; });
    }
    await page.setViewportSize({ width: 630, height: 640 });
    await toggle.waitFor();
    assert.equal(await archive.isVisible(), false);
    await toggle.click();
    await archive.locator('[data-memo-id="layout-23"]').click();
    await page.locator('#detail-title:focus').waitFor();
    assert.equal(await page.locator('#detail-original').innerText(), '서가의 기록 23');
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(await archive.isVisible(), false);
    await page.keyboard.press('Control+k');
    await page.locator('#archive-search:focus').fill('서가의 기록 24');
    await page.keyboard.press('Enter');
    await page.locator('#detail-title:focus').waitFor();
    assert.equal(await page.locator('#detail-original').innerText(), '서가의 기록 24');
    assert.equal(await archive.isVisible(), false);
    await toggle.click();
    await click('#memo-search > summary');
    await toggle.click();
    await page.setViewportSize({ width: 360, height: 640 });
    await page.locator('#memo-input').fill('창가의 책을 다시 펼쳤다.');
    await click('#memo-save');
    await page.locator(':is(#detail-original, #detail-preview):visible')
      .getByText('창가의 책을 다시 펼쳤다.', {exact: true}).waitFor();
    const detail = page.locator('#detail-dialog');
    assert.equal(await detail.locator('summary').filter({ hasText: /답장 쓰기|메모·답장 관리/ }).count(), 0);
    assert.equal(await detail.getByText(/새 단골 · 정 0/).count(), 0);
    await detail.getByRole('textbox', { name: '답장 쓰기' }).fill('책 사이에 편지가 있었다.');
    await click('#reply-save');
    await page.locator('#detail-replies').getByText('책 사이에 편지가 있었다.').waitFor();
    await click('#edit-memo');
    const actions = await page.locator('#memo-tools .detail-actions').boundingBox();
    const label = await page.locator('#edit-form label').boundingBox();
    assert.ok(label.y > actions.y + actions.height, 'editing label must clear the last button row');
    await click('#edit-cancel');
    await click('#detail-replies [data-action="delete"]');
    await click('#reply-dialog-confirm');
    await page.locator('#reply-input:focus').waitFor();
    await toggle.click();
    await page.locator('.archive-entry').first().press('ArrowUp');
    await page.locator('#memo-search > summary:focus').waitFor();

    await openSection(page, 'folder-files');
    await click('#floor-link');
    await page.locator('#daily-request').getByText(/다시 찾아요$/).waitFor();
    await click('#defer-memo');
    await page.locator('#daily-empty').getByText('오늘은 다시 찾는 책을 접어두었어요.').waitFor();
    await click('#open-archive');
    await toggle.click();
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
