const { seedEncryptedVault } = require('./legacy-vault.cjs');
const { openSection } = require('./browser.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {launch, checkPolicy, extension, selectFolder} = require('./browser.cjs');

const monday = '2031-05-12';
const tuesday = '2031-05-13';
const wednesday = '2031-05-14';
const legacyText = '1.2.0에서 쓴 한글 메모';
const note = '검증 메모 · 바람 부는 날의 헌책방 8137';
const reply = '검증 답장 · 창문 옆에 의자가 있었다 5194';
const localNote = '수요일 다른 탭에서 쓴 새 메모';
const backupPass = 'test-only backup passphrase 331';
const vaultPass = 'test-only vault passphrase 772';

async function settings(p) {
  await p.bringToFront();
  if (!await p.locator('#settings-dialog').isVisible()) await p.locator('#open-settings').click();
}
async function doneSettings(p) {
  if (await p.locator('#settings-dialog').isVisible()) await p.locator('#settings-close').click();
}
async function write(p, text) {
  await p.locator('#memo-input').fill(text);
  await p.locator('#memo-input').press('Enter');
  await p.waitForFunction(t => document.querySelector('#detail-original').textContent === t, text);
}
async function readState(p) {
  return p.evaluate(async () => (await import('./vault.js')).transact());
}
async function readBackupState(p) {
  return p.evaluate(async () => {
    const {transact} = await import('./vault.js');
    const {validateBackup} = await import('./store.js');
    return validateBackup(await transact());
  });
}
async function rawRecord(p) {
  return p.evaluate(async () => {
    const {directory} = (await import('./vault.js')).folderConnection();
    return JSON.parse(await (await (await directory.getFileHandle('jjokmun-vault.json')).getFile()).text());
  });
}
async function password(p, value) {
  await p.bringToFront();
  await p.locator('#backup-password').fill(value);
  if (await p.locator('#backup-password-confirm').isVisible()) await p.locator('#backup-password-confirm').fill(value);
  await p.locator('#backup-password-submit').click();
}
async function exportFile(p) {
  await settings(p);
  await openSection(p, 'backup-tools');
  await p.locator('#export-backup').click();
  const download = p.waitForEvent('download');
  await password(p, backupPass);
  const bytes = await fs.readFile(await (await download).path());
  assert.ok(!bytes.includes(Buffer.from(note)) && !bytes.includes(Buffer.from(reply)));
  assert.ok(!bytes.includes(Buffer.from(backupPass)));
  return bytes;
}
async function upload(p, bytes) {
  await settings(p);
  await openSection(p, 'backup-tools');
  await p.locator('#import-backup').setInputFiles({name:'test-backup.json', mimeType:'application/json', buffer:bytes});
}
async function commitPreview(p) {
  await p.locator('#import-preview-dialog').waitFor();
  await p.locator('#import-confirm').click();
  await p.locator('#import-preview-dialog').waitFor({state:'hidden'});
}
async function unlock(p, pass = vaultPass) {
  await p.locator('#unlock-password').fill(pass);
  await p.locator('#unlock-submit').click();
  await p.locator('#lock-screen').waitFor({state:'hidden'});
}
async function forceNextWriteToFail(p) {
  await p.evaluate(() => {
    const original = FileSystemFileHandle.prototype.createWritable;
    FileSystemFileHandle.prototype.createWritable = function(...args) {
      FileSystemFileHandle.prototype.createWritable = original;
      throw new DOMException('Synthetic test write failure','QuotaExceededError');
    };
  });
}
async function assertLocked(p) {
  await p.locator('#lock-screen').waitFor();
  for (const selector of ['#copy-memo', '.copy-reply', '#reply-input', '#memo-input', '#floor-memo-input', '#daily-memo', '#archive-search']) {
    assert.equal(await p.locator(selector).first().isVisible(), false, selector);
  }
  const contents = await p.evaluate(() => document.body.textContent + [...document.querySelectorAll('input, textarea')].map(i => i.value).join(' '));
  for (const secret of [note, reply, legacyText, '미저장 비밀 문장']) assert.ok(!contents.includes(secret),'locked DOM retained text');
  assert.equal(await p.evaluate(async () => {
    try { await (await import('./vault.js')).transact(); return true; } catch { return false; }
  }), false);
}

async function seedLegacy(worker) {
  await worker.evaluate(text => new Promise((resolve,reject) => {
    const open = indexedDB.open('memo-alley',1);
    open.onupgradeneeded = () => open.result.createObjectStore('data');
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('data','readwrite');
      tx.objectStore('data').put({version:1,memos:[{id:'old-note',text,createdOn:'2031-05-11',updatedAt:1,replies:[]}],daily:[],props:[]},'state');
      tx.oncomplete = () => {db.close();resolve();}; tx.onabort = () => reject(tx.error);
    };
    open.onerror = () => reject(open.error);
  }), legacyText);
}

