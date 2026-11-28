const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {launch} = require('./browser.cjs');
const {petAction, layPet} = require('./pet-controls.cjs');
const {seedEncryptedVault} = require('./legacy-vault.cjs');

const date = '2033-03-02';
const source = '기존 기록';
const target = '새 기록';
const password = 'sample legacy password';
const backupPass = 'sample backup password';

async function snapshot(page) {
  return page.evaluate(async () => {
    const {transact} = await import('./vault.js');
    const {digest} = await import('./documents.js');
    const state = await transact();
    const memos = await Promise.all(state.memos.map(async memo => ({
      id: memo.id, text: await digest(new TextEncoder().encode(memo.text)), length: memo.text.length, replies: memo.replies
    })));
    return {memos, pet: state.pet};
  });
}

async function chooseCopy(page) {
  await page.locator('#open-settings').click();
  await page.evaluate(name => {
    window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle(name, {create:true});
  }, target);
  await page.locator('#copy-vault').click();
  await page.locator('#vault-copy-description').getByText(new RegExp(target)).waitFor();
}

async function checkVaultCopy() {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'jjokmun-copy-'));
  let session, fresh;
  try {
    session = await launch(profile);
    let page = await session.tab(date, source);
    await page.locator('#memo-input').fill('편집할 원본');
    await page.locator('#memo-save').click();
    await page.locator('#reply-input').fill('첫 메모의 답장');
    await page.locator('#reply-save').click();
    await page.locator('#detail-replies').getByText('첫 메모의 답장').waitFor();
    const originalPath = await page.locator('#detail-path').innerText();
    await petAction(page, 'adopt');
    await page.locator('#pet-lcd-name').getByText('알', {exact:true}).waitFor();
    await layPet(page);
    await seedEncryptedVault(page, password);
    await page.evaluate(async path => {
      const {folderConnection, transact} = await import('./vault.js');
      const file = await folderConnection().directory.getFileHandle(path);
      const writer = await file.createWritable();
      await writer.write('외부 편집본');
      await writer.close();
      await transact(state => {
        state.memos[0].text = '쪽문에서 수정한 문서';
        state.memos.push({ id:'large-memo', text:'a'.repeat(4 * 1024 * 1024 + 1), createdOn:'2033-03-02',
          updatedAt:1, replies:[{id:'large-reply', text:'큰 메모의 답장', createdOn:'2033-03-02', createdAt:2}] });
      });
    }, originalPath);
    const expected = await snapshot(page);
    const encryptedBytes = () => page.evaluate(async name => {
      const source = await (await navigator.storage.getDirectory()).getDirectoryHandle(name);
      const file = await source.getFileHandle('jjokmun-vault.json');
      return (await import('./documents.js')).digest(await (await file.getFile()).arrayBuffer());
    }, source);
    const initialBytes = await encryptedBytes();
    await chooseCopy(page);
    assert.equal(await page.evaluate(async name => {
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(name);
      return (await dir.keys().next()).done;
    }, target), true, 'confirmation precedes plaintext writes');
    await page.evaluate(target => {
      const query = FileSystemDirectoryHandle.prototype.queryPermission;
      FileSystemDirectoryHandle.prototype.queryPermission = function(options) {
        if (this.name === target) {
          FileSystemDirectoryHandle.prototype.queryPermission = query;
          return Promise.resolve('denied');
        }
        return query.call(this, options);
      };
    }, target);
    await page.locator('#vault-copy-confirm').click();
    await page.locator('#vault-copy-status').getByText(/읽기와 쓰기를 허용/).waitFor();
    await page.evaluate(() => {
      const original = FileSystemFileHandle.prototype.createWritable;
      let calls = 0;
      FileSystemFileHandle.prototype.createWritable = function(...args) {
        if (++calls === 3) {
          FileSystemFileHandle.prototype.createWritable = original;
          throw new DOMException('테스트 저장 공간 부족', 'QuotaExceededError');
        }
        return original.apply(this, args);
      };
    });
    await page.locator('#vault-copy-confirm').click();
    await page.locator('#vault-copy-status').getByText(/복사를 마치지 못했습니다/).waitFor();
    assert.equal(await encryptedBytes(), initialBytes);
    await page.close();
    page = await session.tab(date, source);
    await page.locator('#unlock-password').fill(password);
    await page.locator('#unlock-submit').click();
    await chooseCopy(page);
    await page.locator('#vault-copy-confirm').click();
    await page.locator('#home-status').getByText(/복사한 메모, 답장, 펫 기록을 확인/).waitFor();
    assert.equal(await encryptedBytes(), initialBytes);
    const copies = await page.evaluate(async ({source, target, path}) => {
      const root = await navigator.storage.getDirectory();
      const result = [];
      for (const name of [source, target]) {
        const dir = await root.getDirectoryHandle(name);
        result.push(await (await (await dir.getFileHandle(path)).getFile()).text());
      }
      return result;
    }, {source, target, path:originalPath});
    assert.deepEqual(copies, ['외부 편집본', '쪽문에서 수정한 문서']);
    assert.deepEqual(session.external, []);
    await session.context.close();
    session = await launch(profile);
    page = await session.tab(date, target);
    assert.deepEqual(await snapshot(page), expected);
    await page.locator('#memo-input').evaluate(input => {
      input.value = 'b'.repeat(4 * 1024 * 1024 + 1);
      input.form.requestSubmit();
    });
    await page.locator('#home-status').getByText(/4 MiB/).waitFor();
    assert.deepEqual(await snapshot(page), expected);
    await page.locator('#memo-input').fill('');
    await page.locator('#open-settings').click();
    await page.locator('#export-backup').click();
    await page.locator('#backup-password').fill(backupPass);
    await page.locator('#backup-password-confirm').fill(backupPass);
    const downloaded = page.waitForEvent('download');
    await page.locator('#backup-password-submit').click();
    const backup = await fs.readFile(await (await downloaded).path());
    fresh = await launch('');
    const restored = await fresh.tab(date, '복원');
    await restored.locator('#open-settings').click();
    await restored.locator('#import-backup').setInputFiles({name:'backup.json', mimeType:'application/json', buffer:backup});
    await restored.locator('#backup-password').fill(backupPass);
    await restored.locator('#backup-password-submit').click();
    await restored.locator('#import-confirm').click();
    await restored.locator('#import-preview-dialog').waitFor({state:'hidden'});
    await restored.reload();
    await restored.locator('#open-settings').waitFor();
    assert.deepEqual(await snapshot(restored), expected);
    // Open the original again after migration using its original password.
    await page.evaluate(async name => {
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(name);
      await (await import('./vault.js')).useFolder(dir, {reopen:true});
    }, source);
    await page.reload();
    await page.locator('#unlock-password').fill(password);
    await page.locator('#unlock-submit').click();
    await page.locator('#lock-screen').waitFor({state:'hidden'});
    assert.deepEqual(await snapshot(page), expected);
    assert.deepEqual([...session.external, ...fresh.external], []);
    console.log('PASS  legacy vault copy, interrupted retry, external conflict, oversized memo and encrypted backup round trip');
  } finally {
    await fresh?.context.close();
    await session?.context.close();
    await fs.rm(profile, {recursive:true, force:true, maxRetries:3, retryDelay:100});
  }
}

module.exports = {checkVaultCopy};
if (require.main === module) checkVaultCopy().catch(error => { console.error(error); process.exitCode = 1; });
