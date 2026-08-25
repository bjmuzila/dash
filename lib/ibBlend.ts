/**
 * lib/ibBlend.ts
 *
 * ONE number out of many conditions — the joined read.
 *
 * THE PROBLEM. Tick nine things that are true of the session and the book has
 * four days matching all nine. Four days is not a rate, it is an anecdote: it
 * prints 0% and 100% and neither means "never" or "always". But the book knows
 * a great deal about each of those nine conditions SEPARATELY — hundreds or
 * thousands of days apiece — and throwing that away because the exact
 * nine-way intersection is empty is the whole problem, not the solution.
 *
 * So: stack the evidence instead of intersecting it, and let the exact
 * intersection earn its way back in as it fattens.
 *
 * THE METHOD, in four steps.
 *
 *   1. SHRINK EACH CRITERION. A criterion's own rate is measured against the
 *      whole book, then pulled toward the book's base rate in proportion to how
 *      little data stands behind it: p̂ = (K·p₀ + n·p) / (K + n). A criterion
 *      with 800 days behind it barely moves; one with 12 barely counts. K is
 *      PRIOR_K below.
 *
 *   2. TURN EACH INTO EVIDENCE. Work in log-odds, where independent evidence
 *      adds: w = logit(p̂) − logit(p₀). Positive w pushes the outcome up,
 *      negative down, and the size is how hard.
 *
 *   3. DAMP FOR OVERLAP — and CALIBRATE the damping, don't guess it. These
 *      criteria are anything but independent ("ORB down" and "broke IB low"
 *      are nearly the same statement), so adding their w's raw would double,
 *      triple and quadruple-count the same evidence and spit out 99%. The
 *      classic fix is a fudge factor. Instead this measures it: for every PAIR
 *      of ticked criteria with a real sample behind it, compare what the stack
 *      PREDICTS for that pair against what the book actually DID for that pair.
 *      The median ratio across pairs is λ — how much of the stacked evidence
 *      survives contact with reality. λ near 1 means the picks are pulling in
 *      genuinely different directions; λ near 0.2 means they are eight ways of
 *      saying one thing. Pairs are used because a pair still has a real sample
 *      when the nine-way intersection has four days.
 *
 *          logit(p_stacked) = logit(p₀) + λ · Σ w
 *
 *   4. BACK OFF TOWARD THE EXACT COHORT. The stack is an estimate built out of
 *      parts; the exact intersection, when it has any size, is the real thing.
 *      Blend them by that size:
 *
 *          joined = (n_exact · p_exact + B · p_stacked) / (n_exact + B)
 *
 *      With four matching days the joined number is nearly all stack. With
 *      three hundred it is nearly all exact cohort, and the estimator quietly
 *      turns back into a plain conditional rate. Nothing switches modes; it
 *      slides.
 *
 * WHAT THIS IS NOT. It is not a forecast and it does not know about regime,
 * seasonality, or anything outside the IB book. It is the book's own history,
 * read in a way that does not throw away nine-tenths of itself the moment you
 * ask a specific question. Treat a joined number as a better-founded prior than
 * either the raw base rate or a four-day cohort — not as a probability with a
 * decimal place worth of meaning.
 *
 * Everything works on Uint8Array masks so the caller can build them once and
 * blend every outcome cheaply; see makeMask.
 */

/** Rate shrinkage: sessions of evidence needed before a criterion's own rate
 *  outweighs the book's base rate. */
const PRIOR_K = 40;
/** Backoff: matching sessions needed before the exact cohort outweighs the
 *  stack. Deliberately small — an exact cohort IS the better answer once it
 *  exists at all, it just has to exist. */
const BACKOFF_K = 25;
/** A pair needs at least this many sessions to be worth calibrating λ on. */
const PAIR_MIN = 40;
/** λ is clamped: never more than all of the evidence, never less than a tenth. */
const LAMBDA_LO = 0.1;
const LAMBDA_HI = 1;
/** Below this, a pair's stacked prediction is too small to divide by. */
const CALIB_FLOOR = 0.25;

const CLAMP = 1e-4;
export const logit = (p: number) => {
  const q = Math.min(1 - CLAMP, Math.max(CLAMP, p));
  return Math.log(q / (1 - q));
};
export const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

const median = (a: number[]) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Build a 0/1 mask over `rows` from a predicate. */
export function makeMask<T>(rows: T[], f: (d: T) => boolean): Uint8Array {
  const m = new Uint8Array(rows.length);
  for (let i = 0; i < rows.length; i++) m[i] = f(rows[i]) ? 1 : 0;
  return m;
}

function countAnd(a: Uint8Array, b: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] & b[i]) n++;
  return n;
}
function count(a: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i]) n++;
  return n;
}
function countAnd3(a: Uint8Array, b: Uint8Array, c: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] & b[i] & c[i]) n++;
  return n;
}

export type Marginal = {
  /** sessions in the book matching this criterion alone */
  n: number;
  /** its raw outcome rate */
  raw: number;
  /** that rate pulled toward the base rate by how little data it has */
  shrunk: number;
  /** its evidence, in log-odds off the base rate */
  w: number;
};