async function copyText(p, selector, expected, keyboard = false) {
  const button = p.locator(selector).first();
  assert.ok(await button.getAttribute('aria-label'));
  await p.bringToFront();
  await p.evaluate(()=>{ document.querySelector('#copy-status').textContent=''; });
  if (keyboard) { await button.focus(); await p.keyboard.press('Space'); }
  else await button.click();
  await p.waitForFunction(()=>document.querySelector('#copy-status').textContent.length>0);
  assert.match(await p.locator('#copy-status').innerText(), /복사했/);
  const input = p.locator('#memo-input');
  await input.focus();
  await input.press(process.platform === 'darwin' ? 'Meta+v' : 'Control+v');
  await p.waitForFunction(t => document.querySelector('#memo-input').value === t, expected);
  await input.fill('');
}

async function checkReplyActions(session, a) {
  const original = '두 번째 답장의 원문';
  const updated = '두 번째 답장을 수정한 내용';
  await a.locator('#reply-input').fill(original);
  await a.locator('#reply-save').click();
  await a.locator('#detail-replies').getByText(original,{exact:true}).waitFor();
  const before = await readState(a);
  const memo = before.memos.find(item => item.text === note);
  const target = memo.replies.find(item => item.text === original);
  const row = `article[data-reply-id="${target.id}"]`;
  const b = await session.tab(monday);
  try {
    await b.locator(row).getByRole('button', {name: '답장 수정'}).click();
    await b.locator('#reply-edit-input').fill('다른 탭의 초안');
    await a.locator(row).getByRole('button', {name: '답장 수정'}).click();
    await a.locator('#reply-edit-input').fill('   ');
    await a.locator('#reply-dialog-confirm').click();
    assert.match(await a.locator('#reply-dialog-status').innerText(), /답장 내용을 적어/);
    await a.locator('#reply-edit-input').fill(updated);
    await a.locator('#reply-edit-input').press('Enter');
    await a.locator('#reply-dialog').waitFor({state: 'hidden'});
    await b.locator('#reply-dialog-confirm').click();
    await b.getByText('다른 탭에서 답장이 바뀌었습니다.', {exact: false}).waitFor();
    await b.locator('#reply-dialog-cancel').click();
    await openSection(b, 'memo-search');
    await b.locator('#archive-search').fill(updated);
    await b.locator('#archive-list mark').waitFor();
    await b.locator('#archive-list button').first().click();
    await b.locator('.linked-reply p').getByText(updated, {exact:true}).waitFor();
    assert.equal(await b.locator('.linked-reply p').innerText(), updated);
    const edited = await readState(b);
    assert.deepEqual(edited.memos.find(item => item.id === memo.id).replies[1], {...target, text: updated});
    assert.deepEqual(edited.props, before.props);
    await b.locator(row).getByRole('button', {name: '답장 삭제'}).click();
    assert.equal(await b.locator('#reply-delete-text').innerText(), updated);
    assert.match(await b.locator('#reply-delete-message').innerText(), /되돌릴 수 없습니다/);
    await b.keyboard.press('Escape');
    assert.deepEqual(await readState(b), edited);
    await b.locator(row).getByRole('button', {name: '답장 삭제'}).click();
    await b.locator('#reply-dialog-confirm').click();
    await a.locator(row).waitFor({state: 'detached'});
    await b.getByText('검색 결과가 없습니다.').waitFor();
    await a.reload();
    await a.locator('#detail-replies').getByText(reply,{exact:true}).waitFor();
    const after = await readState(a);
    assert.deepEqual(after.memos.find(item => item.id === memo.id).replies, [memo.replies[0]]);
    assert.deepEqual(after.props, before.props.filter(prop => prop.kind !== 'plant'));
    console.log('PASS  reply edit, search, concurrent edit protection, delete confirmation and reload');
  } finally {
    await b.close();
  }
}

