const assert = require('node:assert/strict');
const {openSection, selectFolder} = require('./browser.cjs');

const folder = '일반 문서';

function disk(page, action, filename, value) {
  return page.evaluate(async ({folder, action, filename, value}) => {
    const root = await navigator.storage.getDirectory();
    let directory = await root.getDirectoryHandle(folder, {create: true});
    const parts = filename.split('/');
    const basename = parts.pop();
    for (const part of parts) directory = await directory.getDirectoryHandle(part, {create: true});
    if (action === 'has') return (await Array.fromAsync(directory.keys())).includes(basename);
    if (action === 'list') return Array.fromAsync(directory.keys());
    if (action === 'remove') return directory.removeEntry(basename);
    const handle = await directory.getFileHandle(basename, {create: action === 'write'});
    if (action === 'read') return Array.from(new Uint8Array(await (await handle.getFile()).arrayBuffer()));
    const stream = await handle.createWritable();
    await stream.write(typeof value === 'string' ? value : Uint8Array.from(value));
    await stream.close();
  }, {folder, action, filename, value});
}

async function expectBytes(page, name, expected) {
  assert.deepEqual(Buffer.from(await disk(page, 'read', name)), Buffer.from(expected));
}

async function failNextWrite(page, filename) {
  await page.evaluate(filename => {
    const prototype = FileSystemFileHandle.prototype;
    const createWritable = prototype.createWritable;
    prototype.createWritable = async function (...args) {
      if (this.name !== filename) return createWritable.apply(this, args);
      prototype.createWritable = createWritable;
      const writer = await createWritable.apply(this, args);
      const write = writer.write.bind(writer);
      writer.write = async data => {
        await write(data);
        throw new DOMException('Synthetic staged write failure', 'QuotaExceededError');
      };
      return writer;
    };
  }, filename);
}

async function openDocument(page, name) {
  await openSection(page, 'memo-search');
  await page.locator('#archive-list button').filter({has: page.getByText(name, {exact: true})}).click();
  await page.waitForFunction(name => document.querySelector('#detail-path').textContent === name, name);
}

async function refreshDocuments(page) {
  await openSection(page, 'memo-search');
  await page.locator('#refresh-documents').click();
}

async function openEditor(page) {
  await page.locator('#edit-memo').click();
}

