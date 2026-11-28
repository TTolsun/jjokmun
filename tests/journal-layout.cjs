const assert = require('node:assert/strict');
const { openSection } = require('./browser.cjs');
const {liftPet, layPet} = require('./pet-controls.cjs');

async function checkLiftRestore(page) {
  const launch = page.locator('#pet-expand');
  const journalLayout = () => page.locator('#journal').evaluate(node => {
    const {x, y, width, height} = node.getBoundingClientRect();
    return [x + scrollX, y + scrollY, width, height].map(Math.round);
  });
  const viewportContains = input => input.evaluate(node => {
    const rect = node.getBoundingClientRect();
    const headerBottom = document.querySelector('.site-header').getBoundingClientRect().bottom;
    return rect.top >= headerBottom - 1 && rect.bottom <= innerHeight + 1;
  });
  const selection = input => input.evaluate(node =>
    [node.value, node.selectionStart, node.selectionEnd, node.selectionDirection]);
  const fields = [
    ['#memo-input', '저장 전 메모 초안', 4, 4, 'none', 'c'],
    ['#reply-input', '저장 전 답장 초안', 2, 7, 'backward', 'Escape'],
    ['#edit-input', '편집한 원문 초안\n아직 저장하지 않은 둘째 줄', 2, 12, 'backward']
  ];
  for (const width of [1280, 320]) {
    await page.setViewportSize({width, height: 720});
    for (const [selector, draft, start, end, direction, closeKey] of fields) {
      if (selector === '#edit-input') await page.locator('#edit-memo').click();
      const input = page.locator(selector);
      await input.fill(draft);
      await input.evaluate((node, [start, end, direction]) => {
        node.focus();
        node.setSelectionRange(start, end, direction);
      }, [start, end, direction]);

      // At 320px the garden sits far below the editor. Users can scroll there while the editor stays focused.
      await launch.scrollIntoViewIfNeeded();
      assert.ok(await input.evaluate(node => document.activeElement === node));
      const saved = await selection(input);
      assert.deepEqual(saved.slice(0, 3), [draft, start, end]);
      if (direction === 'backward') assert.equal(saved[3], 'backward');
      const inputWasVisible = await viewportContains(input);
      const before = await journalLayout();
      const scrollBefore = await page.evaluate(() => scrollY);
      if (width === 320 || selector === '#edit-input') {
        await launch.focus();
        await page.keyboard.press('Enter');
        await page.locator('#pet-popover').waitFor();
      } else {
        await liftPet(page);
      }
      assert.equal(await launch.getAttribute('aria-expanded'), 'true');
      assert.deepEqual(await journalLayout(), before, 'lifting does not reflow the journal');
      assert.equal(await input.inputValue(), draft);
      if (closeKey) await page.keyboard.press(closeKey);
      else await layPet(page);
      await page.locator('#pet-popover').waitFor({state:'hidden'});
      await page.locator(selector + ':focus').waitFor();
      assert.equal(await launch.getAttribute('aria-expanded'), 'false');
      assert.deepEqual(await journalLayout(), before, 'putting the device down does not reflow the journal');
      assert.deepEqual(await selection(input), saved);
      if (width === 320 || !inputWasVisible) {
        assert.ok(await viewportContains(input), selector + ' comes back into view');
      } else {
        assert.equal(await page.evaluate(() => scrollY), scrollBefore);
      }
      if (selector === '#edit-input') await page.locator('#edit-cancel').click();
      else await input.fill('');
    }
  }
}

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
    for (const width of [1920, 1600, 1440, 1280, 861, 860, 320]) {
      await page.setViewportSize({width, height: 640});
      const pet = await page.locator('#pet').boundingBox();
      const journal = await page.locator('#journal').boundingBox();
      const list = await archive.boundingBox();
      const writing = await page.locator('#memo-input').boundingBox();
      assert.ok(pet && journal && list && writing, 'pet and journal are visible together');
      if (width >= 861) {
        assert.ok(pet.x + pet.width <= journal.x, 'the smaller pet is to the left of the journal');
        assert.ok(pet.width < journal.width, 'the journal is wider than the pet');
        const rail = await page.locator('.workspace').evaluate(node => {
          const style = getComputedStyle(node, '::before');
          return [node.getBoundingClientRect().left + parseFloat(style.left), parseFloat(style.width)];
        });
        assert.deepEqual(rail, [0, 224], 'the desktop garden does not grow into the outer margin');
        assert.equal(pet.width, rail[1]);
      } else {
        assert.ok(journal.y + journal.height <= pet.y, 'the journal precedes the pet on narrow screens');
        assert.ok(writing.y < 300, 'the memo composer starts near the top');
      }
      assert.ok(writing.y + writing.height < list.y, 'recent memos appear after the composer');
    }
    await page.setViewportSize({width: 1280, height: 640});
    const list = page.locator('#archive-list');
    await list.hover();
    const scroll = await page.evaluate(() => scrollY);
    await page.mouse.wheel(0, 180);
    await page.waitForFunction(() => document.querySelector('#archive-list').scrollTop > 0, null, {timeout: 10000});
    assert.equal(await page.evaluate(() => scrollY), scroll);
    await list.evaluate(node => { node.scrollTop = 0; });
    await page.locator('#detail-dialog').waitFor({state:'hidden'});
    await archive.locator('[data-memo-id="layout-24"]').click();
    assert.equal(await archive.locator('#detail-dialog:visible').count(), 1);
    assert.ok(await page.locator('#detail-dialog').evaluate(node => {
      const detail = node.getBoundingClientRect();
      const list = document.querySelector('#archive-list').getBoundingClientRect();
      return detail.top >= list.bottom;
    }), 'the memo and replies open below the recent list');
    const reply = page.locator('[data-reply-id="reply-16"] p');
    await reply.evaluate(node => node.scrollIntoView({block: 'center'}));
    assert.ok(await reply.evaluate(node => {
      const rect = node.getBoundingClientRect();
      return node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    }), 'the last reply stays uncovered');
    const latestRow = archive.locator('[data-memo-id="layout-24"]');
    await page.locator('#reply-input').fill('아직 보내지 않은 답장');
    await latestRow.click();
    await page.locator('#detail-dialog').waitFor({state:'hidden'});
    await latestRow.click();
    assert.equal(await page.locator('#reply-input').inputValue(), '아직 보내지 않은 답장');
    await page.locator('#edit-memo').click();
    await page.locator('#edit-input').fill('아직 저장하지 않은 원문');
    await latestRow.click();
    await page.locator('#detail-dialog').waitFor({state:'hidden'});
    await latestRow.click();
    assert.equal(await page.locator('#edit-input').inputValue(), '아직 저장하지 않은 원문');
    await page.locator('#edit-cancel').click();


    await page.setViewportSize({width: 630, height: 640});
    await toggle.waitFor();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    await archive.locator('[data-memo-id="layout-23"]').click();
    await page.locator('#detail-title:focus').waitFor();
    assert.equal(await page.locator('#detail-original').innerText(), '서가의 기록 23');
    assert.equal(await page.locator('[data-reply-id="reply-16"]').count(), 0);
    assert.equal(await page.locator('#reply-input').inputValue(), '');
    assert.equal(await archive.isVisible(), true);
    await archive.locator('[data-memo-id="layout-23"]').click();
    await page.locator('#detail-dialog').waitFor({state:'hidden'});
    await archive.locator('[data-memo-id="layout-23"]:focus').waitFor();
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(await archive.isVisible(), false);
    await page.keyboard.press('Control+k');
    await page.locator('#archive-search:focus').fill('서가의 기록 24');
    await page.keyboard.press('Enter');
    await page.locator('#detail-title:focus').waitFor();
    assert.equal(await page.locator('#detail-original').innerText(), '서가의 기록 24');
    assert.equal(await archive.isVisible(), true);
    await click('#memo-search > summary');
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
    assert.equal(await page.locator('#reply-dialog #pet-expand').count(), 0);
    await page.locator('#pet-expand').focus();
    assert.equal(await page.locator('#pet-expand:focus').count(), 0);
    await page.locator('#pet-popover').waitFor({state:'hidden'});
    await click('#reply-dialog-confirm');
    await page.locator('#reply-input:focus').waitFor();
    await page.locator('.archive-entry').first().press('ArrowUp');
    await page.locator('#memo-search > summary:focus').waitFor();

    await openSection(page, 'folder-files');
    await click('#open-settings');
    assert.equal(await page.locator('#settings-dialog :is(details, summary)').count(), 0);
    for (const selector of ['#choose-folder', '#export-backup', '#choose-backup', '#undo-import', '#developer-title']) {
      await page.locator(selector).waitFor();
    }
    for (const width of [320, 360, 640, 768, 1280]) {
      await page.setViewportSize({ width, height: 640 });
      assert.equal(await page.locator('#scan-files').evaluate(button => {
        const range = document.createRange();
        range.selectNodeContents(button);
        return range.getClientRects().length;
      }), 1, '#scan-files should fit on one line at width ' + width);
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
    assert.equal(await page.locator('#pet-link, #open-archive, #pet-memo-link').count(), 0);
    await archive.locator('[data-memo-id="layout-24"]').click();
    await page.locator('[data-reply-id="reply-16"]').waitFor();
    await checkLiftRestore(page);
    await page.locator('#pet-expand').focus();
    await page.keyboard.press('Control+k');
    await page.locator('#archive-search:focus').waitFor();
    await click('#memo-input');
    await page.locator('#memo-input:focus').waitFor();
    const sample = '산책 😊가나다라분홍빛 꽃을 봤다. ' + '천천히 걸었다. '.repeat(12);
    await page.locator('#memo-input').fill(sample);
    await click('#memo-save');
    await page.locator('#detail-original').getByText(sample.trim()).waitFor({state:'attached'});
    const current = await page.locator('#detail-path').innerText();
    await click('#edit-memo');
    await page.locator('#edit-input').fill('아직 저장하지 않은 원문');
    await page.locator('#reply-input').fill('아직 저장하지 않은 답장');
    await archive.locator('[data-memo-id="layout-23"]').click();
    await page.keyboard.press('Control+k');
    await page.locator('#archive-search').fill('분홍빛');
    assert.equal(await page.locator('#delete-memo').isVisible(), false);
    assert.ok((await page.locator('.archive-text').innerText()).includes('😊가나다라분홍빛'));
    await click('.archive-entry');
    assert.equal(await page.locator('#edit-input').inputValue(), '아직 저장하지 않은 원문');
    assert.equal(await page.locator('#reply-input').inputValue(), '아직 저장하지 않은 답장');
    await click('#edit-cancel');
    await click('#delete-memo');
    assert.equal(await page.locator('#delete-target').innerText(), current);
    await click('#delete-cancel');
    console.log('PASS  inline notes and replies, narrow-screen scrolling, and cursor and focus restoration after lifting');
  } finally { await page.close(); }
}

module.exports = { checkJournalLayout };
