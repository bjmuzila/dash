"""
Bridge script: Save trading metrics from JavaScript to database.
Run this as a simple HTTP server that receives POST requests with metrics data.
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
from trading_db import TradingMetricsDB
from datetime import datetime

app = Flask(__name__)
CORS(app)  # Allow requests from your dashboard

db = TradingMetricsDB()

@app.route('/save-metrics', methods=['POST'])
def save_metrics():
    """
    Endpoint to receive metrics from JavaScript dashboard.
    
    Expected JSON:
    {
        "timestamp": "09:30:15",
        "mvc": 5900.0,
        "net_flow": 45000.25,
        "cvd": 125000
    }
    """
    try:
        data = request.json
        
        timestamp = data.get('timestamp') or datetime.now().strftime('%H:%M:%S')
        mvc = data.get('mvc')
        net_flow = data.get('net_flow')
        cvd = data.get('cvd')
        
        db.insert_metric(
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
    """Get today's metrics."""
    try:
        trading_date = datetime.now().strftime('%Y-%m-%d')
        metrics = db.get_day_metrics(trading_date)
        
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

if __name__ == '__main__':
    print("Starting metrics bridge server on http://localhost:5001")
    print("Dashboard can POST to http://localhost:5001/save-metrics")
    app.run(host='localhost', port=5001, debug=True)