async function createSource(session) {
  const folder = '기존 책방';
  const folderMemo = '폴더에만 있는 기록';
  const setup = await session.tab(monday, folder);
  await write(setup, folderMemo);
  const plain = await rawRecord(setup);
  const plainState = await readBackupState(setup);
  await setup.close();
  await seedLegacy(session.worker);
  const existing = await session.tab(monday, folder);
  try {
    await existing.locator(':is(#detail-original, #detail-preview):visible').getByText(folderMemo, {exact:true}).waitFor();
    assert.deepEqual(await rawRecord(existing), plain);
    await seedEncryptedVault(existing, vaultPass);
    const encrypted = await rawRecord(existing);
    await existing.reload();
    await assertLocked(existing);
    assert.deepEqual(await rawRecord(existing), encrypted);
    await unlock(existing);
    assert.deepEqual((await readState(existing)).memos, plainState.memos);
  } finally { await existing.close(); }
  // The untouched profile can still be migrated into a separate, empty directory.
  const a = await session.tab(monday, null);
  await selectFolder(a, 'test-vault', '#choose-locked-folder');
  await a.locator('.workspace').waitFor();
  await a.locator('#archive-list').getByText(legacyText,{exact:true}).waitFor();
  console.log('PASS  selected plain and encrypted folder vaults take precedence over a different legacy profile');
  const native = await session.context.newPage();
  await native.goto('chrome://newtab/');
  assert.equal(await native.locator('#memo-input').count(),0);
  await native.close();
  const input = a.locator('#memo-input');
  await input.focus();
  const cdp = await session.context.newCDPSession(a);
  await cdp.send('Input.imeSetComposition',{text:'한글',selectionStart:2,selectionEnd:2});
  await input.dispatchEvent('keydown',{key:'Enter',code:'Enter',keyCode:229,isComposing:true,bubbles:true,cancelable:true});
  assert.equal((await readState(a)).memos.length,1);
  await cdp.send('Input.insertText',{text:'한글'});
  await write(a,note);
  await a.locator('#reply-input').fill(reply);
  await a.locator('#reply-save').click();
  await a.locator('#detail-replies').getByText(reply,{exact:true}).waitFor();
  await checkReplyActions(session, a);
  await a.keyboard.press('Control+k');
  await openSection(a, 'memo-search');
  await a.locator('#archive-search').fill('일치하지 않는 검색어');
  assert.equal(await a.locator('#archive-list button').count(), 0);
  assert.equal(await a.locator('#archive-status').innerText(), '검색 결과가 없습니다.');
  await openSection(a, 'memo-search');
  await a.locator('#archive-search').fill('창문 옆에');
  await a.locator('#archive-list mark').waitFor();
  await a.locator('#archive-search').press('ArrowDown');
  assert.ok(await a.locator('#archive-list button').first().evaluate(row => row === document.activeElement));
  await a.keyboard.press('ArrowUp');
  assert.ok(await a.locator('#archive-search').evaluate(input => input === document.activeElement));
  await a.locator('#archive-search').press('Enter');
  await a.locator('.linked-reply p').getByText(reply, {exact:true}).waitFor();
  assert.equal(await a.locator('.linked-reply p').innerText(), reply);
  await a.setViewportSize({width:390,height:840});
  await copyText(a,'#copy-memo',note);
  await copyText(a,'.copy-reply',reply,true);
  await a.setViewportSize({width:1280,height:840});
  const bytes = await exportFile(a);
  const again = await exportFile(a);
  const one = JSON.parse(bytes), two = JSON.parse(again);
  assert.notEqual(one.salt,two.salt);
  assert.notEqual(one.iv,two.iv);
  assert.notEqual(one.ciphertext,two.ciphertext);
  const state = await readBackupState(a);
  await doneSettings(a);
  console.log('PASS  legacy IDB, native new tab, Korean composition, original/reply clipboard paste, randomized encrypted exports');
  return {a, bytes, state};
}

