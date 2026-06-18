"""
Net Premium API
Flask endpoints for saving and retrieving net premium sparkline data
Add this to your metrics_bridge.py or run as standalone server
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
from net_premium_db import NetPremiumDB
from datetime import datetime

app = Flask(__name__)
CORS(app)

db = NetPremiumDB()

# ============================================================================
# NET PREMIUM ENDPOINTS
# ============================================================================

@app.route('/api/metrics/net-premium', methods=['POST'])
def save_net_premium():
    """
    Save a net premium metric snapshot.

    Expected JSON:
    {
        "timestamp": "2026-06-10T14:30:00Z",
        "value": -363981,
        "spotPrice": 5500,
        "sessionTime": 870
    }
    """
    try:
        data = request.json

        # Parse ISO timestamp to extract date
        ts_str = data.get('timestamp', '')
        if 'T' in ts_str:
            trading_date = ts_str.split('T')[0]  # "2026-06-10"
        else:
            trading_date = datetime.now().strftime('%Y-%m-%d')

        value = float(data.get('value', 0))
        spot_price = data.get('spotPrice')
        session_time = data.get('sessionTime')

        # Insert metric
        metric_id = db.insert_metric(
            timestamp=ts_str,
            value=value,
            spot_price=spot_price,
            session_time=session_time,
            trading_date=trading_date
        )

        if metric_id:
            return jsonify({
                'status': 'success',
                'id': metric_id,
                'timestamp': ts_str,
                'value': value
            }), 200
        else:
            return jsonify({'status': 'error', 'message': 'Failed to save'}), 500

    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500


@app.route('/api/metrics/net-premium/history', methods=['GET'])
def get_net_premium_history():
    """
    Get net premium history for today.

    Query params:
    - limit: max records to return (default 800)
    - date: trading date (default today, format YYYY-MM-DD)

    Returns:
    {
        "status": "success",
        "date": "2026-06-10",
        "data": [
            {
                "timestamp": "2026-06-10T09:30:00Z",
                "value": -363981,
                "spotPrice": 5500,
                "sessionTime": 570
            },
            ...
        ]
    }
    """
    try:
        limit = int(request.args.get('limit', 800))
        trading_date = request.args.get('date', datetime.now().strftime('%Y-%m-%d'))

        # Clamp limit to reasonable range
        limit = min(max(limit, 10), 2000)

        history = db.get_history(limit=limit, trading_date=trading_date)

        return jsonify({
            'status': 'success',
            'date': trading_date,
            'count': len(history),
            'data': history
        }), 200

    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500


@app.route('/api/metrics/net-premium/stats', methods=['GET'])
def get_net_premium_stats():
    """
    Get statistics for net premium on a trading day.

    Query params:
    - date: trading date (default today, format YYYY-MM-DD)

    Returns:
    {
        "status": "success",
        "date": "2026-06-10",
        "stats": {
            "min": -1200000,
            "max": 2100000,
            "avg": 450000,
            "count": 100
        }
    }
    """
    try:
        trading_date = request.args.get('date', datetime.now().strftime('%Y-%m-%d'))

        stats = db.get_stats(trading_date)

        if stats:
            return jsonify({
                'status': 'success',
                'date': trading_date,
                'stats': stats
            }), 200
        else:
            return jsonify({
                'status': 'success',
                'date': trading_date,
                'stats': None,
                'message': 'No data for this date'
            }), 200

    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500


@app.route('/api/metrics/net-premium/range', methods=['GET'])
def get_net_premium_range():
    """
    Get net premium data within a specific time range.

    Query params:
    - start: start timestamp (ISO format)
    - end: end timestamp (ISO format)
    - date: trading date (YYYY-MM-DD)
    """
    try:
        start = request.args.get('start')
        end = request.args.get('end')
        trading_date = request.args.get('date', datetime.now().strftime('%Y-%m-%d'))

        if not start or not end:
            return jsonify({
                'status': 'error',
                'message': 'start and end timestamps required'
            }), 400

        history = db.get_metrics_range(start, end, trading_date)

        data = [
            {
                'timestamp': ts,
                'value': value,
                'spotPrice': spot_price,
                'sessionTime': session_time
            }
            for ts, value, spot_price, session_time in history
        ]

        return jsonify({
            'status': 'success',
            'date': trading_date,
            'start': start,
            'end': end,
            'count': len(data),
            'data': data
        }), 200

    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500


@app.route('/api/metrics/net-premium/cleanup', methods=['POST'])
def cleanup_old_data():
    """
    Delete metrics older than specified days.

    Expected JSON:
    {
        "days_to_keep": 30
    }
    """
    try:
        data = request.json
        days_to_keep = int(data.get('days_to_keep', 30))

        deleted_count = db.delete_old_data(days_to_keep)

        return jsonify({
            'status': 'success',
            'message': f'Deleted {deleted_count} old records',
            'deleted_count': deleted_count
        }), 200

    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500


# ============================================================================
# HEALTH CHECK
# ============================================================================

@app.route('/api/metrics/health', methods=['GET'])
def health_check():
    """Check if API is running."""
    return jsonify({'status': 'ok', 'service': 'net-premium-api'}), 200


if __name__ == '__main__':
    print("Starting Net Premium API server on http://localhost:5001")
    print("POST   /api/metrics/net-premium - Save net premium metric")
    print("GET    /api/metrics/net-premium/history - Get daily history")
    print("GET    /api/metrics/net-premium/stats - Get daily stats")
    print("GET    /api/metrics/net-premium/range - Get time range data")
    print("POST   /api/metrics/net-premium/cleanup - Delete old data")
    print("GET    /api/metrics/health - Health check")
    app.run(host='0.0.0.0', port=5001, debug=True)
