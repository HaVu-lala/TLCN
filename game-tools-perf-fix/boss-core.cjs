(function (root) {
  function zoneOrder(current, start, end) {
    start = Math.trunc(Number(start)); end = Math.trunc(Number(end));
    if (!(start >= 1 && end <= 60 && end >= start)) return [];
    const zones = Array.from({ length: end - start + 1 }, (_, i) => start + i);
    const at = zones.indexOf(Number(current));
    return at < 0 ? zones : zones.slice(at + 1).concat(zones.slice(0, at));
  }
  function isBoss(row, names = []) {
    if (!Array.isArray(row)) return false;
    if (names.some(name => String(name).trim().toLowerCase() === String(row[1]).trim().toLowerCase())) return true;
    return /(^|[_\s-])(boss|worldboss|world_boss)([_\s-]|$)/i.test(String(row[12] || ''));
  }
  const api = { zoneOrder, isBoss };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.__gtBossCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
