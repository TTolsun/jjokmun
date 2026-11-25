const { openSection } = require('./browser.cjs');
const assert = require('node:assert/strict');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {extension} = require('./browser.cjs');

const reply = (id, createdOn) => ({id, text:'답장 ' + id, createdOn, createdAt:0});

// Bonds are derived from replies and signboard dates, so the rules can be
// checked without a browser.
async function checkBondRules() {
  const {BOND_TIERS, bondHint, bondOf, bondRoster, bookTraffic, regularOf} =
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
  assert.equal(bondHint(request, {requestedToday:true}), '오늘 입간판에 걸린 책이에요. 지금 답장하면 정 +3.');
  assert.equal(bondOf(memo, [{...daily[0], folded:true}]).points, 5);
  assert.match(bondHint(request, {repliedToday:true}), /다른 날 다시 들러 주세요/);

  for (let day = 16; day <= 20; day++) memo.replies.push(reply('e' + day, '2031-05-' + day));
  const friend = bondOf(memo, daily);
  assert.equal(friend.title, BOND_TIERS.at(-1).name);
  assert.equal(bondHint(friend), '가장 깊은 사이가 되었어요.');

  const other = {id:'quiet-memo', text:'조용한 메모', createdOn:'2031-05-13', updatedAt:0, replies:[]};
  const roster = bondRoster({memos:[other, memo], daily});
  assert.deepEqual(roster.map(entry => entry.memo.id), [memo.id, other.id]);
  assert.equal(bookTraffic([other, memo], 0, daily).readers[1].tier, BOND_TIERS.length - 1);
  assert.equal(bookTraffic([memo], 0).readers[0].tier, bondOf(memo, []).tier, 'traffic works without signboard history');

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
  const waitMatch = (tab, id, source) => tab.waitForFunction(([id, source]) =>
    new RegExp(source).test(document.getElementById(id).textContent), [id, source]);
  const monday = await session.tab('2031-05-12', folder);
  let tuesday, wednesday, nextWeek;
  try {
    await monday.locator('#memo-input').fill('단골과 다시 읽을 메모');
    await monday.locator('#memo-save').click();
    await waitText(monday, 'home-status', '메모를 저장했어요.');
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
    await openSection(tuesday, 'journal-extras');
    await tuesday.locator('#daily-memo').click();
    await waitText(tuesday, 'regular-hint', '오늘 입간판에 걸린 책이에요. 지금 답장하면 정 +3.');
    await openSection(tuesday, 'reply-compose');
    await tuesday.locator('#reply-input').fill('입간판을 보고 남긴 답장');
    await tuesday.locator('#reply-save').click();
    await waitText(tuesday, 'detail-status', '답장을 저장했어요. ' + name + '과 한층 가까워졌어요: 낯익은 단골.');
    await waitText(tuesday, 'daily-request', name + '의 부탁을 들어줬어요 · 정 +3');
    assert.equal(await tuesday.locator('#regular-progress').evaluate(bar => [bar.value, bar.max].join('/')), '2/3');

    wednesday = await session.tab('2031-05-14', folder);
    await openSection(wednesday, 'journal-extras');
    await wednesday.locator('#daily-memo').click();
    await openSection(wednesday, 'reply-compose');
    await wednesday.locator('#reply-input').fill('다음 날에도 남긴 답장');
    await wednesday.locator('#reply-save').click();
    await waitText(wednesday, 'detail-status', '답장을 저장했어요. ' + name + '과 한층 가까워졌어요: 반가운 단골.');
    await waitText(wednesday, 'regular-hint', '오랜 단골까지 정 2 남았어요. 다른 날 다시 들러 주세요.');
    await waitText(wednesday, 'roster-tally', '반가운 단골 1명');
    await waitMatch(wednesday, 'shop-crowd', ' · 반가운 단골 이상 1명$');
    assert.equal(await wednesday.locator('#roster-list button').first().textContent(), name + '반가운 단골 · 정 7');
    await waitText(monday, 'roster-tally', '반가운 단골 1명');
    const hearts = await wednesday.evaluate(async () => {
      const {paintGuests} = await import('./ui/shop-scene.js');
      const {regularOf} = await import('./shop.js');
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 152;
      const count = tier => {
        paintGuests(canvas, [{person:regularOf('heart').person, at:0, seed:0, bestseller:false, tier}], 8000, false, []);
        const pixels = canvas.getContext('2d').getImageData(0, 0, 256, 152).data;
        let found = 0;
        for (let i = 0; i < pixels.length; i += 4) if (pixels[i] === 0xe3 && pixels[i + 1] === 0x6d && pixels[i + 2] === 0x7e) found++;
        return found;
      };
      return [count(1), count(2)];
    });
    assert.deepEqual(hearts, [0, 6], 'only close regulars show all six pink pixels of the heart');

    const stored = await wednesday.evaluate(async () => {
      const {directory} = (await import('./vault.js')).folderConnection();
      const record = JSON.parse(await (await (await directory.getFileHandle('jjokmun-vault.json')).getFile()).text());
      return {keys:Object.keys(record.payload.state).sort(), shop:record.payload.state.shop};
    });
    assert.deepEqual(stored, {keys:['daily', 'memos', 'props', 'version'], shop:undefined}, 'bonds add no stored fields');

    nextWeek = await session.tab('2031-05-19', folder);
    await nextWeek.locator('#detail-close').click();
    await openSection(nextWeek, 'journal-extras');
    await nextWeek.locator('#roster-list button').first().click();
    await openSection(nextWeek, 'memo-tools');
    await nextWeek.locator('#display-memo').click();
    await waitText(nextWeek, 'shop-book', '단골과 다시 읽을 메모');
    const interested = nextWeek.locator('.shelf-reader.interested h3');
    assert.deepEqual(await interested.allTextContents(), ['창가 단골']);
    await waitText(nextWeek, 'regular-title', '반가운 단골 · 정 7');
    await nextWeek.locator('#shop-book').click();
    await openSection(nextWeek, 'reply-compose');
    await nextWeek.locator('#reply-input').fill('매대에서 다시 읽고 남긴 답장');
    await nextWeek.locator('#reply-save').click();
    await waitText(nextWeek, 'regular-title', '오랜 단골 · 정 10');
    await waitText(monday, 'roster-tally', '오랜 단골 1명');
    assert.deepEqual(await interested.allTextContents(), ['창가 단골', '문가 단골']);
    await openSection(nextWeek, 'memo-tools');
    await nextWeek.locator('#detail-replies article').filter({hasText:'매대에서 다시 읽고 남긴 답장'})
      .getByRole('button', {name:'답장 삭제'}).click();
    await nextWeek.locator('#reply-dialog-confirm').click();
    await waitText(nextWeek, 'regular-title', '반가운 단골 · 정 7');
    await waitText(monday, 'roster-tally', '반가운 단골 1명');
    assert.deepEqual(await interested.allTextContents(), ['창가 단골']);

    await monday.locator('#detail-close').click();
    await monday.locator('#detail-dialog').waitFor({state:'hidden'});
    await openSection(monday, 'journal-extras');
    await monday.locator('#roster-list button').first().click();
    await monday.locator('#detail-title').waitFor();
    assert.equal(await monday.locator('#detail-original').textContent(), '단골과 다시 읽을 메모');
    await openSection(monday, 'memo-tools');
    await monday.locator('#delete-memo').click();
    await monday.locator('#delete-confirm').click();
    await waitText(monday, 'roster-count', '0명');
    await waitText(wednesday, 'roster-count', '0명');
    await nextWeek.locator('#shelf-empty').waitFor();
    assert.ok(await nextWeek.locator('#shop-book').isHidden());
    assert.deepEqual(await interested.allTextContents(), []);
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
