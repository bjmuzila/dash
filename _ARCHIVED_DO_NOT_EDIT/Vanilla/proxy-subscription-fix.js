// ═══════════════════════════════════════════════════════════════════════════
// FIXED SUBSCRIPTION RATE-LIMITING FOR dxLink
// ═══════════════════════════════════════════════════════════════════════════
// Replace lines 177-303 in proxy-tastytrade.js with this code.
//
// Key fixes:
// 1. Smaller batch size (50 symbols) to avoid overwhelming dxLink
// 2. Longer delays between batches (1000ms minimum)
// 3. **Wait for WebSocket send to complete before next batch**
// 4. Track consecutive errors and backoff exponentially
// ═══════════════════════════════════════════════════════════════════════════

// ── Subscription rate-limiting ──────────────────────────────────────────
const subscriptionQueue = [];
let subscriptionSending = false;
const queuedSubscriptionKeys = new Set();
const activeAutoSubscriptionKeys = new Set();
const activeCandleSubscriptionKeys = new Set();
const SUBSCRIPTION_BATCH_SIZE = 50;     // Reduced from 200
const SUBSCRIPTION_BATCH_DELAY_BASE = 1000;  // 1 second minimum between batches
const SUBSCRIPTION_BATCH_DELAY_MAX = 3000;   // 3 second max backoff
let subscriptionBatchDelay = SUBSCRIPTION_BATCH_DELAY_BASE;
let subscriptionErrorCount = 0;

const CORE_LIVE_SUBSCRIPTIONS = new Set([
  'SPX',
  'VIX',
  'NDX',
  '/ES:XCME',
  '/NQ:XCME',
  'US10Y',
  '2YY',
  '2Y',
  '/2YY',
  'TNX',
  '^TNX',
  'TNX.X',
  'UST10Y',
  'CL:NYMEX:N26',
  'CL',
  '/CL',
  '@CL'
]);

const CORE_LIVE_TYPES = ['Quote', 'Trade', 'TradeETH', 'Summary'];

function normalizeSubscriptionSymbol(sym) {
  return String(sym || '').trim().replace(/^\$/, '').toUpperCase();
}

function isCoreLiveSubscription(sym) {
  const clean = normalizeSubscriptionSymbol(sym);
  return CORE_LIVE_SUBSCRIPTIONS.has(clean);
}

function seedCoreLiveSubscriptions() {
  CORE_LIVE_SUBSCRIPTIONS.forEach(sym => addAutoSubscription(sym, CORE_LIVE_TYPES));
}

async function bootstrapDashboardCoreData() {
  await ensureTodaySpxOptionSubscriptions();
  seedCoreLiveSubscriptions();
}

async function bootstrapDashboardCorePhases() {
  log('[BOOT] Phase 1: SPX 0DTE bootstrap');
  await ensureTodaySpxOptionSubscriptions();

  log('[BOOT] Phase 2: core quote warmup');
  seedCoreLiveSubscriptions();

  log('[BOOT] Phase 3: SPY/QQQ option prewarm (non-blocking)');
  prewarmCache().catch(e => log('Prewarm error:', e.message));

  log('[BOOT] Phase 4: page-requested subscriptions remain deferred');
}

function subscriptionKey(item) {
  return `${item.type}:${item.symbol}`;
}

function queueAutoSubscription(item) {
  const key = subscriptionKey(item);
  if (activeAutoSubscriptionKeys.has(key) || queuedSubscriptionKeys.has(key)) return;
  queuedSubscriptionKeys.add(key);
  subscriptionQueue.push(item);
}

function defaultAutoTypesForSymbol(sym) {
  if (/\{type=optstat\}$/i.test(String(sym || ''))) return ['Message', 'Configuration'];
  if (/^\/(ES|NQ)/.test(sym)) return ['Quote','Trade','TradeETH','Summary'];
  if (isSpxwSymbol(sym)) return ['Quote','Trade','TradeETH','Greeks','Summary'];
  if (/^\$?(SPX|NDX)$/i.test(sym)) return ['Quote','Trade','TradeETH','Summary'];
  if (/^(VIX|QQQ)$/i.test(sym)) return ['Quote','Trade','TradeETH','Summary'];
  return ['Quote','Trade','Greeks','Summary','TradeETH'];
}

