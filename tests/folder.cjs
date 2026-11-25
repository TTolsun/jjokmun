const {selectFolder} = require('./browser.cjs');
const assert = require('node:assert/strict');

async function checkFolder(session) {
  const page = await session.tab(undefined, null);
  await page.locator('#choose-first-folder').waitFor();
  await page.evaluate(() => { window.showDirectoryPicker = () => Promise.reject(new DOMException('취소', 'AbortError')); });
  await page.locator('#choose-first-folder').click();
  assert.equal(await page.locator('.workspace').isVisible(), false);
  assert.equal(await page.evaluate(async () => (await indexedDB.databases()).length), 0);
  await selectFolder(page);
  try {
    await page.locator('#memo-input').fill('옮길 메모');
    await page.locator('#memo-save').click();
    await page.locator('#detail-original').getByText('옮길 메모').waitFor();
    await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const library = await root.getDirectoryHandle('내 책장', {create:true});
      const shelf = await library.getDirectoryHandle('서가', {create:true});
      const deep = await shelf.getDirectoryHandle('하단', {create:true});
      async function file(parent, name, data) {
        const handle = await parent.getFileHandle(name, {create:true});
        const writer = await handle.createWritable();
        await writer.write(data);
        await writer.close();
      }
      await file(library, '안내.txt', '첫 안내');
      await file(shelf, '안내.txt', '둘째 안내');
      await file(deep, 'code.cpp', 'int main() { return 0; }');
      await file(deep, '목록.json', '{}');
      await file(deep, '책.md', '# 책');
      await file(deep, 'unknown', new Uint8Array([0, 255, 17]));
      window.showDirectoryPicker = async () => library;
    });
    await page.locator('#open-settings').click();
    await page.locator('#choose-folder').click();
    await page.locator('#file-list button').nth(5).waitFor();
    assert.equal(await page.locator('#file-list button').count(), 6);
    for (const [name, text] of [['안내.txt','첫 안내'], ['서가/안내.txt','둘째 안내'], ['서가/하단/code.cpp','int main() { return 0; }']]) {
      await page.getByRole('button', {name, exact:true}).click();
      await page.waitForFunction(text => document.querySelector('#file-content').textContent === text, text);
      await page.locator('#file-close').click();
    }
    await page.getByRole('button', {name:'서가/하단/unknown', exact:true}).click();
    await page.locator('#file-download[href]').waitFor();
    const downloaded = page.waitForEvent('download');
    await page.locator('#file-download').click();
    assert.deepEqual(await require('node:fs/promises').readFile(await (await downloaded).path()), Buffer.from([0,255,17]));
    await page.locator('#file-close').click();
    await page.locator('#open-settings').click();
    await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const damaged = await root.getDirectoryHandle('손상된 책방', {create:true});
      const file = await damaged.getFileHandle('jjokmun-vault.json', {create:true});
      const stream = await file.createWritable();
      await stream.write('{}');
      await stream.close();
      window.showDirectoryPicker = async () => damaged;
    });
    await page.locator('#choose-folder').click();
    await page.getByText('쪽문 저장 파일의 형식을 확인해 주세요.').waitFor();
    await page.reload();
    await page.locator('#file-list button').nth(5).waitFor();
    await page.locator('#detail-original').getByText('옮길 메모').waitFor();
    const another = await session.tab(undefined, null);
    try {
      await another.locator('#memo-input').waitFor();
      const write = (tab, text) => tab.evaluate(async text => {
        await (await import('./vault.js')).transact(state => {
          state.memos.push({id:crypto.randomUUID(), text, createdOn:'2026-11-25', updatedAt:1, replies:[]});
        });
      }, text);
      await Promise.all([write(page,'같은 폴더 A'), write(another,'같은 폴더 B')]);
    } finally { await another.close(); }
    await page.evaluate(async () => {
      const vault = await import('./vault.js');
      const {directory} = await vault.folderConnection();
      const file = await directory.getFileHandle('jjokmun-vault.json');
      const original = await (await file.getFile()).text();
      const write = FileSystemFileHandle.prototype.createWritable;
      FileSystemFileHandle.prototype.createWritable = () => Promise.reject(new Error('test write failure'));
      try {
        let rejected = false;
        try { await vault.transact(state => { state.memos = []; }); } catch { rejected = true; }
        if (!rejected) throw Error('write failure must propagate');
      } finally { FileSystemFileHandle.prototype.createWritable = write; }
      if (original !== await (await file.getFile()).text()) throw Error('data lost on failed write');
      const query = FileSystemDirectoryHandle.prototype.queryPermission;
      FileSystemDirectoryHandle.prototype.queryPermission = async () => 'prompt';
      window.dispatchEvent(new Event('focus'));
      window.restoreFolderPermission = () => { FileSystemDirectoryHandle.prototype.queryPermission = query; };
    });
    await page.locator('#storage-reconnect').waitFor();
    assert.equal(await page.locator('#file-list').textContent(), '');
    await page.evaluate(() => window.restoreFolderPermission());
    await page.locator('#storage-reconnect').click();
    await page.locator('#file-list button').nth(5).waitFor();
    const stored = await page.evaluate(async () => {
      const vault = await import('./vault.js');
      const folder = await vault.folderConnection();
      const handle = await folder.directory.getFileHandle('jjokmun-vault.json');
      const read = async () => JSON.parse(await (await handle.getFile()).text());
      const titles = (await read()).payload.state.memos.map(m => m.text);
      const profileState = (await indexedDB.databases()).find(db => db.name === 'memo-alley');
      await vault.enableVault('sample folder password');
      const encrypted = await read();
      await vault.lockVault();
      await vault.unlockVault('sample folder password');
      return {titles, profileState, encrypted, decrypted:(await vault.transact()).memos.length};
    });
    assert.deepEqual(stored.titles.sort(), ['옮길 메모','같은 폴더 A','같은 폴더 B'].sort());
    assert.equal(stored.profileState, undefined);
    assert.equal(stored.encrypted.mode, 'encrypted');
    assert.equal(stored.encrypted.payload, undefined);
    assert.equal(stored.decrypted, 3);
    const retry = await session.context.newPage();
    try {
      await retry.addInitScript(() => {
        let permission = 'prompt';
        window.permissionRequests = 0;
        FileSystemDirectoryHandle.prototype.queryPermission = async () => permission;
        FileSystemDirectoryHandle.prototype.requestPermission = async () => {
          window.permissionRequests++;
          return permission = window.permissionRequests === 1 ? 'denied' : 'granted';
        };
      });
      await retry.goto(session.home);
      const reconnect = retry.getByRole('button', {name:'내 책장 다시 연결'});
      await reconnect.waitFor();
      assert.equal(await retry.evaluate(() => window.permissionRequests), 0);
      await reconnect.click();
      await retry.waitForFunction(() => window.permissionRequests === 1 && !document.querySelector('#reopen-last-folder').disabled);
      assert.equal(await retry.locator('.workspace').isVisible(), false);
      await reconnect.click();
      await retry.locator('#lock-screen').waitFor();
      assert.equal(await retry.evaluate(() => window.permissionRequests), 2);
    } finally { await retry.close(); }
    await page.evaluate(async () => {
      const {directory} = (await import('./vault.js')).folderConnection();
      await directory.removeEntry('jjokmun-vault.json');
    });
    await page.reload();
    await page.getByText(/jjokmun-vault.json 파일을 찾을 수 없습니다/).waitFor();
    await page.evaluate(() => {
      window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('내 책장');
    });
    await page.locator('#choose-first-folder').click();
    await page.waitForFunction(() => !document.querySelector('#choose-first-folder').disabled);
    assert.equal(await page.locator('#storage-start').isVisible(), true);
    const remainingFiles = await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const directory = await root.getDirectoryHandle('내 책장');
      return Array.fromAsync(directory.keys());
    });
    assert.ok(!remainingFiles.includes('jjokmun-vault.json'));
    await selectFolder(page, 'test-vault');
    await page.locator('#detail-original').getByText('옮길 메모').waitFor();
    console.log('PASS  automatic folder restore, permission retry, encrypted startup and missing vault recovery');
    console.log('PASS  folder migration, nested text/source/binary files, reload, concurrent writes and encrypted disk record');
  } finally { await page.close(); }
}
module.exports = {checkFolder};
