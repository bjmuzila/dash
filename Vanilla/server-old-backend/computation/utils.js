function finiteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const num = finiteNumber(value);
    if (num !== null) return num;
  }
  return 0;
}

function maxWholeNumber(...values) {
  const nums = values
    .map(finiteNumber)
    .filter((num) => num !== null && num >= 0 && Number.isInteger(num));
  return nums.length ? Math.max(...nums) : 0;
}

function todayYmd() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const map = Object.fromEntries(
    parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value])
  );
  const yy = map.year.slice(2);
  const mm = map.month;
  const dd = map.day;
  return { yy, mm, dd, ymd: `${map.year}-${mm}-${dd}`, compact: `${yy}${mm}${dd}` };
}

function optionExpirationCompact(symbol) {
  const match = String(symbol || '').match(/(\d{6})[CP]/);
  return match ? match[1] : '';
}

function isSpxwSymbol(symbol) {
  return /^\.?SPXW\d{6}[CP]/.test(String(symbol || ''));
}

module.exports = {
  finiteNumber,
  firstFiniteNumber,
  maxWholeNumber,
  todayYmd,
  optionExpirationCompact,
  isSpxwSymbol
};