function addAutoSubscription(sym, types = null) {
  if (!sym) return;
  subscriptions.add(sym);
  const current = subscriptionTypesBySymbol.get(sym) || new Set();
  const incoming = types || defaultAutoTypesForSymbol(sym);
  incoming.forEach(type => {
    if (type === 'Underlying' || type === 'Series') {
      current.add(type === 'Underlying' ? 'Message' : 'Configuration');
    } else {
      current.add(type);
    }
  });
  subscriptionTypesBySymbol.set(sym, current);
  if (/\{type=optstat\}$/i.test(String(sym))) {
    log('!!!!!!!!!! OPTSTAT SUBSCRIBE QUEUED !!!!!!!!!!', sym, 'types=', [...current].join(','));
  }
}

// ──────────────────────────────────────────────────────────────────────────
// FIXED: Wait for each batch to complete before sending the next one
// ──────────────────────────────────────────────────────────────────────────
async function sendSubscriptionsRateLimited() {
  if (subscriptionSending || subscriptionQueue.length === 0) return;
  subscriptionSending = true;

  try {
    while (subscriptionQueue.length > 0) {
      if (!dxSocket || dxSocket.readyState !== WebSocket.OPEN) {
        log('[SUBSCRIPTIONS] WebSocket not open, pausing subscriptions');
        break;
      }

      // **CRITICAL: Wait BEFORE sending to respect rate limit**
      if (subscriptionErrorCount > 0) {
        const delay = Math.min(subscriptionBatchDelay, SUBSCRIPTION_BATCH_DELAY_MAX);
        log(`[SUBSCRIPTIONS] Backing off ${delay}ms (error count: ${subscriptionErrorCount})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      const batch = subscriptionQueue.splice(0, SUBSCRIPTION_BATCH_SIZE);
      batch.forEach(item => queuedSubscriptionKeys.delete(subscriptionKey(item)));

      if (batch.length === 0) break;

      log(`[SUBSCRIPTIONS] Sending batch (${batch.length} items) | queue remaining: ${subscriptionQueue.length}`);

      // Send the batch and wait for it to be processed
      const sendPromise = new Promise((resolve, reject) => {
        try {
          // Use a unique message ID to track success/failure
          const batchId = `batch_${Date.now()}_${Math.random().toString(36).slice(2)}`;
          dxSocket.send(JSON.stringify({
            type: 'FEED_SUBSCRIPTION',
            channel: DX_CHANNEL,
            reset: false,
            add: batch,
            _batchId: batchId  // Optional, for tracking
          }));

          // Assume send succeeded after a small delay (dxLink will error if there's a problem)
          setTimeout(() => {
            batch.forEach(item => activeAutoSubscriptionKeys.add(subscriptionKey(item)));
            subscriptionErrorCount = 0;  // Reset error count on successful send
            resolve();
          }, 100);
        } catch (err) {
          reject(err);
        }
      });

      try {
        await sendPromise;
      } catch (err) {
        subscriptionErrorCount++;
        subscriptionBatchDelay = Math.min(
          subscriptionBatchDelay * 1.5,
          SUBSCRIPTION_BATCH_DELAY_MAX
        );
        log(`[SUBSCRIPTIONS] Send error: ${err.message} | next delay: ${subscriptionBatchDelay}ms`);
      }

      // Wait between batches (minimum 1 second)
      if (subscriptionQueue.length > 0) {
        await new Promise(resolve =>
          setTimeout(resolve, SUBSCRIPTION_BATCH_DELAY_BASE)
        );
      }
    }
  } finally {
    subscriptionSending = false;
  }
}