async function checkVault(session, a) {
  const b = await session.tab(monday);
  await settings(a);
  await openSection(a, 'about-tools');
  const developer = a.getByRole('region', {name: '개발자 정보'});
  assert.ok(await developer.getByText('KH', {exact: true}).isVisible());
  const email = developer.getByRole('link', {name: 'baboess@gmail.com'});
  assert.equal(await email.getAttribute('href'), 'mailto:baboess@gmail.com');
  await openSection(a, 'storage-tools');
  assert.equal(await a.locator('#enable-vault').count(), 0);
  await seedEncryptedVault(a, vaultPass);
  await b.evaluate(() => window.dispatchEvent(new Event('focus')));
  await assertLocked(b);
  const encrypted = await rawRecord(a);
  assert.equal(encrypted.mode,'encrypted');
  for (const value of [note,reply,legacyText,vaultPass]) assert.ok(!JSON.stringify(encrypted).includes(value));
  await unlock(b);
  await openSection(b, 'memo-search');
  await b.locator('#archive-search').fill('미저장 비밀 문장');
  await b.locator('#reply-input').fill('미저장 비밀 문장');
  await b.locator('#floor-link').click();
  assert.equal(await b.locator('#floor-memo-form').isVisible(), false);
  await settings(b);
  await upload(b, Buffer.from(JSON.stringify(await readState(b))));
  await b.locator('#import-preview-dialog').waitFor();
  const editor = await session.tab(monday);
  await unlock(editor);
  await editor.getByRole('button', {name: '답장 수정'}).click();
  await editor.locator('#reply-edit-input').fill('미저장 비밀 문장');
  const owner = await session.tab(monday);
  await unlock(owner);
  await owner.locator('#display-memo').click();
  await owner.locator('#detail-status').getByText('책방 매대에 추천글을 올렸어요.').waitFor();
  await settings(owner);
  await owner.locator('#shop-name').fill('저녁의 서점');
  await owner.locator('#shop-name-form button').click();
  await owner.locator('#settings-close').click();
  await owner.locator('#floor-link').click();
  await owner.locator('#floor-title').getByText('저녁의 서점').waitFor();
  await owner.waitForFunction(() => document.querySelector('#business-pick').textContent !== '');
  await settings(a);
  await a.locator('#lock-vault').click();
  await Promise.all([assertLocked(a), assertLocked(b), assertLocked(editor), assertLocked(owner)]);
  assert.equal(await owner.locator('#floor').isVisible(), false);
  assert.equal(await owner.locator('#business-pick').textContent(), '');
  assert.equal(await owner.locator('#floor-title').textContent(), '');
  assert.equal(await owner.locator('#sold-list').textContent(), '');
  await unlock(owner);
  assert.equal((await readState(owner)).shop.name, '저녁의 서점');
  await owner.close();
  assert.equal(await editor.locator('#reply-dialog').isVisible(), false);
  assert.equal(await editor.locator('#reply-edit-input').inputValue(), '');
  await editor.close();
  assert.equal(await b.locator('dialog[open]').count(), 0);
  assert.equal(await b.locator('#import-summary').textContent(), '');
  const newTab = await session.tab();
  await assertLocked(newTab);
  const locked = await rawRecord(a);
  await a.locator('#unlock-password').fill('wrong-test-pass');
  await a.locator('#unlock-submit').click();
  await a.waitForFunction(()=>!document.querySelector('#unlock-submit').disabled);
  await assertLocked(a);
  assert.deepEqual(await rawRecord(a),locked);
  await unlock(a);
  await openSection(a, 'memo-search');
  await a.locator('#archive-search').fill(reply);
  await a.locator('#archive-list button').first().click();
  await a.locator('.linked-reply p').getByText(reply, {exact:true}).waitFor();
  assert.equal(await a.locator('.linked-reply p').innerText(),reply);
  console.log('PASS  legacy encrypted record, two-tab lock and draft scrubbing, wrong password and bookstore recovery');
}

