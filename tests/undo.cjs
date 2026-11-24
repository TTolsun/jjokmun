const assert = require('node:assert/strict');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {extension} = require('./browser.cjs');

// IndexedDB's structured clone preserves shared object identity. A journal
// entry must remain an independent snapshot when the plain store is edited.
async function checkPlainJournal() {
  const {emptyState, validateBackup} = await import(pathToFileURL(path.join(extension,'store.js')).href);
  const {mergeImport, undoImport} = await import(pathToFileURL(path.join(extension,'imports.js')).href);
  const day='2031-05-13';
  const old={id:'existing',text:'previous version',createdOn:'2031-05-01',updatedAt:1,replies:[]};
  const state=emptyState();
  state.memos.push(structuredClone(old));
  const incoming=emptyState();
  const newNote={id:'new',text:'imported note',createdOn:'2031-05-12',updatedAt:2,replies:[]};
  incoming.memos.push({...old,text:'from backup',updatedAt:5},newNote);
  const {undo}=mergeImport(state,validateBackup(incoming),day);
  const committed=structuredClone({state,undo});
  const later=committed.state.memos.find(m=>m.id==='new');
  later.replies.push({id:'later',text:'after import',createdOn:day,createdAt:6});
  committed.state.props.push({kind:'chair',memoId:later.id,replyId:'later'});
  const result=undoImport(committed.state,committed.undo,day);
  assert.ok(result.conflicts);
  assert.deepEqual(committed.state.memos.find(m=>m.id===old.id),old);
  assert.equal(committed.state.memos.find(m=>m.id==='new').replies[0].text,'after import');
  assert.equal(validateBackup(committed.state).props.length,1);
  // Repeat without a prop: preserving a new reply must not depend on it
  // having been the first, second, or third reply ever entered.
  const second=emptyState();
  const journal=mergeImport(second,validateBackup(incoming),day).undo;
  const data=structuredClone({state:second,undo:journal});
  data.state.memos.find(m=>m.id==='new').replies.push({id:'fourth',text:'unlinked',createdOn:day,createdAt:7});
  undoImport(data.state,data.undo,day);
  assert.equal(data.state.memos.find(m=>m.id==='new')?.replies[0]?.text,'unlinked');
  console.log('PASS  selective journal undo preserves later replies and restores old originals in the plain store');
}
module.exports={checkPlainJournal};
