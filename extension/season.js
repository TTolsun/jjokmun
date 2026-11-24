import { bondRoster, requestDates } from './shop.js';

// Monthly goals, shop grades, and the year-end review are derived from memo,
// reply, and signboard dates. Like bonds, they add nothing to the stored state.
// Every goal counts distinct days, so writing many entries on one day does not
// advance it faster.
export const MONTHLY_GOALS = [
  { key: 'writing', label: '메모를 쓴 날', target: 8 },
  { key: 'rereading', label: '다른 날 다시 읽고 답장한 날', target: 4 },
  { key: 'requests', label: '입간판 부탁을 들어준 날', target: 2 }
];

// Levels match the shelf counts the shop interior can draw.
export const SHOP_GRADES = [
  { level: 1, months: 0, name: '동네 책방' },
  { level: 2, months: 1, name: '이름난 책방' },
  { level: 3, months: 3, name: '골목 명소' }
];

const SEASONS = [
  { key: 'spring', months: [3, 4, 5], name: '봄', shelf: '봄맞이 시집 서가' },
  { key: 'summer', months: [6, 7, 8], name: '여름', shelf: '한여름 여행기 서가' },
  { key: 'autumn', months: [9, 10, 11], name: '가을', shelf: '독서의 계절 서가' },
  { key: 'winter', months: [12, 1, 2], name: '겨울', shelf: '긴 겨울밤 소설 서가' }
];

const REVIEW_JANUARY_DAYS = 15;

export const monthOf = (date) => date.slice(0, 7);

export function seasonOf(date) {
  const month = Number(date.slice(5, 7));
  return SEASONS.find((season) => season.months.includes(month));
}

export function activity(state, through) {
  const months = new Map();
  const bucket = (day) => {
    const key = monthOf(day);
    if (!months.has(key)) months.set(key, { writing: new Set(), rereading: new Set(), requests: new Set() });
    return months.get(key);
  };
  const requested = requestDates(state.daily);
  for (const memo of state.memos) {
    if (memo.createdOn > through) continue;
    bucket(memo.createdOn).writing.add(memo.createdOn);
    const asked = requested.get(memo.id);
    for (const reply of memo.replies) {
      if (reply.createdOn > through) continue;
      if (asked?.has(reply.createdOn)) bucket(reply.createdOn).requests.add(reply.createdOn);
      if (reply.createdOn !== memo.createdOn) bucket(reply.createdOn).rereading.add(reply.createdOn);
    }
  }
  return months;
}

function progressOf(month, days) {
  const goals = MONTHLY_GOALS.map((goal) => {
    const count = days?.[goal.key].size ?? 0;
    return { ...goal, count, done: count >= goal.target };
  });
  return { month, goals, complete: goals.every((goal) => goal.done) };
}

export function monthlyProgress(state, date, months = activity(state, date)) {
  const month = monthOf(date);
  return progressOf(month, months.get(month));
}

// Months after the displayed date are ignored so a tab opened with ?date= sees
// the grade it would have had on that day.
export function shopGrade(state, date, months = activity(state, date)) {
  const current = monthOf(date);
  const completed = [...months]
    .filter(([month, days]) => month <= current && progressOf(month, days).complete)
    .map(([month]) => month).sort();
  let grade = SHOP_GRADES[0];
  for (const candidate of SHOP_GRADES) if (completed.length >= candidate.months) grade = candidate;
  const next = SHOP_GRADES.find((candidate) => candidate.months > completed.length);
  return { ...grade, completed, nextName: next?.name ?? null, remaining: next ? next.months - completed.length : 0 };
}

// December reviews the current year; early January still shows the year that just ended.
export function reviewYear(date) {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  if (month === 12) return year;
  if (month === 1 && Number(date.slice(8, 10)) <= REVIEW_JANUARY_DAYS) return year - 1;
  return null;
}

export function yearReview(state, year, through = year + '-12-31', activityByMonth = activity(state, through)) {
  const prefix = year + '-';
  const months = [...activityByMonth].filter(([month]) => month.startsWith(prefix));
  if (!months.length) return null;
  const total = (key) => months.reduce((sum, [, days]) => sum + days[key].size, 0);
  const busiest = months.map(([month, days]) => ({ month, days: days.writing.size }))
    .sort((a, b) => b.days - a.days || a.month.localeCompare(b.month))[0];
  const memos = state.memos.filter((memo) => memo.createdOn <= through && memo.createdOn.startsWith(prefix));
  const activeMemos = state.memos.filter(memo => memo.createdOn <= through)
    .map(memo => ({ ...memo, replies: memo.replies.filter(reply => reply.createdOn.startsWith(prefix) && reply.createdOn <= through) }))
    .filter(memo => memo.replies.length);
  const favorite = bondRoster({ memos: activeMemos, daily: state.daily })[0];
  return {
    year,
    memos: memos.length,
    writingDays: total('writing'),
    rereadingDays: total('rereading'),
    requests: total('requests'),
    busiest: busiest.days ? busiest : null,
    completedMonths: months.filter(([month, days]) => progressOf(month, days).complete).length,
    favorite: favorite?.bond.points ? favorite : null
  };
}
