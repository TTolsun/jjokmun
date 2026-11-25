const { openSection } = require('./browser.cjs');
const assert = require('node:assert/strict');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {extension} = require('./browser.cjs');

const reply = (id, createdOn) => ({id, text:'답장 ' + id, createdOn, createdAt:0});

// Bonds are derived from replies and signboard dates, so the rules can be
// checked without a browser.
async function checkBondRules() {
  const {BOND_TIERS, bondHint, bondOf, bondRoster, regularOf} =
    await import(pathToFileURL(path.join(extension, 'shop.js')).href);
  const memo = {id:'bond-memo', text:'정 계산', createdOn:'2031-05-12', updatedAt:0, replies:[]};
  assert.equal(bondOf(memo, []).points, 0);
  assert.equal(bondOf(memo, []).title, BOND_TIERS[0].name);

  memo.replies.push(reply('a', '2031-05-12'), reply('b', '2031-05-12'));
  assert.equal(bondOf(memo, []).points, 1, 'replies on one day count once');

  memo.replies.push(reply('c', '2031-05-13'));
  const revisit = bondOf(memo, []);
  assert.deepEqual([revisit.points, revisit.tier, revisit.revisits], [3, 1, 1]);

  const daily = [{date:'2031-05-14', memoId:memo.id, folded:false}, {date:'2031-05-15', memoId:null, folded:true}];
  memo.replies.push(reply('d', '2031-05-14'));
  const request = bondOf(memo, daily);
  assert.deepEqual([request.points, request.tier, request.requests, request.remaining], [6, 2, 1, 3]);
  assert.equal(bondHint(request), '오랜 단골까지 정 3 남았어요. 메모를 쓴 날이 아닌 다른 날 답장하면 정 +2.');
  assert.equal(bondHint(request, {requestedToday:true}), '단골이 오늘 다시 찾는 책이에요. 지금 답장하면 정 +3.');
  assert.equal(bondOf(memo, [{...daily[0], folded:true}]).points, 5);
  assert.match(bondHint(request, {repliedToday:true}), /다른 날 다시 들러 주세요/);

  for (let day = 16; day <= 20; day++) memo.replies.push(reply('e' + day, '2031-05-' + day));
  const friend = bondOf(memo, daily);
  assert.equal(friend.title, BOND_TIERS.at(-1).name);
  assert.equal(bondHint(friend), '가장 깊은 사이가 되었어요.');

  const other = {id:'quiet-memo', text:'조용한 메모', createdOn:'2031-05-13', updatedAt:0, replies:[]};
  const roster = bondRoster({memos:[other, memo], daily});
  assert.deepEqual(roster.map(entry => entry.memo.id), [memo.id, other.id]);
  // The signboard memo is the book a returning regular asks for on the floor.
  const {firstBusiness, memoBooks} = await import(pathToFileURL(path.join(extension, 'business.js')).href);
  const shop = firstBusiness(Date.parse('2031-06-01T00:00:00Z'));
  const books = [{...other, createdAt:0}, {...memo, createdAt:0}];
  const asked = memoBooks(shop, books, other.id);
  assert.ok([...asked.values()].some(book => book.id === other.id), 'the requested book is read');
  assert.equal(memoBooks(shop, books, 'missing').size, asked.size, 'every reader still finds a book');

  assert.equal(regularOf(memo.id).name, regularOf(memo.id).name);
  const names = new Set(Array.from({length:1000}, (_, i) => regularOf('memo-' + i).name));
  assert.ok(names.size > 100, 'regular names vary');
  for (const name of names) assert.match(name, /^(\S+ \S+ )?\S+ \S+ 손님$/);
  console.log('PASS  regular bonds count distinct reply days and signboard requests');
}

