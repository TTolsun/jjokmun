const { openSection } = require('./browser.cjs');
const assert = require('node:assert/strict');

// The owner's pick sits on the shop floor next to the books that customers buy.
async function checkBookshop(session) {
  const page = await session.tab();
  const second = await session.tab(undefined, 'test-vault', 'floor');
  const waitText = (tab, id, value) => tab.waitForFunction(([id, value]) =>
    document.getElementById(id).textContent === value, [id, value]);
  const pick = async name => {
    await page.locator('#archive-list button').filter({hasText:name}).click();
    await page.locator('#display-memo').click();
    await waitText(page, 'detail-status', '책방 매대에 추천글을 올렸어요.');
    assert.equal(await page.locator('#display-memo').textContent(), '책방에서 보기');
    await waitText(second, 'business-pick', name);
  };
  try {
    assert.equal(await second.locator('.owners-pick').isVisible(), false);
    for (const name of ['봄의 기록', '겨울의 기록']) {
      await page.locator('#memo-input').fill(name);
      await page.locator('#memo-save').click();
      await page.locator('#detail-original').getByText(name).waitFor();
    }
    await pick('겨울의 기록');
    await page.locator('#archive-list button').filter({hasText:'봄의 기록'}).click();
    assert.match(await page.locator('#shelf-previous').innerText(), /겨울의 기록/);
    // Commit a remote shelf change before its notification reaches this tab.
    await second.evaluate(async () => {
      const {readPayload} = await import('./vault.js');
      await readPayload(draft => { delete draft.shop.displayMemoId; });
    });
    await page.getByRole('button', {name:'이 글로 교체하기'}).click();
    await waitText(page, 'detail-status', '다른 탭에서 매대의 글이 바뀌었어요. 교체할 글을 다시 확인해 주세요.');
    await second.locator('.owners-pick').waitFor({state:'hidden'});
    await pick('봄의 기록');
    await page.getByRole('button', {name:'책방에서 보기'}).click();
    await page.locator('#business-pick').getByText('봄의 기록').waitFor();
    await page.locator('#open-archive').click();
    await page.locator('#open-settings').click();
    await page.locator('#shop-name').fill('달빛 서점');
    await page.locator('#shop-name-form button').click();
    await waitText(second, 'floor-title', '달빛 서점');
    await second.reload();
    await waitText(second, 'floor-title', '달빛 서점');
    await waitText(second, 'business-pick', '봄의 기록');
    await page.locator('#settings-close').click();
    await page.evaluate(async () => {
      const { newShop } = await import('./shop.js');
      const { validateBackup, emptyState } = await import('./store.js');
      const { mergeImport, undoImport } = await import('./imports.js');
      const legacy = validateBackup({...emptyState(), shop:newShop()});
      const fresh = emptyState();
      const {undo} = mergeImport(fresh, legacy, '2031-05-12');
      fresh.shop.name = '수정한 이름';
      if (!undoImport(fresh, undo, '2031-05-12').conflicts || !fresh.shop) throw Error('shop undo');

      const day = '2031-05-12';
      const note = {id: 'display', text: '진열할 글', createdOn: day, updatedAt: 1, replies: []};
      const backup = validateBackup({...emptyState(), memos: [note], shop: {...newShop(), displayMemoId: note.id}});
      const restored = emptyState();
      const restoredUndo = mergeImport(restored, backup, day).undo;
      if (validateBackup(restored).shop.displayMemoId !== note.id) throw Error('display restore');
      undoImport(restored, restoredUndo, day);
      if (restored.shop || restored.memos.length) throw Error('display restore undo');
      const manual = {...emptyState(), shop: newShop()};
      const manualUndo = mergeImport(manual, backup, day).undo;
      manual.shop.displayMemoId = note.id;
      undoImport(manual, manualUndo, day);
      if (validateBackup(manual).memos[0]?.id !== note.id) throw Error('later display choice lost');
      const collision = {...emptyState(), memos: [{...note, createdOn: '2031-05-11'}]};
      mergeImport(collision, backup, day);
      if (validateBackup(collision).shop.displayMemoId) throw Error('display points to conflicting memo');
    });
    await page.setViewportSize({ width: 360, height: 740 });
    for (let count = 2; count > 0; count--) {
      await page.locator('#archive-toggle').click();
      await page.locator('#archive-list button').first().click();
      await openSection(page, 'memo-tools');
      await page.locator('#delete-memo').click();
      await page.locator('#delete-confirm').click();
      await waitText(page, 'memo-count', String(count - 1));
    }
    await second.locator('.owners-pick').waitFor({state:'hidden'});
    console.log('PASS  owner pick on the floor, multi-tab selection, shop name, restore and deletion');
  } finally {
    await page.close();
    await second.close();
  }
}

module.exports = {checkBookshop};
