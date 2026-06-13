#!/usr/bin/env python3
"""
Daily scraper for Trump calendar from factba.se
Filters out: travel, pool calls, weekend events
Keeps: official schedule, press briefings
"""

import json
import re
from datetime import datetime
from pathlib import Path
from urllib.request import urlopen
from urllib.error import URLError

# Keywords to exclude (case insensitive)
EXCLUDE_KEYWORDS = [
    'travel',
    'pool',
    'in town',
    'departure',
    'arrival',
]

def fetch_calendar():
    """Fetch the raw calendar JSON from factba.se"""
    url = "https://media-cdn.factba.se/rss/json/trump/calendar-full.json"
    try:
        with urlopen(url, timeout=10) as response:
            return json.loads(response.read().decode('utf-8'))
    except Exception as e:
        print(f"Error fetching calendar: {e}")
        return []

def is_weekend(date_str):
    """Check if date is Saturday or Sunday"""
    try:
        date_obj = datetime.strptime(date_str, "%Y-%m-%d")
        return date_obj.weekday() >= 5  # 5=Saturday, 6=Sunday
    except:
        return False

def should_include(event):
    """Filter logic: include event if it passes criteria"""
    details = (event.get('details') or '').lower()
    daily_text = (event.get('daily_text') or '').lower()
    event_type = (event.get('type') or '').lower()
    text = f"{event_type} {details} {daily_text}".lower()

    # Exclude if it's a weekend event
    if is_weekend(event.get('date', '')):
        return False

    # Exclude if contains excluded keywords
    for keyword in EXCLUDE_KEYWORDS:
        if keyword in text:
            return False

    # If we got here, no excluded keywords found—include it
    return True

def format_output(events):
    """Format filtered events for easy copy-paste into overview"""
    filtered = [e for e in events if should_include(e)]

    output = {
        'fetched': datetime.now().isoformat(),
        'count': len(filtered),
        'events': filtered
    }

    return output

def main():
    """Fetch, filter, and save calendar"""
    try:
        print(f"[{datetime.now()}] Fetching Trump calendar...")

        events = fetch_calendar()
        if not events:
            print("No events fetched")
            return

        print(f"Fetched {len(events)} total events")

        filtered = format_output(events)
        print(f"Filtered to {filtered['count']} events (excluded travel/pool/weekend)")

        # Save to file
        output_dir = Path(__file__).parent / 'data'
        output_dir.mkdir(exist_ok=True)

        output_file = output_dir / f"trump_calendar_{datetime.now().strftime('%Y%m%d')}.json"
        with open(output_file, 'w') as f:
            json.dump(filtered, f, indent=2)

        print(f"Saved to: {output_file}")

        # Also save latest version
        latest_file = output_dir / "trump_calendar_latest.json"
        with open(latest_file, 'w') as f:
            json.dump(filtered, f, indent=2)

        # Print summary
        print("\n=== FILTERED EVENTS ===")
        for event in filtered['events'][:5]:  # Show first 5
            print(f"{event.get('date')} - {event.get('title', 'N/A')}")
        if len(filtered['events']) > 5:
            print(f"... and {len(filtered['events']) - 5} more")
    except Exception as e:
        print(f"FATAL ERROR: {e}")
        import traceback
        traceback.print_exc()

if __name__ == '__main__':
    main()