async function checkDocuments(session) {
  let page = await session.tab('2031-05-12', null);
  const plain = '\ufeff첫 줄\r\n둘째 줄\r\n';
  const markdown = '# 문서 제목\n\n**문서 본문**\n';
  const reply = '문서를 옮겨도 보이는 답장';
  const edited = '수정한 첫 줄\n둘째 줄\n';
  const moved = '새 서가/안내.txt';
  const appended = '옮긴 뒤 외부에서 추가한 셋째 줄\r\n';
  try {
    await page.locator('#choose-first-folder').waitFor();
    await disk(page, 'write', '안내.txt', plain);
    await disk(page, 'write', '서가/안내.txt', '서가에 있는 다른 설명');
    await disk(page, 'write', '서가/책.md', markdown);
    await disk(page, 'write', '서가/무시.json', '{}');
    await selectFolder(page, folder);
    await openDocument(page, '안내.txt');
    assert.match(await page.locator('#detail-original').textContent(), /첫 줄[\r\n]+둘째 줄/);
    await openDocument(page, '서가/안내.txt');
    assert.equal(await page.locator('#detail-original').textContent(), '서가에 있는 다른 설명');
    await openDocument(page, '서가/책.md');
    assert.equal(await page.locator('#detail-original').textContent(), markdown);
    assert.equal(await page.locator('#archive-list button').count(), 3);
    await page.locator('#archive-search').fill('서가/안내.txt');
    assert.equal(await page.locator('#archive-list button').count(), 1);
    await page.locator('#archive-search').fill('');
    await expectBytes(page, '안내.txt', plain);
    await expectBytes(page, '서가/책.md', markdown);
    await expectBytes(page, '서가/무시.json', '{}');

    const newText = '새 마크다운 메모';
    const beforeCreation = await disk(page, 'list', '');
    await page.locator('#memo-input').fill(newText);
    await failNextWrite(page, 'jjokmun-vault.json');
    await page.locator('#memo-save').click();
    await page.locator('#memo-save:enabled').waitFor();
    assert.match(await page.locator('#home-status').textContent(), /저장 공간이 부족/);
    assert.equal(await page.locator('#memo-input').inputValue(), newText);
    assert.deepEqual((await disk(page, 'list', '')).sort(), beforeCreation.sort());
    await refreshDocuments(page);
    assert.equal(await page.locator('#archive-list button').filter({hasText: newText}).count(), 0);
    await page.locator('#memo-save').click();
    await page.locator(':is(#detail-original, #detail-preview):visible').getByText(newText, {exact: true}).waitFor();
    assert.equal(await page.locator('#archive-list button').filter({hasText: newText}).count(), 1);
    const createdPath = await page.locator('#detail-path').textContent();
    assert.match(createdPath, /\.md$/);
    const generated = await disk(page, 'list', '');
    assert.equal(generated.filter(name => name.endsWith('.md')).length, 1);
    const [newMarkdown] = generated.filter(name => name.endsWith('.md'));
    assert.match(Buffer.from(await disk(page, 'read', newMarkdown)).toString('utf8'), /새 마크다운 메모/);

    await openDocument(page, '안내.txt');
    await page.locator('#reply-input').fill(reply);
    await page.locator('#reply-save').click();
    await page.locator('#detail-replies').getByText(reply, {exact: true}).waitFor();
    await openEditor(page);
    await page.locator('#edit-input').fill(edited);
    const beforeEdit = JSON.parse(Buffer.from(await disk(page, 'read', 'jjokmun-vault.json')));
    await failNextWrite(page, '안내.txt');
    await page.locator('#edit-save').click();
    await page.locator('#edit-save:enabled').waitFor();
    assert.match(await page.locator('#detail-status').textContent(), /저장 공간이 부족/);
    assert.equal(await page.locator('#edit-input').inputValue(), edited);
    await expectBytes(page, '안내.txt', plain);
    const afterEdit = JSON.parse(Buffer.from(await disk(page, 'read', 'jjokmun-vault.json')));
    assert.deepEqual(afterEdit.payload, beforeEdit.payload);
    assert.ok(afterEdit.revision >= beforeEdit.revision);

    await page.locator('#edit-save').click();
    await page.locator('#edit-form').waitFor({state: 'hidden'});
    const editedBytes = '\ufeff' + edited.replaceAll('\n', '\r\n');
    await expectBytes(page, '안내.txt', editedBytes);
    await expectBytes(page, '서가/안내.txt', '서가에 있는 다른 설명');
    console.log('PASS  failed vault and document writes preserve drafts and leave no duplicate files');

    // Model a move and append while the extension tab is closed.
    await page.close();
    await disk(session.worker, 'write', moved, editedBytes + appended);
    await disk(session.worker, 'remove', '안내.txt');
    page = await session.tab('2031-05-12', folder);
    await openDocument(page, moved);
    await page.locator('#detail-replies').getByText(reply, {exact: true}).waitFor();
    await page.locator(':is(#detail-original, #detail-preview):visible').getByText(/옮긴 뒤 외부에서 추가한 셋째 줄/).waitFor();
    await page.reload();
    await openDocument(page, moved);
    await page.locator(':is(#detail-original, #detail-preview):visible').getByText(/옮긴 뒤 외부에서 추가한 셋째 줄/).waitFor();
    await page.locator('#detail-replies').getByText(reply, {exact: true}).waitFor();
    assert.equal(await page.locator('#archive-list button').count(), 4);
    assert.equal(await page.locator('#archive-list button').filter({hasText: newText}).count(), 1);

    await openEditor(page);
    const draft = '저장하려던 문장\n아직 저장하지 않은 둘째 줄';
    const external = '편집 중 외부에서 저장한 원문\r\n';
    await page.locator('#edit-input').fill(draft);
    await disk(page, 'write', moved, external);
    await page.locator('#edit-save').click();
    await page.locator('#edit-conflict').waitFor();
    assert.equal(await page.locator('#edit-input').inputValue(), draft);
    assert.equal(await page.locator('#edit-conflict-draft').textContent(), draft);
    assert.match(await page.locator('#edit-conflict-disk').textContent(), /편집 중 외부에서 저장한 원문/);
    await expectBytes(page, moved, external);
    await page.locator('#keep-edit-draft').click();
    await page.locator('#edit-conflict').waitFor({state: 'hidden'});
    await expectBytes(page, moved, external);
    await page.locator('#archive-list button').filter({hasText: '저장하려던 문장'}).waitFor();

    await openDocument(page, moved);
    await openEditor(page);
    await page.locator('#edit-input').fill('삭제 뒤 복구하면 안 되는 초안');
    await disk(page, 'remove', moved);
    await page.locator('#edit-save').click();
    await page.locator('#edit-conflict').waitFor();
    assert.equal(await page.locator('#edit-input').inputValue(), '삭제 뒤 복구하면 안 되는 초안');
    assert.equal(await disk(page, 'has', moved), false);
    await page.reload();
    await refreshDocuments(page);
    assert.equal(await disk(page, 'has', moved), false);

    const ambiguousReply = '여러 후보 중 임의로 연결하면 안 되는 답장';
    await openDocument(page, '서가/안내.txt');
    await page.locator('#reply-input').fill(ambiguousReply);
    await page.locator('#reply-save').click();
    await page.locator('#detail-replies').getByText(ambiguousReply, {exact: true}).waitFor();
    const candidates = ['다른 서가/후보 하나.txt', '다른 서가/후보 둘.txt'];
    for (const candidate of candidates) {
      await disk(page, 'write', candidate, '서가에 있는 다른 설명\n외부에서 덧붙인 설명');
    }
    await disk(page, 'remove', '서가/안내.txt');
    await refreshDocuments(page);
    await page.locator('#document-missing').waitFor();
    await page.locator('#detail-replies').getByText(ambiguousReply, {exact: true}).waitFor();
    for (const candidate of candidates) {
      await openDocument(page, candidate);
      assert.equal(await page.locator('#detail-replies').getByText(ambiguousReply, {exact: true}).count(), 0);
    }
    const beforeRelink = await page.locator('#archive-list button').count();
    await openDocument(page, '서가/안내.txt');
    await page.locator('#document-path-choice').selectOption(candidates[1]);
    await page.locator('#relink-document-submit').click();
    await page.locator('#document-missing').waitFor({state: 'hidden'});
    await openDocument(page, candidates[1]);
    await page.locator('#detail-replies').getByText(ambiguousReply, {exact: true}).waitFor();
    assert.equal(await page.locator('#archive-list button').count(), beforeRelink - 1);
    console.log('PASS  folder documents, duplicate filenames, multiline edits, offline moves, ambiguous moves and conflicts');

    for (const bigEndian of [false, true]) {
      const filename = bigEndian ? 'UTF-16 BE.txt' : 'UTF-16 LE.txt';
      const encode = text => {
        const bytes = Buffer.from('\ufeff' + text, 'utf16le');
        return bigEndian ? bytes.swap16() : bytes;
      };
      const initial = encode('윈도우에서 쓴 첫 줄\r\n둘째 줄\r\n');
      await disk(page, 'write', filename, Array.from(initial));
      await refreshDocuments(page);
      await openDocument(page, filename);
      await page.locator(':is(#detail-original, #detail-preview):visible').getByText(/윈도우에서 쓴 첫 줄/).waitFor();
      await expectBytes(page, filename, initial);
      await openEditor(page);
      await page.locator('#edit-input').fill('쪽문에서 수정한 첫 줄\n셋째 줄 😀\n');
      await page.locator('#edit-save').click();
      await page.locator('#edit-form').waitFor({state: 'hidden'});
      await expectBytes(page, filename, encode('쪽문에서 수정한 첫 줄\r\n셋째 줄 😀\r\n'));
    }
    console.log('PASS  UTF-16 LE and BE document edits preserve BOM and CRLF');

    const passphrase = 'test-only document vault password';
    await page.evaluate(async passphrase => (await import('./vault.js')).enableVault(passphrase), passphrase);
    await page.reload();
    await page.locator('#lock-screen').waitFor();
    assert.ok(!(await page.locator('body').textContent()).includes(markdown));
    const record = Buffer.from(await disk(page, 'read', 'jjokmun-vault.json')).toString('utf8');
    assert.equal(JSON.parse(record).mode, 'encrypted');
    assert.ok(!record.includes('문서 본문'));
    await expectBytes(page, '서가/책.md', markdown);

    await disk(page, 'write', '서가/책.md', '암호화 중 외부에서 쓴 원문');
    await disk(page, 'write', '서가/새 문서.txt', '암호화 중 새로 만든 파일');
    await page.locator('#unlock-password').fill(passphrase);
    await page.locator('#unlock-submit').click();
    await page.locator('#lock-screen').waitFor({state: 'hidden'});
    const unlocked = await page.evaluate(async () => (await (await import('./vault.js')).transact()).memos.map(memo => memo.text));
    assert.ok(unlocked.includes(markdown));
    assert.ok(!unlocked.includes('암호화 중 외부에서 쓴 원문'));
    assert.ok(!unlocked.includes('암호화 중 새로 만든 파일'));
    const beforeEncryptedWrite = await disk(page, 'list', '');
    await page.locator('#memo-input').fill('암호화 저장소에서 쓴 메모');
    await page.locator('#memo-save').click();
    await page.locator(':is(#detail-original, #detail-preview):visible').getByText('암호화 저장소에서 쓴 메모', {exact: true}).waitFor();
    assert.deepEqual((await disk(page, 'list', '')).sort(), beforeEncryptedWrite.sort());
    await expectBytes(page, '서가/책.md', '암호화 중 외부에서 쓴 원문');
    console.log('PASS  encrypted snapshot ignores external changes and writes no new plaintext memo files');
  } finally {
    await page.close();
  }
}

module.exports = {checkDocuments};
