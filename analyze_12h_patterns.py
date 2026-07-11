import pandas as pd
from datetime import datetime, timedelta
import numpy as np

# Read the data - find the file
import os
import glob

csv_file = None
possible_paths = [
    'ESU6 - 5 min - RTH.csv',
    os.path.expanduser('~/Downloads/ESU6 - 5 min - RTH.csv'),
    os.path.expanduser('~/Desktop/ESU6 - 5 min - RTH.csv'),
]

for path in possible_paths:
    if os.path.exists(path):
        csv_file = path
        break

if csv_file is None:
    # Try glob search
    for path in glob.glob(os.path.expanduser('~/**/*ESU6*.csv'), recursive=True):
        csv_file = path
        break

if csv_file is None:
    print("ERROR: Could not find 'ESU6 - 5 min - RTH.csv'")
    print("Please specify the file path or ensure it's in the current directory")
    exit(1)

print(f"Reading: {csv_file}\n")

df = pd.read_csv(csv_file,
                   names=['timestamp', 'open', 'high', 'low', 'close', 'volume'])

# Parse timestamp
df['dt'] = pd.to_datetime(df['timestamp'], format='%Y%m%d %H%M%S')
df = df.sort_values('dt').reset_index(drop=True)

print(f"Data range: {df['dt'].min()} to {df['dt'].max()}")
print(f"Total 5-min candles: {len(df)}\n")

def create_12h_candles(df, start_hour):
    """Create 12-hour candles starting at specified hour (6 or 18)"""
    candles_list = []
    current_candle = None

    for idx, row in df.iterrows():
        hour = row['dt'].hour
        minute = row['dt'].minute
        date = row['dt'].date()

        # Determine which 12-hour bucket this belongs to
        if start_hour == 6:
            # Buckets: 6:00-17:59 and 18:00-5:59
            if 6 <= hour < 18:
                bucket_start_hour = 6
                bucket_date = date
            else:  # 18-23 or 0-5
                bucket_start_hour = 18
                if hour < 6:
                    bucket_date = (row['dt'] - timedelta(days=1)).date()
                else:
                    bucket_date = date
        else:  # start_hour == 18
            # Buckets: 18:00-5:59 and 6:00-17:59
            if 18 <= hour or hour < 6:
                bucket_start_hour = 18
                if hour < 6:
                    bucket_date = (row['dt'] - timedelta(days=1)).date()
                else:
                    bucket_date = date
            else:
                bucket_start_hour = 6
                bucket_date = date

        bucket_key = (bucket_date, bucket_start_hour)

        # Start new candle if needed
        if current_candle is None or current_candle['key'] != bucket_key:
            if current_candle is not None:
                candles_list.append(current_candle)
            current_candle = {
                'key': bucket_key,
                'date': bucket_date,
                'start_hour': bucket_start_hour,
                'open': row['open'],
                'high': row['high'],
                'low': row['low'],
                'close': row['close'],
                'dt_start': row['dt'],
                'volume': row['volume']
            }
        else:
            # Update current candle
            current_candle['high'] = max(current_candle['high'], row['high'])
            current_candle['low'] = min(current_candle['low'], row['low'])
            current_candle['close'] = row['close']
            current_candle['volume'] += row['volume']

    if current_candle is not None:
        candles_list.append(current_candle)

    return pd.DataFrame(candles_list)

# Classify candle size (for pattern recognition)
def classify_candle_size(candle):
    """
    Classify candle size as relative to recent average
    Returns: 1 (small), 2 (medium), 3 (large)
    """
    body = abs(candle['close'] - candle['open'])
    return body

def get_pattern_label(sizes):
    """
    Convert size sequence to pattern label
    e.g., [2, 1, 2] -> "2-1-2"
    """
    return '-'.join(map(str, sizes))

def get_reversal_direction(sizes, closes):
    """
    Determine if pattern is Bullish or Bearish reversal
    Based on candle positions and closes relative to opening
    """
    # Simple heuristic: look at last close vs first open
    if closes[-1] > closes[0]:
        return 'Bullish'
    else:
        return 'Bearish'

