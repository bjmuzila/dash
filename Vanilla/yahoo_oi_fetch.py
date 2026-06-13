import json
import math
import sys

try:
    import yfinance as yf
except Exception as exc:
    print(json.dumps({"error": f"yfinance import failed: {exc}"}))
    sys.exit(1)


def safe_int(value):
    try:
        if value is None:
            return 0
        n = float(value)
        if math.isnan(n):
            return 0
        return int(n)
    except Exception:
        return 0


def contract_key(symbol: str, exp_date: str, option_type: str, strike) -> str:
    compact = exp_date.replace("-", "")[2:]
    try:
        strike_num = float(strike)
        if math.isnan(strike_num):
            return None
    except Exception:
        return None
    strike_str = str(int(strike_num)) if strike_num.is_integer() else str(round(strike_num, 2)).rstrip("0").rstrip(".")
    return f".{symbol}{compact}{option_type}{strike_str}"


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "usage: yahoo_oi_fetch.py SYMBOL EXPIRY"}))
        sys.exit(1)

    symbol = sys.argv[1].strip().upper()
    exp_date = sys.argv[2].strip()
    if not symbol or not exp_date:
        print(json.dumps({"error": "invalid args"}))
        sys.exit(1)

    try:
        ticker = yf.Ticker(symbol)
        chain = ticker.option_chain(exp_date)
        result = {}

        calls = chain.calls.to_dict(orient='records') if getattr(chain, 'calls', None) is not None else []
        puts = chain.puts.to_dict(orient='records') if getattr(chain, 'puts', None) is not None else []

        for contract in calls:
            key = contract_key(symbol, exp_date, "C", contract.get("strike"))
            if not key:
                continue
            result[key] = {
                "oi": safe_int(contract.get("openInterest")),
                "volume": safe_int(contract.get("volume")),
                "contractSymbol": str(contract.get("contractSymbol") or "").upper(),
            }

        for contract in puts:
            key = contract_key(symbol, exp_date, "P", contract.get("strike"))
            if not key:
                continue
            result[key] = {
                "oi": safe_int(contract.get("openInterest")),
                "volume": safe_int(contract.get("volume")),
                "contractSymbol": str(contract.get("contractSymbol") or "").upper(),
            }

        print(json.dumps({"symbol": symbol, "expDate": exp_date, "items": result}))
    except Exception as exc:
        print(json.dumps({"error": str(exc), "symbol": symbol, "expDate": exp_date}))
        sys.exit(1)


if __name__ == "__main__":
    main()