export type Blend = {
  /** the book's own rate for this outcome */
  p0: number;
  /** the exact intersection's rate, null when nothing matches all of them */
  exact: number | null;
  exactN: number;
  /** the stacked estimate, before backing off toward the exact cohort */
  stacked: number;
  /** THE JOINED NUMBER */
  joined: number;
  /** how much of the stacked evidence survived the overlap check */
  lambda: number;
  /** how many pairs λ was measured on — 0 means it fell back to a default */
  lambdaPairs: number;
  marg: Marginal[];
};

/**
 * The joined read for one outcome.
 *
 * @param preds one mask per ticked criterion, over the same rows
 * @param out   the outcome's mask, over the same rows
 */
export function blendMasks(preds: Uint8Array[], out: Uint8Array, rowCount: number): Blend {
  const p0 = rowCount ? count(out) / rowCount : 0;
  const l0 = logit(p0);

  if (!rowCount || !preds.length) {
    return { p0, exact: preds.length ? null : p0, exactN: preds.length ? 0 : rowCount, stacked: p0, joined: p0, lambda: 1, lambdaPairs: 0, marg: [] };
  }

  // 1 + 2 — each criterion, shrunk, as evidence in log-odds
  const marg: Marginal[] = preds.map((m) => {
    const n = count(m);
    const raw = n ? countAnd(m, out) / n : p0;
    const shrunk = (PRIOR_K * p0 + n * raw) / (PRIOR_K + n);
    return { n, raw, shrunk, w: logit(shrunk) - l0 };
  });

  // 3 — measure how much of the stacked evidence the book actually honours,
  //     using pairs (which still have a sample when the full stack does not)
  const ratios: number[] = [];
  for (let i = 0; i < preds.length; i++) {
    for (let j = i + 1; j < preds.length; j++) {
      const naive = marg[i].w + marg[j].w;
      if (Math.abs(naive) < CALIB_FLOOR) continue;
      const nij = countAnd(preds[i], preds[j]);
      if (nij < PAIR_MIN) continue;
      const rawij = countAnd3(preds[i], preds[j], out) / nij;
      const pij = (PRIOR_K * p0 + nij * rawij) / (PRIOR_K + nij);
      ratios.push((logit(pij) - l0) / naive);
    }
  }
  const measured = median(ratios);
  // No usable pair: fall back to 1/√m, the standard hedge for m overlapping
  // signals. One criterion is never damped — there is nothing to double-count.
  const lambda = Math.min(
    LAMBDA_HI,
    Math.max(LAMBDA_LO, measured ?? 1 / Math.sqrt(Math.max(1, preds.length))),
  );

  const stacked = sigmoid(l0 + lambda * marg.reduce((s, m) => s + m.w, 0));

  // 4 — back off toward the exact intersection by how much of it there is
  let exactN = 0;
  let exactK = 0;
  for (let i = 0; i < rowCount; i++) {
    let all = 1;
    for (let p = 0; p < preds.length; p++) {
      if (!preds[p][i]) {
        all = 0;
        break;
      }
    }
    if (all) {
      exactN++;
      if (out[i]) exactK++;
    }
  }
  const exact = exactN ? exactK / exactN : null;
  const joined = exactN ? (exactN * exact! + BACKOFF_K * stacked) / (exactN + BACKOFF_K) : stacked;

  return { p0, exact, exactN, stacked, joined, lambda, lambdaPairs: ratios.length, marg };
}

/**
 * The deepest sub-combination the book can actually support.
 *
 * Greedy: while the intersection is under `min`, drop whichever criterion frees
 * up the most sessions. Returns the indices kept, and that subset's plain
 * conditional rate — no stacking, no shrinkage. It is the honest "how far in
 * can I go before the book runs out" answer, and a useful sanity check on the
 * joined number: they should not be wildly apart.
 */
export function deepestSupported(
  preds: Uint8Array[],
  out: Uint8Array,
  rowCount: number,
  min = 30,
): { keep: number[]; dropped: number[]; p: number; n: number } | null {
  if (!preds.length || !rowCount) return null;

  const sizeOf = (keep: number[]) => {
    let n = 0;
    let k = 0;
    for (let i = 0; i < rowCount; i++) {
      let all = 1;
      for (const p of keep) {
        if (!preds[p][i]) {
          all = 0;
          break;
        }
      }
      if (all) {
        n++;
        if (out[i]) k++;
      }
    }
    return { n, k };
  };

  let keep = preds.map((_, i) => i);
  const dropped: number[] = [];
  let cur = sizeOf(keep);

  while (cur.n < min && keep.length > 1) {
    let best = -1;
    let bestN = -1;
    for (const p of keep) {
      const trial = sizeOf(keep.filter((x) => x !== p));
      if (trial.n > bestN) {
        bestN = trial.n;
        best = p;
      }
    }
    if (best < 0) break;
    keep = keep.filter((x) => x !== best);
    dropped.push(best);
    cur = sizeOf(keep);
  }

  return cur.n ? { keep, dropped, p: cur.k / cur.n, n: cur.n } : null;
}
