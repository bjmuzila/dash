// Estimated moves calculations

export interface EMSnapshot {
  date: string;
  symbol: string;
  spotPrice: number;
  straddleMid: number;
  estimatedMove: number;       // points
  estimatedMovePct: number;    // percent
  upperBound: number;
  lowerBound: number;
}

export interface EMRow {
  ticker: string;
  close: number;
  em: number;
  up: number;
  down: number;
  expiration: string;
  strike?: number;
  error?: string;
}

/** Calculate estimated move from ATM straddle mid price */
export function calcEstimatedMove(
  spotPrice: number,
  atmCallMid: number,
  atmPutMid: number
): Pick<EMSnapshot, "estimatedMove" | "estimatedMovePct" | "upperBound" | "lowerBound" | "straddleMid"> {
  const straddleMid = (atmCallMid + atmPutMid) / 2;
  const estimatedMove = Math.round(straddleMid * 0.84 * 100) / 100;
  const estimatedMovePct = Math.round((estimatedMove / spotPrice) * 10000) / 100;
  return {
    straddleMid,
    estimatedMove,
    estimatedMovePct,
    upperBound: Math.round((spotPrice + estimatedMove) * 100) / 100,
    lowerBound: Math.round((spotPrice - estimatedMove) * 100) / 100,
  };
}

/** Format price for display (special handling for ES/NQ futures) */
export function fmtPrice(ticker: string, num: number): string {
  if (!ticker || typeof ticker !== 'string') return '—';
  const isES = ticker === 'ESM' || ticker === 'NQM' || ticker === '/ES' || ticker === '/NQ';
  const n = isES ? Math.round(Number(num) * 4) / 4 : Number(num);
  return Number.isFinite(n) ? n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }) : '—';
}

/** Format EM for display */
export function fmtEm(num: number): string {
  const n = Number(num);
  return Number.isFinite(n) && n >= 0 ? n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 3
  }) : '—';
}

/** Calculate days to expiration at 4 PM */
export function daysTo(exp: string): number {
  return Math.ceil((new Date(exp + 'T16:00:00').getTime() - new Date().getTime()) / 86400000);
}

/** Format expiration date for display */
export function labelForDate(exp: string): string {
  if (!exp) return '--';
  const d = new Date(exp + 'T12:00:00');
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** Calculate next Friday date */
export function nextFridayLabel(): string {
  const d = new Date();
  const add = (5 - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + add);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
