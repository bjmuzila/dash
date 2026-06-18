import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Target, Settings2, Activity, Shield, Crosshair, Clock, Hash } from 'lucide-react';

const PRICE_BUCKET_ES = 0.50;
const PRICE_BUCKET_NQ = 2.00;

const OrderClusterCanvas = ({ instrument, tradesRef, minSize, fadeMinutes, currentPrice, priceBucket, accentColor }) => {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const requestRef = useRef();
  const mouseRef = useRef({ x: null, y: null });

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const handleResize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);
    handleResize();

    const handleMouseMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const handleMouseLeave = () => {
      mouseRef.current = { x: null, y: null };
    };

    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      resizeObserver.disconnect();
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, []);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const width = parseFloat(canvas.style.width);
    const height = parseFloat(canvas.style.height);
    
    if (!width || !height) {
        requestRef.current = requestAnimationFrame(render);
        return;
    }

    ctx.clearRect(0, 0, width, height);

    const now = Date.now();
    const maxAgeMs = fadeMinutes * 60 * 1000;
    const oldestVisibleTime = now - maxAgeMs;

    // Filter and bucket active trades
    const activeTrades = tradesRef.current.filter(t => t.timestamp >= oldestVisibleTime && t.size >= minSize);
    
    const clusters = {};
    let highestClusterVolume = 0;

    activeTrades.forEach(t => {
      const bucket = Math.floor(t.price / priceBucket) * priceBucket;
      if (!clusters[bucket]) {
        clusters[bucket] = { buys: [], sells: [], totalVol: 0 };
      }
      if (t.side === 'buy') clusters[bucket].buys.push(t);
      else clusters[bucket].sells.push(t);
      
      clusters[bucket].totalVol += t.size;
      if (clusters[bucket].totalVol > highestClusterVolume) {
        highestClusterVolume = clusters[bucket].totalVol;
      }
    });

    // Axis Settings
    const priceRows = 35; 
    const minVisiblePrice = currentPrice - (priceRows * priceBucket);
    const maxVisiblePrice = currentPrice + (priceRows * priceBucket);
    const priceRange = maxVisiblePrice - minVisiblePrice;
    
    const getY = (price) => height - ((price - minVisiblePrice) / priceRange) * height;
    const centerX = width / 2;

    ctx.lineWidth = 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#64748b';
    ctx.font = '10px ui-sans-serif';

    for (let i = 0; i <= priceRows; i++) {
      const price = minVisiblePrice + (i * priceBucket);
      const y = getY(price);
      
      ctx.strokeStyle = price === Math.floor(currentPrice / priceBucket) * priceBucket ? '#475569' : '#1e293b';
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();

      if (i % 5 === 0) {
        ctx.fillText(price.toFixed(2), 30, y);
      }
    }

    // Current Price Line
    const curY = getY(currentPrice);
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, curY);
    ctx.lineTo(width, curY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 1;

    // Draw Clusters
    Object.entries(clusters).sort((a, b) => b[1].totalVol - a[1].totalVol).forEach(([priceStr, cluster]) => {
        const price = parseFloat(priceStr);
        const y = getY(price);
        const midY = y;

        const buyVolume = cluster.buys.reduce((sum, t) => sum + t.size, 0);
        const sellVolume = cluster.sells.reduce((sum, t) => sum + t.size, 0);
        const totalVol = cluster.totalVol;
        const barWidthPercent = (totalVol / highestClusterVolume) * 50;

        const isAskHeavy = buyVolume > sellVolume;
        const [r, g, b] = isAskHeavy ? [74, 222, 128] : [248, 113, 113]; // green : red
        const alpha = 0.7 * (totalVol / highestClusterVolume) + 0.3;

        // Draw bar (centered)
        const barPixelWidth = (barWidthPercent / 100) * width;
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
        ctx.fillRect(centerX - barPixelWidth / 2, midY - height/(priceRows*2), barPixelWidth, height/priceRows);

        // Volume Label (Left Side)
        ctx.textAlign = 'left';
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 11px ui-sans-serif';
        ctx.fillText(totalVol.toString(), 60, midY);

        // Type Label (Right Side)
        ctx.textAlign = 'right';
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.8)`;
        ctx.font = 'bold 10px ui-sans-serif';
        ctx.fillText(isAskHeavy ? 'ASK HEAVY' : 'BID HEAVY', width - 25, midY);
    });

    if (mouseRef.current.y !== null) {
      const { y } = mouseRef.current;
      const cursorPrice = maxVisiblePrice - (y / height) * priceRange;
      const roundedPrice = Math.floor(cursorPrice / priceBucket) * priceBucket;
      const snapY = getY(roundedPrice);

      ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.fillRect(0, snapY - height/(priceRows*2), width, height/priceRows);
      
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(0, snapY);
      ctx.lineTo(width, snapY);
      ctx.stroke();
      ctx.setLineDash([]);
      
      // Tooltip
      if (clusters[roundedPrice]) {
        const { totalVol, buys, sells } = clusters[roundedPrice];
        ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
        ctx.strokeStyle = '#334155';
        ctx.roundRect(mouseRef.current.x + 15, snapY - 20, 100, 50, 4);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#fff';
        ctx.textAlign = 'left';
        ctx.font = 'bold 11px ui-sans-serif';
        ctx.fillText(`Vol: ${totalVol}`, mouseRef.current.x + 22, snapY - 3);
        ctx.font = '10px ui-sans-serif';
        ctx.fillStyle = '#4ade80';
        ctx.fillText(`Asks: ${buys.length}`, mouseRef.current.x + 22, snapY + 10);
        ctx.fillStyle = '#f87171';
        ctx.fillText(`Bids: ${sells.length}`, mouseRef.current.x + 22, snapY + 22);
      }
    }

    requestRef.current = requestAnimationFrame(render);
  }, [minSize, fadeMinutes, currentPrice, priceBucket]);

  useEffect(() => {
    requestRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(requestRef.current);
  }, [render]);

  return (
    <div className="flex-1 flex flex-col bg-slate-900 rounded-xl border border-slate-800 shadow-xl overflow-hidden relative">
      <div className="flex justify-between items-center px-4 py-3 border-b border-slate-800 bg-slate-900/90 z-10">
        <h2 className={`text-sm font-bold flex items-center gap-2 ${accentColor}`}>
          <Target className="w-5 h-5" />
          {instrument} Order Flow
        </h2>
        <div className="text-xs text-slate-400 font-mono">
           Bucket: {priceBucket.toFixed(2)}
        </div>
      </div>
      <div ref={containerRef} className="flex-1 w-full relative cursor-crosshair">
        <canvas ref={canvasRef} className="absolute inset-0 block" />
      </div>
    </div>
  );
};

const FuturesFlowDashboard = () => {
  const [esMinSize, setEsMinSize] = useState(20);
  const [nqMinSize, setNqMinSize] = useState(10);
  const [fadeMinutes, setFadeMinutes] = useState(15);
  const [esPrice, setEsPrice] = useState(5900.00);
  const [nqPrice, setNqPrice] = useState(20800.00);
  const [clusterEvents, setClusterEvents] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  
  const esTradesRef = useRef([]);
  const nqTradesRef = useRef([]);
  const eventsRef = useRef([]);
  const wsRef = useRef(null);

  // Fetch initial prices from TastyTrade quotes
  useEffect(() => {
    const fetchInitialPrices = async () => {
      try {
        // proxy removed — initial prices from dxLink cache only
        const items = [];
        items.forEach(q => {
            const sym = q.symbol || '';
            const price = parseFloat(q.last || q.mark || q.mid || 0);
            if (sym.startsWith('/ES') && price > 0) setEsPrice(price);
            if (sym.startsWith('/NQ') && price > 0) setNqPrice(price);
          });
        }
      } catch (e) {
        console.error('Failed to fetch initial prices:', e);
      }
    };
    fetchInitialPrices();
  }, []);

  // Connect to dxLink WebSocket for time & sales
  useEffect(() => {
    const ws = new WebSocket('ws://localhost:3001/ws/dxlink');
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('dxLink WebSocket connected');
      setIsConnected(true);
      
      // Subscribe to ES and NQ time & sales (Trade feed)
      ws.send(JSON.stringify({
        type: 'subscribe',
        symbols: ['/ESU26', '/NQM26']
      }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        
        // Handle FEED_DATA messages from dxLink
        if (msg.type === 'FEED_DATA' && Array.isArray(msg.data)) {
          msg.data.forEach(item => {
            if (item.eventType !== 'Trade') return;
            
            const symbol = item.eventSymbol || '';
            const price = parseFloat(item.price || 0);
            const size = parseInt(item.size || 0);
            const timestamp = item.time || Date.now();
            
            // Determine if buy or sell based on aggressor side
            // TastyTrade: aggressorSide: 'BUY' means trade hit the ask (buyer aggressive)
            const aggressorSide = item.aggressorSide || '';
            const side = aggressorSide === 'BUY' ? 'buy' : aggressorSide === 'SELL' ? 'sell' : (Math.random() > 0.5 ? 'buy' : 'sell');
            
            if (!price || !size) return;

            const trade = { timestamp, price, size, side };

            if (symbol.startsWith('/ES')) {
              esTradesRef.current.push(trade);
              setEsPrice(price);
              
              // Detect cluster (rapid trades at same price)
              const recentES = esTradesRef.current.filter(t => 
                Math.abs(t.timestamp - timestamp) < 5000 && 
                Math.abs(t.price - price) < PRICE_BUCKET_ES
              );
              if (recentES.length > 8) {
                const totalVol = recentES.reduce((sum, t) => sum + t.size, 0);
                if (totalVol >= 300) {
                  eventsRef.current.unshift({
                    id: Math.random().toString(),
                    timestamp,
                    instrument: 'ES',
                    price,
                    side,
                    volume: totalVol,
                    trades: recentES.length
                  });
                  if (eventsRef.current.length > 50) eventsRef.current.pop();
                  setClusterEvents([...eventsRef.current]);
                }
              }
              
              // Memory cleanup
              if (esTradesRef.current.length > 5000) esTradesRef.current.splice(0, 1000);
            } else if (symbol.startsWith('/NQ')) {
              nqTradesRef.current.push(trade);
              setNqPrice(price);
              
              const recentNQ = nqTradesRef.current.filter(t => 
                Math.abs(t.timestamp - timestamp) < 5000 && 
                Math.abs(t.price - price) < PRICE_BUCKET_NQ * 2
              );
              if (recentNQ.length > 6) {
                const totalVol = recentNQ.reduce((sum, t) => sum + t.size, 0);
                if (totalVol >= 200) {
                  eventsRef.current.unshift({
                    id: Math.random().toString(),
                    timestamp,
                    instrument: 'NQ',
                    price,
                    side,
                    volume: totalVol,
                    trades: recentNQ.length
                  });
                  if (eventsRef.current.length > 50) eventsRef.current.pop();
                  setClusterEvents([...eventsRef.current]);
                }
              }
              
              if (nqTradesRef.current.length > 5000) nqTradesRef.current.splice(0, 1000);
            }
          });
        }
      } catch (e) {
        console.error('WebSocket message error:', e);
      }
    };

    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
      setIsConnected(false);
    };

    ws.onclose = () => {
      console.log('WebSocket closed');
      setIsConnected(false);
    };

    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    };
  }, []);

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-100 font-sans overflow-hidden">
      
      {/* Header Controls */}
      <div className="flex items-center justify-between px-6 py-4 bg-slate-900 border-b border-slate-800 shadow-md z-10">
        <div className="flex items-center space-x-3">
          <Shield className="text-emerald-500 w-6 h-6" />
          <h1 className="text-xl font-bold tracking-tight text-white">Futures Order Flow</h1>
          <div className={`text-xs px-2 py-1 rounded ${isConnected ? 'bg-emerald-900 text-emerald-300' : 'bg-red-900 text-red-300'}`}>
            {isConnected ? '● LIVE' : '● DISCONNECTED'}
          </div>
        </div>

        <div className="flex items-center space-x-6">
          <div className="flex items-center space-x-2">
            <label className="text-xs text-slate-400 font-medium">Fade (min)</label>
            <input
              type="range"
              min="5"
              max="60"
              value={fadeMinutes}
              onChange={(e) => setFadeMinutes(parseInt(e.target.value))}
              className="w-32"
            />
            <span className="text-xs text-slate-300 font-mono w-8">{fadeMinutes}</span>
          </div>

          <div className="flex items-center space-x-2">
            <label className="text-xs text-slate-400 font-medium">ES Min Size</label>
            <input
              type="range"
              min="5"
              max="100"
              step="5"
              value={esMinSize}
              onChange={(e) => setEsMinSize(parseInt(e.target.value))}
              className="w-32"
            />
            <span className="text-xs text-slate-300 font-mono w-8">{esMinSize}</span>
          </div>

          <div className="flex items-center space-x-2">
            <label className="text-xs text-slate-400 font-medium">NQ Min Size</label>
            <input
              type="range"
              min="5"
              max="100"
              step="5"
              value={nqMinSize}
              onChange={(e) => setNqMinSize(parseInt(e.target.value))}
              className="w-32"
            />
            <span className="text-xs text-slate-300 font-mono w-8">{nqMinSize}</span>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex gap-4 p-4 overflow-hidden">
        
        {/* ES Chart */}
        <OrderClusterCanvas
          instrument="ES"
          tradesRef={esTradesRef}
          minSize={esMinSize}
          fadeMinutes={fadeMinutes}
          currentPrice={esPrice}
          priceBucket={PRICE_BUCKET_ES}
          accentColor="text-cyan-400"
        />

        {/* NQ Chart */}
        <OrderClusterCanvas
          instrument="NQ"
          tradesRef={nqTradesRef}
          minSize={nqMinSize}
          fadeMinutes={fadeMinutes}
          currentPrice={nqPrice}
          priceBucket={PRICE_BUCKET_NQ}
          accentColor="text-purple-400"
        />

        {/* Cluster Events Feed */}
        <div className="w-80 flex flex-col bg-slate-900 rounded-xl border border-slate-800 shadow-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 bg-slate-900/90">
            <h2 className="text-sm font-bold flex items-center gap-2 text-amber-400">
              <Activity className="w-5 h-5" />
              Cluster Events
            </h2>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {clusterEvents.map(evt => {
              const age = Math.floor((Date.now() - evt.timestamp) / 60000);
              const sideColor = evt.side === 'buy' ? 'text-emerald-400' : 'text-red-400';
              return (
                <div key={evt.id} className="bg-slate-800/50 rounded-lg p-3 border border-slate-700 hover:border-slate-600 transition">
                  <div className="flex justify-between items-start mb-1">
                    <span className="text-xs font-bold text-slate-300">{evt.instrument}</span>
                    <span className="text-xs text-slate-500">{age}m ago</span>
                  </div>
                  <div className="text-sm font-mono text-white mb-1">{evt.price.toFixed(2)}</div>
                  <div className="flex items-center justify-between text-xs">
                    <span className={`font-semibold ${sideColor}`}>
                      {evt.side.toUpperCase()}
                    </span>
                    <span className="text-slate-400">
                      {evt.volume} vol · {evt.trades} trades
                    </span>
                  </div>
                </div>
              );
            })}
            {clusterEvents.length === 0 && (
              <div className="text-center text-slate-500 text-sm py-10">
                Waiting for clusters...
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};

export default FuturesFlowDashboard;
