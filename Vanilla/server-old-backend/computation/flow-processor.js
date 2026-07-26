function getLatestBuySellPct(records) {
  if (!Array.isArray(records) || !records.length) return 0;
  const latest = records[records.length - 1];
  return Number(latest?.buyPct || 0);
}

module.exports = {
  getLatestBuySellPct
};
