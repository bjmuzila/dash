const dxClients = new Set();
const subscriptions = new Set();
const subscriptionTypesBySymbol = new Map();
const candleSubscriptions = new Set();
const subscriptionCreatedAt = new Map();
const subscriptionQueue = [];
let subscriptionSending = false;
const queuedSubscriptionKeys = new Set();
const activeAutoSubscriptionKeys = new Set();
const activeCandleSubscriptionKeys = new Set();

const dxGreeksCache = {};
const dxSummaryCache = {};
const dxQuoteCache = {};
const dxTradeCache = {};
const dxCandleCache = {};
const dxOpenInterestCache = {};
const marketDataPrevCloseCache = {};
const marketDataSnapshotCache = {};
const prevCloseFallbackCache = {};
const historyDailyCache = new Map();
const historyDailyInFlight = new Map();
const intradayGreeksHistory = [];
const gexLevelCache = {};
const putCallCache = { ratio: 0, date: "", source: "", ts: 0 };
let spxBootstrapPromise = null;
let spyBootstrapPromise = null;
let qqqBootstrapPromise = null;
const livePrevCloses = {
  VIX: 0,
  ES: 0,
  SPX: 0,
  NQ: 0,
  date: "",
};

module.exports = {
  dxClients,
  subscriptions,
  subscriptionTypesBySymbol,
  candleSubscriptions,
  subscriptionCreatedAt,
  subscriptionQueue,
  subscriptionSendingRef: {
    get value() {
      return subscriptionSending;
    },
    set value(next) {
      subscriptionSending = next;
    }
  },
  queuedSubscriptionKeys,
  activeAutoSubscriptionKeys,
  activeCandleSubscriptionKeys,
  dxGreeksCache,
  dxSummaryCache,
  dxQuoteCache,
  dxTradeCache,
  dxCandleCache,
  dxOpenInterestCache,
  marketDataPrevCloseCache,
  marketDataSnapshotCache,
  prevCloseFallbackCache,
  historyDailyCache,
  historyDailyInFlight,
  intradayGreeksHistory,
  gexLevelCache,
  putCallCache,
  spxBootstrapPromiseRef: {
    get value() {
      return spxBootstrapPromise;
    },
    set value(next) {
      spxBootstrapPromise = next;
    }
  },
  spyBootstrapPromiseRef: {
    get value() {
      return spyBootstrapPromise;
    },
    set value(next) {
      spyBootstrapPromise = next;
    }
  },
  qqqBootstrapPromiseRef: {
    get value() {
      return qqqBootstrapPromise;
    },
    set value(next) {
      qqqBootstrapPromise = next;
    }
  },
  livePrevCloses
};
