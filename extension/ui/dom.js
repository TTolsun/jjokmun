export const element = (id) => document.getElementById(id);

export const longDate = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'full', timeZone: 'UTC' });
const shortDate = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeZone: 'UTC' });
export const formatDate = (date, formatter = shortDate) => formatter.format(new Date(date + 'T00:00:00Z'));

export function createTime(date) {
  const time = document.createElement('time');
  time.dateTime = date;
  time.textContent = formatDate(date);
  return time;
}
