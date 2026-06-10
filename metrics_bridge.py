"""
Combined Metrics Bridge: Trading Metrics + Net Premium
Unified HTTP server for saving/retrieving all dashboard metrics
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
from trading_db import TradingMetricsDB
from net_premium_db import NetPremiumDB
from datetime import datetime

app = Flask(__name__)
CORS(app)

# Initialize databases
trading_db = TradingMetricsDB('trading_metrics.db')
net_premium_db = NetPremiumDB('net_premium_metrics.db')

# ============================================================================
# TRADING METRICS ENDPOINTS (existing)
# ============================================================================

@app.route('/save-metrics', methods=['POST'])
def save_metrics():
    """Save trading metrics (MVC, net flow, CVD)."""
    try:
        data = request.json

        timestamp = data.get('timestamp') or datetime.now().strftime('%H:%M:%S')
        mvc = data.get('mvc')
        net_flow = data.get('net_flow')
        cvd = data.get('cvd')

        trading_db.insert_metric(
            timestamp=timestamp,
            mvc=mvc,
            net_flow=net_flow,
            cvd=cvd
        )

        return jsonify({'status': 'success', 'timestamp': timestamp}), 200

    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500


@app.route('/get-metrics', methods=['GET'])
def get_metrics():
    """Get today's trading metrics."""
    try:
        trading_date = datetime.now().strftime('%Y-%m-%d')
        metrics = trading_db.get_day_metrics(trading_date)

        return jsonify({
            'status': 'success',
            'date': trading_date,
            'data': [
                {'timestamp': t, 'mvc': m, 'net_flow': n, 'cvd': c}
                for t, m, n, c in metrics
            ]
        }), 200

    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500


# ============================================================================
# NET PREMIUM ENDPOINTS (new)
# ============================================================================

@app.route('/api/metrics/net-premium', methods=['POST'])
def save_net_premium():
    """Save net premium metric.

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
            trading_date = ts_str.split('T')[0]
        else:
            trading_date = datetime.now().strftime('%Y-%m-%d')

        value = float(data.get('value', 0))
        spot_price = data.get('spotPrice')
        session_time = data.get('sessionTime')

        metric_id = net_premium_db.insert_metric(
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
    """Get net premium history.

    Query params:
    - limit: max records (default 800)
    - date: trading date (default today, YYYY-MM-DD)
    """
    try:
        limit = int(request.args.get('limit', 800))
        trading_date = request.args.get('date', datetime.now().strftime('%Y-%m-%d'))

        limit = min(max(limit, 10), 2000)

        history = net_premium_db.get_history(limit=limit, trading_date=trading_date)

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
    """Get net premium stats for a day."""
    try:
        trading_date = request.args.get('date', datetime.now().strftime('%Y-%m-%d'))

        stats = net_premium_db.get_stats(trading_date)

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
                'stats': None
            }), 200

    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500


@app.route('/api/metrics/net-premium/range', methods=['GET'])
def get_net_premium_range():
    """Get net premium within time range."""
    try:
        start = request.args.get('start')
        end = request.args.get('end')
        trading_date = request.args.get('date', datetime.now().strftime('%Y-%m-%d'))

        if not start or not end:
            return jsonify({
                'status': 'error',
                'message': 'start and end required'
            }), 400

        history = net_premium_db.get_metrics_range(start, end, trading_date)

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
            'count': len(data),
            'data': data
        }), 200

    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500


@app.route('/api/metrics/net-premium/cleanup', methods=['POST'])
def cleanup_old_data():
    """Delete metrics older than N days."""
    try:
        data = request.json
        days_to_keep = int(data.get('days_to_keep', 30))

        deleted_count = net_premium_db.delete_old_data(days_to_keep)

        return jsonify({
            'status': 'success',
            'message': f'Deleted {deleted_count} old records',
            'deleted_count': deleted_count
        }), 200

    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500


# ============================================================================
# HEALTH & INFO
# ============================================================================

@app.route('/health', methods=['GET'])
@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint."""
    return jsonify({
        'status': 'ok',
        'service': 'metrics-bridge',
        'databases': ['trading_metrics.db', 'net_premium_metrics.db']
    }), 200


@app.route('/api/info', methods=['GET'])
def api_info():
    """API documentation."""
    return jsonify({
        'service': 'Unified Metrics Bridge',
        'version': '1.0',
        'endpoints': {
            'trading_metrics': [
                'POST /save-metrics',
                'GET /get-metrics'
            ],
            'net_premium': [
                'POST /api/metrics/net-premium',
                'GET /api/metrics/net-premium/history',
                'GET /api/metrics/net-premium/stats',
                'GET /api/metrics/net-premium/range',
                'POST /api/metrics/net-premium/cleanup'
            ]
        }
    }), 200


if __name__ == '__main__':
    print("=" * 70)
    print("Starting Unified Metrics Bridge (Trading + Net Premium)")
    print("=" * 70)
    print("\nTrading Metrics:")
    print("  POST   /save-metrics        - Save MVC/flow/CVD")
    print("  GET    /get-metrics         - Get today's metrics")
    print("\nNet Premium:")
    print("  POST   /api/metrics/net-premium           - Save snapshot")
    print("  GET    /api/metrics/net-premium/history   - Get 800-point history")
    print("  GET    /api/metrics/net-premium/stats     - Get min/max/avg")
    print("  GET    /api/metrics/net-premium/range     - Get time range")
    print("  POST   /api/metrics/net-premium/cleanup   - Delete old data")
    print("\nHealth:")
    print("  GET    /health              - Health check")
    print("  GET    /api/info            - API documentation")
    print("\nListening on http://0.0.0.0:5001")
    print("=" * 70)

    app.run(host='0.0.0.0', port=5001, debug=True)
