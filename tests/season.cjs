const { openSection } = require('./browser.cjs');
const assert = require('node:assert/strict');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {extension} = require('./browser.cjs');

const day = (month, date) => '2031-' + String(month).padStart(2, '0') + '-' + String(date).padStart(2, '0');

// One fully completed month: eight writing days, four rereading days, and two
// signboard requests answered on the day they were shown (also rereading days).
function completedMonth(month) {
  const memos = Array.from({length:8}, (_, i) => ({
    id:'m' + month + '-' + i, text:month + '월 메모 ' + i, createdOn:day(month, i + 1), createdAt:0, updatedAt:0, replies:[]
  }));
  for (let i = 0; i < 4; i++) {
    memos[i].replies.push({id:'r' + i, text:'다시 읽은 답장', createdOn:day(month, 10 + i), createdAt:0});
  }
  memos[0].replies.push({id:'q0', text:'부탁 답장', createdOn:day(month, 20), createdAt:0});
  memos[1].replies.push({id:'q1', text:'부탁 답장', createdOn:day(month, 21), createdAt:0});
  const daily = [{date:day(month, 20), memoId:memos[0].id, folded:false}, {date:day(month, 21), memoId:memos[1].id, folded:false}];
  return {memos, daily};
}

async function checkSeasonRules() {
  const {MONTHLY_GOALS, monthlyProgress, reviewYear, seasonOf, shopGrade, yearReview} =
    await import(pathToFileURL(path.join(extension, 'season.js')).href);
  const november = completedMonth(11);
  const state = {memos:november.memos, daily:november.daily, props:[]};

  const progress = monthlyProgress(state, '2031-11-30');
  // Answering a signboard request on a later day is also a rereading day.
  assert.deepEqual(progress.goals.map(goal => goal.count), [8, 6, 2]);
  assert.ok(progress.goals.every((goal, i) => goal.target === MONTHLY_GOALS[i].target && goal.done));
  assert.ok(progress.complete);
  assert.deepEqual(monthlyProgress(state, '2031-11-02').goals.map(goal => goal.count), [2, 0, 0]);
  assert.equal(shopGrade(state, '2031-11-02').level, 1);
  assert.equal(monthlyProgress(state, '2031-12-01').goals[0].count, 0);

  state.memos.push({id:'same-day', text:'같은 날 두 번째', createdOn:day(11, 1), createdAt:0, updatedAt:0, replies:[
    {id:'s1', text:'a', createdOn:day(11, 10), createdAt:0}, {id:'s2', text:'b', createdOn:day(11, 10), createdAt:0}]});
  assert.deepEqual(monthlyProgress(state, '2031-11-30').goals.map(goal => goal.count), [8, 6, 2], 'goals count distinct days');

  assert.equal(shopGrade(state, '2031-10-31').level, 1, 'later months do not raise an earlier grade');
  const grade = shopGrade(state, '2031-12-01');
  assert.deepEqual([grade.level, grade.name, grade.nextName, grade.remaining], [2, '이름난 책방', '골목 명소', 2]);

  const partial = completedMonth(9);
  partial.memos.pop();
  const september = {memos:[...state.memos, ...partial.memos], daily:[...state.daily, ...partial.daily]};
  assert.equal(shopGrade(september, '2031-12-01').completed.length, 1, 'a month short of one goal does not count');

  assert.deepEqual(['2031-03-01', '2031-07-01', '2031-10-01', '2031-01-01'].map(date => seasonOf(date).key),
    ['spring', 'summer', 'autumn', 'winter']);
  assert.deepEqual(['2031-12-01', '2032-01-15', '2032-01-16', '2031-06-01'].map(reviewYear), [2031, 2031, null, null]);

  const review = yearReview(september, 2031);
  assert.equal(review.memos, 16);
  assert.equal(review.completedMonths, 1);
  assert.deepEqual(review.busiest, {month:'2031-11', days:8});
  assert.equal(review.favorite.memo.id, 'm11-1', 'ties go to the newer memo');
  assert.equal(yearReview(september, 2030), null);
  const priorMemo = {...state.memos[0], createdOn:'2030-12-31'};
  const boundary = {memos:[priorMemo], daily:[]};
  assert.equal(yearReview(boundary, 2030).favorite, null);
  assert.equal(yearReview(boundary, 2031).favorite.memo.id, priorMemo.id);
  console.log('PASS  monthly goals, shop grade, seasons and year review derive from distinct days');
}

async function checkSeason(session) {
  const folder = 'season-vault';
  const waitText = (tab, id, value) => tab.waitForFunction(([id, value]) =>
    document.getElementById(id).textContent === value, [id, value]);
  const page = await session.tab('2031-12-10', folder);
  let autumn;
  try {
    const november = completedMonth(11);
    const december = Array.from({length:7}, (_, i) => ({
      id:'d' + i, text:'12월 메모 ' + i, createdOn:day(12, i + 1), createdAt:0, updatedAt:0, replies:[]
    }));
    await page.evaluate(async ({memos, daily}) => {
      await (await import('./vault.js')).transact(state => {
        state.memos.push(...memos);
        state.daily.push(...daily);
      });
    }, {memos:[...november.memos, ...december], daily:november.daily});
    await page.reload();
    await openSection(page, 'journal-extras');

    await waitText(page, 'season-name', '12월 · 겨울');
    assert.equal(await page.locator('#shop').getAttribute('data-season'), 'winter');
    await waitText(page, 'shop-grade', '책방 등급: 이름난 책방 · 목표를 모두 이룬 달이 2번 더 있으면 골목 명소가 돼요.');
    assert.deepEqual(await page.locator('#goal-list .goal-count').allTextContents(), ['7/8', '0/4', '0/2']);
    assert.equal(await page.locator('#review-title').textContent(), '2031년 책방 결산');
    const stats = await page.locator('#review-stats').evaluate(list =>
      Object.fromEntries([...list.querySelectorAll('dt')].map(term => [term.textContent, term.nextElementSibling.textContent])));
    assert.equal(stats['새로 쓴 메모'], '15편');
    assert.equal(stats['목표를 모두 이룬 달'], '1달');
    assert.equal(stats['가장 부지런했던 달'], '11월 (8일)');
    assert.match(stats['올해의 단골'], /손님 · 반가운 단골$/);
    assert.equal(await page.locator('#goal-status').textContent(), '', 'goals met before opening are not announced');

    await page.locator('#memo-input').fill('12월의 여덟 번째 날');
    await page.locator('#memo-save').click();
    await waitText(page, 'goal-status', '이달의 목표 달성: 메모를 쓴 날.');
    assert.deepEqual(await page.locator('#goal-list .goal-count').allTextContents(), ['8/8 달성', '0/4', '0/2']);

    autumn = await session.tab('2031-11-25', folder);
    await openSection(autumn, 'journal-extras');
    await waitText(autumn, 'season-name', '11월 · 가을');
    await waitText(autumn, 'shop-grade', '책방 등급: 이름난 책방 · 목표를 모두 이룬 달이 2번 더 있으면 골목 명소가 돼요.');
    assert.ok(await autumn.locator('#year-review').isHidden(), 'the review waits for December');

    const shop = await page.evaluate(async () => (await (await import('./vault.js')).transact()).shop);
    assert.equal(shop, undefined, 'the earned grade is not written to the stored shop');
    console.log('PASS  monthly goal board, live goal notice, shop grade and December review');
  } finally {
    await page.close();
    await autumn?.close();
  }
}

module.exports = {checkSeasonRules, checkSeason};

if (require.main === module) checkSeasonRules().catch(error => { console.error(error); process.exitCode = 1; });