def analyze_pattern_outcomes(candles_df):
    """
    For each 3-candle pattern, check if next candle breaks high/low/both/none
    """
    results = []

    for i in range(len(candles_df) - 3):
        c1 = candles_df.iloc[i]
        c2 = candles_df.iloc[i+1]
        c3 = candles_df.iloc[i+2]
        c_next = candles_df.iloc[i+3]

        # Get pattern sizes (body size relative to typical)
        bodies = [
            abs(c1['close'] - c1['open']),
            abs(c2['close'] - c2['open']),
            abs(c3['close'] - c3['open'])
        ]

        # Normalize to 1-3 scale based on min/max
        body_min = min(bodies)
        body_max = max(bodies)
        body_range = body_max - body_min if body_max > body_min else 1

        sizes = []
        for b in bodies:
            if b <= body_min + body_range * 0.33:
                sizes.append(1)
            elif b <= body_min + body_range * 0.66:
                sizes.append(2)
            else:
                sizes.append(3)

        # Pattern name
        pattern = get_pattern_label(sizes)
        direction = get_reversal_direction(sizes, [c1['close'], c2['close'], c3['close']])
        pattern_name = f"{pattern} {direction} Reversal"

        # Check breakout on next candle
        pattern_high = max(c1['high'], c2['high'], c3['high'])
        pattern_low = min(c1['low'], c2['low'], c3['low'])
        next_high = c_next['high']
        next_low = c_next['low']

        broke_high = next_high > pattern_high
        broke_low = next_low < pattern_low

        if broke_high and broke_low:
            outcome = 'Broke Both'
        elif broke_high:
            outcome = 'Broke High'
        elif broke_low:
            outcome = 'Broke Low'
        else:
            outcome = 'Broke None'

        results.append({
            'candle_idx': i,
            'date': c1['date'],
            'pattern': pattern_name,
            'c1_open': c1['open'],
            'c1_close': c1['close'],
            'c2_open': c2['open'],
            'c2_close': c2['close'],
            'c3_open': c3['open'],
            'c3_close': c3['close'],
            'pattern_high': pattern_high,
            'pattern_low': pattern_low,
            'next_high': next_high,
            'next_low': next_low,
            'outcome': outcome
        })

    return pd.DataFrame(results)

# Create 12-hour candles for both start times
print("=" * 70)
print("6AM START (6am-6pm and 6pm-6am)")
print("=" * 70)
candles_6am = create_12h_candles(df, 6)
print(candles_6am[['date', 'start_hour', 'open', 'high', 'low', 'close']].head(15))
print(f"\nTotal 12-hour candles: {len(candles_6am)}\n")

results_6am = analyze_pattern_outcomes(candles_6am)

# Stats for 6am start
print("\n6AM START - PATTERN OUTCOMES:")
print("-" * 70)
outcome_counts_6am = results_6am['outcome'].value_counts()
pattern_outcome_6am = pd.crosstab(results_6am['pattern'], results_6am['outcome'], margins=True)

print("\nOutcome Summary:")
print(outcome_counts_6am)
print(f"\nTotal patterns: {len(results_6am)}")
print(f"\nPercentages:")
for outcome, count in outcome_counts_6am.items():
    pct = 100 * count / len(results_6am)
    print(f"  {outcome}: {count:3d} ({pct:5.1f}%)")

print("\n\nPattern x Outcome Crosstab (6AM Start):")
print(pattern_outcome_6am)

# Save detailed results
results_6am.to_csv('patterns_12h_6am_start.csv', index=False)

print("\n" + "=" * 70)
print("6PM START (6pm-6am and 6am-6pm)")
print("=" * 70)
candles_6pm = create_12h_candles(df, 18)
print(candles_6pm[['date', 'start_hour', 'open', 'high', 'low', 'close']].head(15))
print(f"\nTotal 12-hour candles: {len(candles_6pm)}\n")

results_6pm = analyze_pattern_outcomes(candles_6pm)

# Stats for 6pm start
print("\n6PM START - PATTERN OUTCOMES:")
print("-" * 70)
outcome_counts_6pm = results_6pm['outcome'].value_counts()
pattern_outcome_6pm = pd.crosstab(results_6pm['pattern'], results_6pm['outcome'], margins=True)

print("\nOutcome Summary:")
print(outcome_counts_6pm)
print(f"\nTotal patterns: {len(results_6pm)}")
print(f"\nPercentages:")
for outcome, count in outcome_counts_6pm.items():
    pct = 100 * count / len(results_6pm)
    print(f"  {outcome}: {count:3d} ({pct:5.1f}%)")

print("\n\nPattern x Outcome Crosstab (6PM Start):")
print(pattern_outcome_6pm)

# Save detailed results
results_6pm.to_csv('patterns_12h_6pm_start.csv', index=False)

print("\n" + "=" * 70)
print("FILES SAVED:")
print("  - patterns_12h_6am_start.csv (detailed results)")
print("  - patterns_12h_6pm_start.csv (detailed results)")
print("=" * 70)