async function checkRegulars(session) {
  const folder = 'regulars-vault';
  const waitText = (tab, id, value) => tab.waitForFunction(([id, value]) =>
    document.getElementById(id).textContent === value, [id, value]);
  const monday = await session.tab('2031-05-12', folder);
  let tuesday, wednesday, nextWeek;
  try {
    await monday.locator('#memo-input').fill('단골과 다시 읽을 메모');
    await monday.locator('#memo-save').click();
    await waitText(monday, 'home-status', '메모를 남겼어요. 새 책이 되어 책방 신간 매대에 꽂혔어요.');
    await waitText(monday, 'regular-title', '새 단골 · 정 0');
    const name = await monday.locator('#regular-name').textContent();
    assert.match(name, /손님$/);
    await waitText(monday, 'roster-tally', '새 단골 1명');

    await openSection(monday, 'reply-compose');
    await monday.locator('#reply-input').fill('같은 날 첫 답장');
    await monday.locator('#reply-save').click();
    await waitText(monday, 'detail-status', '답장을 저장했어요. ' + name + '과의 정 +1.');
    await openSection(monday, 'reply-compose');
    await monday.locator('#reply-input').fill('같은 날 두 번째 답장');
    await monday.locator('#reply-save').click();
    await waitText(monday, 'detail-status', '답장을 저장했어요. 오늘은 ' + name + '과 이미 정을 쌓았어요.');
    await waitText(monday, 'regular-title', '새 단골 · 정 1');

    tuesday = await session.tab('2031-05-13', folder);
    await waitText(tuesday, 'daily-request', name + '이 이 책을 다시 찾아요');
    await tuesday.locator('#floor-link').click();
    await tuesday.locator('#daily-memo').click();
    await waitText(tuesday, 'regular-hint', '단골이 오늘 다시 찾는 책이에요. 지금 답장하면 정 +3.');
    assert.equal(await tuesday.locator('#reply-input').evaluate(input => input === document.activeElement), true);
    await openSection(tuesday, 'reply-compose');
    await tuesday.locator('#reply-input').fill('입간판을 보고 남긴 답장');
    await tuesday.locator('#reply-save').click();
    await waitText(tuesday, 'detail-status', '답장을 저장했어요. ' + name + '과 한층 가까워졌어요: 낯익은 단골.');
    await waitText(tuesday, 'daily-request', name + '의 부탁을 들어줬어요 · 정 +3');
    assert.equal(await tuesday.locator('#regular-progress').evaluate(bar => [bar.value, bar.max].join('/')), '2/3');

    wednesday = await session.tab('2031-05-14', folder);
    await wednesday.locator('#floor-link').click();
    await wednesday.locator('#daily-memo').click();
    await openSection(wednesday, 'reply-compose');
    await wednesday.locator('#reply-input').fill('다음 날에도 남긴 답장');
    await wednesday.locator('#reply-save').click();
    await waitText(wednesday, 'detail-status', '답장을 저장했어요. ' + name + '과 한층 가까워졌어요: 반가운 단골.');
    await waitText(wednesday, 'regular-hint', '오랜 단골까지 정 2 남았어요. 다른 날 다시 들러 주세요.');
    await waitText(wednesday, 'roster-tally', '반가운 단골 1명');
    assert.equal(await wednesday.locator('#roster-list button').first().textContent(), name + '반가운 단골 · 정 7');
    await waitText(monday, 'roster-tally', '반가운 단골 1명');
    const hearts = await wednesday.evaluate(async () => {
      const {paintHeart} = await import('./ui/shop-scene.js');
      const canvas = document.createElement('canvas');
      canvas.width = 32;
      canvas.height = 48;
      paintHeart(canvas.getContext('2d'), 16, 44);
      const pixels = canvas.getContext('2d').getImageData(0, 0, 32, 48).data;
      let found = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] === 0xe3 && pixels[i + 1] === 0x6d && pixels[i + 2] === 0x7e) found++;
      return found;
    });
    assert.equal(hearts, 6, 'a close regular shows all six pink pixels of the heart');

    const stored = await wednesday.evaluate(async () => {
      const {directory} = (await import('./vault.js')).folderConnection();
      const record = JSON.parse(await (await (await directory.getFileHandle('jjokmun-vault.json')).getFile()).text());
      // Opening the floor starts the shop clock; bonds themselves store nothing.
      return {keys:Object.keys(record.payload.state).filter(key => key !== 'business').sort(), shop:record.payload.state.shop};
    });
    assert.deepEqual(stored, {keys:['daily', 'memos', 'props', 'version'], shop:undefined}, 'bonds add no stored fields');

    nextWeek = await session.tab('2031-05-19', folder);
    await nextWeek.locator('#detail-close').click();
    await nextWeek.locator('#floor-link').click();
    await nextWeek.locator('#roster-list button').first().click();
    await openSection(nextWeek, 'memo-tools');
    await nextWeek.locator('#display-memo').click();
    await waitText(nextWeek, 'detail-status', '책방 매대에 추천글을 올렸어요.');
    await waitText(nextWeek, 'regular-title', '반가운 단골 · 정 7');
    await openSection(nextWeek, 'reply-compose');
    await nextWeek.locator('#reply-input').fill('매대에서 다시 읽고 남긴 답장');
    await nextWeek.locator('#reply-save').click();
    await waitText(nextWeek, 'regular-title', '오랜 단골 · 정 10');
    await waitText(monday, 'roster-tally', '오랜 단골 1명');
    await openSection(nextWeek, 'memo-tools');
    await nextWeek.locator('#detail-replies article').filter({hasText:'매대에서 다시 읽고 남긴 답장'})
      .getByRole('button', {name:'답장 삭제'}).click();
    await nextWeek.locator('#reply-dialog-confirm').click();
    await waitText(nextWeek, 'regular-title', '반가운 단골 · 정 7');
    await waitText(monday, 'roster-tally', '반가운 단골 1명');

    await monday.locator('#detail-close').click();
    await monday.locator('#detail-dialog').waitFor({state:'hidden'});
    await monday.locator('#floor-link').click();
    await monday.locator('#roster-list button').first().click();
    await monday.locator('#detail-title').waitFor();
    assert.equal(await monday.locator('#detail-original').textContent(), '단골과 다시 읽을 메모');
    await openSection(monday, 'memo-tools');
    await monday.locator('#delete-memo').click();
    await monday.locator('#delete-confirm').click();
    await waitText(monday, 'roster-count', '0명');
    await waitText(wednesday, 'roster-count', '0명');
    assert.equal(await monday.locator('#roster-list button').count(), 0);
    console.log('PASS  regular card, signboard request, roster and tier-up messages');
  } finally {
    await monday.close();
    await tuesday?.close();
    await wednesday?.close();
    await nextWeek?.close();
  }
}

module.exports = {checkBondRules, checkRegulars};

if (require.main === module) checkBondRules().catch(error => { console.error(error); process.exitCode = 1; });
