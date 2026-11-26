const { openSection } = require('./browser.cjs');
const assert = require('node:assert/strict');

async function checkGuestVisit(session) {
  const first = await session.tab('2031-05-12', 'test-vault', 'floor');
  const second = await session.tab('2031-05-12', 'test-vault', 'floor');
  const note = '떨리는 손으로 연필을 쥐었다.';
  const story = '다음 날에는 창가에 앉아 나무를 그렸다.';
  const stateOf = page => page.evaluate(async () => (await (await import('./vault.js')).readPayload()).payload.state);
  try {
    await first.locator('#guest-input').waitFor();
    assert.match(await first.locator('#guest-speech').innerText(), /그날 이야기를/);
    assert.equal(await first.locator('#guest-choose').isVisible(), false);
    await first.locator('#guest-input').fill(note);
    await first.locator('#guest-submit').click();
    await first.locator('#guest-page').getByText(note, { exact: true }).waitFor();
    assert.match(await first.locator('#guest-reaction').innerText(), /제 연필/);
    await second.locator('#guest-page').waitFor();
    assert.equal(await second.locator('#guest-form').isVisible(), false);
    await first.evaluate(() => window.dispatchEvent(new Event('focus')));
    assert.equal(await first.locator('#guest-form').isVisible(), false);

    await second.reload();
    await second.getByRole('button', { name: '뒷이야기 건네기' }).waitFor();
    assert.equal(await second.locator('#guest-page').innerText(), note);
    assert.match(await second.locator('#guest-reaction').innerText(), /다시 그려/);
    await second.locator('#guest-input').fill(story);
    await second.locator('#guest-input').press('Enter');
    await first.locator('#guest-reaction').getByText('“' + story + '”', { exact: true }).waitFor();
    const state = await stateOf(first);
    assert.equal(state.memos.length, 1);
    assert.equal(state.memos[0].id, state.shop.guestMemoId);
    assert.deepEqual(state.memos[0].replies.map(reply => [reply.id, reply.text]), [[state.shop.guestReplyId, story]]);
    await first.evaluate(async state => {
      const { emptyState, validateBackup } = await import('./store.js');
      const { mergeImport, undoImport } = await import('./imports.js');
      const restored = emptyState();
      const { undo } = mergeImport(restored, validateBackup(state), '2031-05-12');
      if (validateBackup(restored).shop.guestReplyId !== state.shop.guestReplyId) throw Error('guest restore');
      undoImport(restored, undo, '2031-05-12');
      if (restored.shop || restored.memos.length) throw Error('guest undo');
    }, state);
    await second.reload();
    await second.locator('#guest-reaction').getByText('“' + story + '”', { exact: true }).waitFor();
    await second.locator('#open-archive').click();
    await openSection(second, 'memo-tools');
    await second.getByRole('button', { name: '답장 삭제' }).click();
    await second.locator('#reply-dialog-confirm').click();
    await second.locator('#floor-link').click();
    await second.getByRole('button', { name: '뒷이야기 건네기' }).waitFor();
    await second.locator('#open-archive').click();
    await openSection(second, 'memo-tools');
    await second.locator('#delete-memo').click();
    await second.locator('#delete-confirm').click();
    await first.getByRole('button', { name: '글 건네기', exact: true }).waitFor();

    const picked = '어제는 동네 산책을 시작했다.';
    for (const [index, text] of [picked, '오늘 적은 다른 메모'].entries()) {
      await first.locator('#floor-memo-input').fill(text);
      await first.locator('#floor-memo-save').click();
      await first.waitForFunction(async count => (await (await import('./vault.js')).readPayload()).payload.state.memos.length === count, index + 1);
    }
    await first.locator('#guest-choose').click();
    await first.locator('#archive-list button').filter({ hasText: picked }).click();
    await first.locator(':is(#detail-original, #detail-preview):visible').getByText(picked, {exact: true}).waitFor();
    await first.locator('#give-memo').click();
    await first.locator('#guest-page').getByText(picked, { exact: true }).waitFor();
    assert.match(await first.locator('#guest-reaction').innerText(), /골목/);
    assert.equal((await stateOf(first)).memos.length, 2);
    console.log('PASS  first guest, existing recommendation, return visit, linked reply, restore and deletion');
  } finally {
    await first.close();
    await second.close();
  }
}

module.exports = { checkGuestVisit };