async function checkRecovery(session, bytes, initial) {
  const a = await session.tab(tuesday);
  const b = await session.tab(wednesday);
  await a.locator('#today-date').waitFor();
  await settings(a);
  await openSection(a, 'storage-tools');
  const original = await readState(a);
  for (const corrupt of [false,true]) {
    const file = JSON.parse(bytes);
    if (corrupt) file.ciphertext = (file.ciphertext[0] === 'A' ? 'B' : 'A') + file.ciphertext.slice(1);
    await upload(a, Buffer.from(JSON.stringify(file)));
    await password(a, corrupt ? backupPass : 'wrong-secret');
    await a.waitForFunction(() => !document.querySelector('#backup-password-submit').disabled);
    const errorText=await a.locator('#password-status').textContent();
    if (!errorText) throw Error('Empty backup error; modified ciphertext=' + corrupt + ', ' + await a.evaluate(()=>JSON.stringify({
      dialog:document.querySelector('#backup-password-dialog').open,
      action:document.querySelector('#password-title').textContent,
      status:document.querySelector('#settings-status').textContent,
      inputLength:document.querySelector('#backup-password').value.length,
      valid:document.querySelector('#backup-password-form').checkValidity(),
      preview:document.querySelector('#import-preview-dialog').open, locked:!document.querySelector('#lock-screen').hidden
    })));
    assert.match(errorText, /손상|일치하지|비밀번호를 확인/);
    if (await a.locator('#backup-password-dialog').isVisible()) await a.locator('#backup-password-cancel').click();
    assert.deepEqual(await readState(a),original);
  }
  await upload(a,Buffer.alloc(48*1024*1024+1,32));
  await a.waitForFunction(() => /크기|용량|MiB|MB/i.test(document.querySelector('#settings-status').textContent));
  assert.deepEqual(await readState(a),original);
  await upload(a,bytes);
  await password(a,backupPass);
  await a.locator('#import-preview-dialog').waitFor();
  const summary=await a.locator('#import-summary').innerText();
  for (const token of ['메모','원문','답장','충돌']) assert.ok(summary.includes(token),summary);
  assert.deepEqual(await readState(a),original);
  await forceNextWriteToFail(a);
  await a.locator('#import-confirm').click();
  await a.waitForFunction(() => !document.querySelector('#import-confirm').disabled);
  assert.deepEqual(await readState(a),original);
  if (!await a.locator('#import-preview-dialog').isVisible()) { await upload(a,bytes); await password(a,backupPass); }
  await commitPreview(a);
  const restored=await readState(a);
  assert.deepEqual(restored.memos,initial.memos);
  assert.deepEqual(restored.props,initial.props);
  for (const entry of initial.daily) assert.ok(restored.daily.some(d=>d.date===entry.date && d.memoId===entry.memoId));
  await doneSettings(a);
  await openSection(a, 'memo-search');
  await a.locator('#archive-search').fill(reply);
  await a.locator('#archive-list button').first().click();
  await a.locator('.linked-reply p').getByText(reply, {exact:true}).waitFor();
  assert.equal(await a.locator('.linked-reply p').innerText(),reply);
  const previousUndo = await a.evaluate(async ()=>(await (await import('./vault.js')).readPayload()).payload.undo);
  assert.ok(previousUndo);
  await upload(a,bytes); await password(a,backupPass); await commitPreview(a);
  assert.deepEqual((await readState(a)).memos,restored.memos);
  assert.deepEqual(await a.evaluate(async ()=>(await (await import('./vault.js')).readPayload()).payload.undo),previousUndo);
  await write(b,localNote);
  // A later change to a previously imported note must survive selective undo.
  await b.locator('#archive-list button').filter({hasText:legacyText}).click();
  await b.locator(':is(#detail-original, #detail-preview):visible').getByText(legacyText, {exact:true}).waitFor();
  await b.locator('#edit-memo').click();
  await b.locator('#edit-input').fill('가져오기 뒤 수정한 원문');
  await b.locator('#edit-save').click();
  await b.waitForFunction(()=>document.querySelector('#detail-original').textContent==='가져오기 뒤 수정한 원문');
  await a.reload();
  await settings(a);
  await openSection(a, 'backup-tools');
  await a.locator('#undo-import').click();
  await a.locator('#undo-confirm').click();
  await a.locator('#undo-dialog').waitFor({state:'hidden'});
  await a.waitForFunction(()=>document.querySelector('#undo-result').textContent.trim().length>0);
  assert.match(await a.locator('#undo-result').innerText(), /충돌|유지/);
  const after = await readState(a);
  assert.deepEqual(after.memos.map(m=>m.text).sort(),[localNote,'가져오기 뒤 수정한 원문'].sort());
  assert.equal(after.props.length,0);
  assert.ok(after.daily.every(entry=>!entry.memoId || after.memos.some(m=>m.id===entry.memoId)));

  // Legacy plaintext JSON, preview invalidation by an independent write.
  await upload(a,Buffer.from(JSON.stringify(initial)));
  await a.locator('#import-preview-dialog').waitFor();
  await write(b,'미리보기 중 작성한 메모');
  await a.locator('#import-confirm').click();
  await a.waitForFunction(()=>document.querySelector('#import-status').textContent.trim().length>0);
  assert.equal((await readState(a)).memos.length,3);
  await commitPreview(a);
  assert.ok((await readState(a)).memos.some(m=>m.text===note));
  await openSection(a, 'storage-tools');
  assert.equal((await rawRecord(a)).mode, 'plain');
  console.log('PASS  fresh encrypted restore, wrong/damaged/oversized files, failed commit, old JSON, stale preview, idempotence and conflict-preserving undo');
}

