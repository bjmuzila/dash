#!/usr/bin/env python3
"""Reference Momentum Bias Index (the uploaded pandas version) + a deterministic
data generator, used to numerically verify the JS port in lib/momentumBias.js.

Run:  python3 scripts/momentum-bias-ref.py
Writes scripts/_mb_data.csv (high,low,close) and scripts/_mb_ref.csv
(momentum_up_bias,momentum_down_bias,boundary,bullish_tp,bearish_tp).
Then run: node scripts/momentum-bias-parity.mjs  — which diffs the JS port
against these reference columns.
"""
import os
import pandas as pd
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "_mb_data.csv")
REF = os.path.join(HERE, "_mb_ref.csv")


def calculate_wma(series: pd.Series, length: int) -> pd.Series:
    weights = np.arange(1, length + 1)
    return series.rolling(length).apply(lambda x: np.dot(x, weights) / weights.sum(), raw=True)


def calculate_hma(series: pd.Series, length: int) -> pd.Series:
    half_length = int(length / 2)
    sqrt_length = int(np.sqrt(length))
    wma_half = calculate_wma(series, half_length)
    wma_full = calculate_wma(series, length)
    raw_hma = 2 * wma_half - wma_full
    return calculate_wma(raw_hma, sqrt_length)


def get_momentum_bias_index(df, momentum_length=10, bias_length=5, smooth_length=10,
                            impulse_boundary_length=30, std_dev_multiplier=3.0,
                            smooth_indicator=True):
    res = df.copy()
    momentum = res['close'] - res['close'].shift(momentum_length)
    hl_ema = (res['high'] - res['low']).ewm(span=momentum_length, adjust=False).mean()
    hl_ema = hl_ema.replace(0, 1e-10)
    std_dev = (momentum / hl_ema) * 100
    momentum_up = np.maximum(std_dev, 0)
    momentum_down = np.minimum(std_dev, 0)
    sum_up = momentum_up.rolling(window=bias_length).sum()
    sum_down = momentum_down.rolling(window=bias_length).sum()
    if smooth_indicator:
        res['momentum_up_bias'] = np.maximum(calculate_hma(sum_up, smooth_length), 0)
        res['momentum_down_bias'] = np.maximum(calculate_hma(-sum_down, smooth_length), 0)
    else:
        res['momentum_up_bias'] = sum_up
        res['momentum_down_bias'] = -sum_down
    res['average_bias'] = (res['momentum_up_bias'] + res['momentum_down_bias']) / 2
    avg_bias_ema = res['average_bias'].ewm(span=impulse_boundary_length, adjust=False).mean()
    avg_bias_stdev = res['average_bias'].rolling(window=impulse_boundary_length).std(ddof=0)
    res['boundary'] = avg_bias_ema + (avg_bias_stdev * std_dev_multiplier)
    down_bias_prev1 = res['momentum_down_bias'].shift(1)
    down_bias_prev2 = res['momentum_down_bias'].shift(2)
    crossunder_down = (res['momentum_down_bias'] < down_bias_prev1) & (down_bias_prev1 >= down_bias_prev2)
    res['bullish_tp_signal'] = (crossunder_down & (res['momentum_down_bias'] > res['boundary'])
                                & (res['momentum_down_bias'] > res['momentum_up_bias']))
    up_bias_prev1 = res['momentum_up_bias'].shift(1)
    up_bias_prev2 = res['momentum_up_bias'].shift(2)
    crossunder_up = (res['momentum_up_bias'] < up_bias_prev1) & (up_bias_prev1 >= up_bias_prev2)
    res['bearish_tp_signal'] = (crossunder_up & (res['momentum_up_bias'] > res['boundary'])
                                & (res['momentum_up_bias'] > res['momentum_down_bias']))
    res.drop(columns=['average_bias'], inplace=True)
    return res


def gen_data(n=500, seed=42):
    """Deterministic LCG so the JS side reproduces the exact same inputs by
    reading _mb_data.csv (no numpy RNG dependency across runtimes)."""
    x = seed
    def nxt():
        nonlocal x
        x = (1103515245 * x + 12345) & 0x7FFFFFFF
        return x / 0x7FFFFFFF
    price = 7000.0
    rows = []
    for _ in range(n):
        price += (nxt() - 0.5) * 8.0
        up = nxt() * 2.0 + 0.1
        dn = nxt() * 2.0 + 0.1
        rows.append((price + up, price - dn, price))
    return pd.DataFrame(rows, columns=['high', 'low', 'close'])


if __name__ == "__main__":
    df = gen_data()
    df.to_csv(DATA, index=False)
    out = get_momentum_bias_index(df)
    out[['momentum_up_bias', 'momentum_down_bias', 'boundary',
         'bullish_tp_signal', 'bearish_tp_signal']].to_csv(REF, index=False)
    sig = out[(out['bullish_tp_signal']) | (out['bearish_tp_signal'])]
    print(f"[ref] wrote {DATA} and {REF} ({len(df)} bars, "
          f"{int(out['bullish_tp_signal'].sum())} bull / {int(out['bearish_tp_signal'].sum())} bear signals)")
