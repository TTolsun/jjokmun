// Earlier backups may contain the shop settings.
export function validateShop(shop) {
  if (!shop || !['days', 'coins', 'hearts', 'openedAt', 'level', 'decor'].every(
    key => Number.isSafeInteger(shop[key]) && shop[key] >= 0 && shop[key] <= Number.MAX_SAFE_INTEGER / 2)
    || shop.level < 1 || shop.level > 3 || shop.decor > 3
    || !['window', 'garden'].includes(shop.seat) || !['reading', 'picks'].includes(shop.plan)) {
    throw new Error('책방 운영 기록의 형식이 올바르지 않습니다.');
  }
  const { days, coins, hearts, level, seat, plan, openedAt, decor } = shop;
  const clean = { days, coins, hearts, level, seat, plan, openedAt, decor };
  if (shop.name !== undefined) {
    if (typeof shop.name !== 'string' || !shop.name.trim() || shop.name.length > 40 || /[\r\n]/.test(shop.name)) {
      throw new Error('책방 이름을 1~40자로 입력해 주세요.');
    }
    clean.name = shop.name.trim();
  }
  return clean;
}