async function run() {
  await require('./vault-copy.cjs').checkVaultCopy();
  await require('./undo.cjs').checkPlainJournal();
  await require('./undo.cjs').checkLegacyFieldOrder();
  await require('./regulars.cjs').checkBondRules();
  await require('./season.cjs').checkSeasonRules();
  const manifest=JSON.parse(await fs.readFile(path.join(extension,'manifest.json'),'utf8'));
  assert.equal(manifest.chrome_url_overrides,undefined);
  assert.equal(manifest.host_permissions,undefined);
  assert.equal(manifest.permissions,undefined);
  const tmpRoot=await fs.realpath(os.tmpdir());
  const directory=await fs.mkdtemp(path.join(tmpRoot,'jjokmun-verify-'));
  let session;
  try {
    const sourceProfile=path.join(directory,'source-profile');
    session=await launch(sourceProfile);
    const {a,bytes,state}=await createSource(session);
    await checkVault(session,a);
    assert.deepEqual(session.external,[]);
    await session.context.close();
    session=await launch(sourceProfile);
    const reopened=await session.tab(monday, null);
    await assertLocked(reopened); await unlock(reopened);
    assert.ok((await readState(reopened)).memos.some(m=>m.text===note));
    await session.context.close();
    session=await launch(path.join(directory,'target-profile'));
    await checkRecovery(session,bytes,state);
    assert.deepEqual(session.external,[]);
    console.log('PASS  no external HTTP(S) requests in normal application workflows');
    await checkPolicy(session);
    await session.context.close();
    session = await launch(path.join(directory, 'sales-floor-profile'));
    await require('./sales-floor.cjs').checkSalesFloor(session);
    await require('./journal-layout.cjs').checkJournalLayout(session);
    assert.deepEqual(session.external, []);
    await session.context.close();
    session = await launch(path.join(directory, 'bookshop-profile'));
    await require('./bookshop.cjs').checkBookshop(session);
    await require('./guest-visit.cjs').checkGuestVisit(session);
    assert.deepEqual(session.external,[]);
    await session.context.close();
    session = await launch(path.join(directory, 'folder-profile'));
    await require('./folder.cjs').checkFolder(session);
    assert.deepEqual(session.external,[]);
    await session.context.close();
    session = await launch(path.join(directory, 'documents-profile'));
    await require('./documents.cjs').checkDocuments(session);
    assert.deepEqual(session.external, []);
    await session.context.close();
    session = await launch(path.join(directory, 'rendering-profile'));
    await require('./rendering.cjs').checkRendering(session);
    assert.deepEqual(session.external, []);
    await session.context.close();
    session = await launch(path.join(directory, 'regulars-profile'));
    await require('./regulars.cjs').checkRegulars(session);
    assert.deepEqual(session.external,[]);
    await session.context.close();
    session = await launch(path.join(directory, 'season-profile'));
    await require('./season.cjs').checkSeason(session);
    assert.deepEqual(session.external,[]);
  } finally {
    if (session) await session.context.close();
    const resolved=await fs.realpath(directory);
    if (path.dirname(resolved)===tmpRoot && path.basename(resolved).startsWith('jjokmun-verify-')) {
      await fs.rm(resolved,{recursive:true,force:true,maxRetries:3,retryDelay:100});
    }
  }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
