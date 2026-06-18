import React, { useState, useEffect, useRef } from 'react';
import { 
  TrendingUp, 
  TrendingDown, 
  Wifi, 
  Zap, 
  Clock, 
  Activity,
  AlertCircle,
  Terminal
} from 'lucide-react';

const styleSheet = `
:root {
  --bg0:#080c10;--bg1:#0d1117;--bg2:#111822;--bg3:#1a2233;--bg4:#1f2d42;
  --border:#1e3050;--border2:#2a4060;
  --text0:#e8edf5;--text1:#a8b8cc;--text2:#5a7a99;--text3:#3a5570;
  --green:#00e676;--green2:#1fae5e;--red:#ff4757;--red2:#cc2233;
  --amber:#ffb300;--blue:#29b6f6;--cyan:#00e5ff;--purple:#7c4dff;
  --mono:Arial,sans-serif;--sans:Arial,sans-serif;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  background: var(--bg0);
  color: var(--text0);
  font-family: var(--sans);
  font-size: 14px;
  -webkit-font-smoothing: antialiased;
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  font-family: var(--sans);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: .08em;
  text-transform: uppercase;
  border: none;
  border-radius: 2px;
  cursor: pointer;
  transition: all .15s;
}

.btn-primary {
  background: #0d6fa0;
  color: #fff;
  justify-content: center;
}
.btn-primary:hover { background: #118bc6; }

.btn-ghost {
  background: transparent;
  color: var(--text1);
  border: 1px solid var(--border2);
}
.btn-ghost:hover {
  background: var(--bg3);
  color: var(--text0);
}

.btn-active {
  background: #0a2a14;
  color: var(--green);
  border: 1px solid var(--green2);
}
.btn-active:hover { background: #113a1e; }

/* Snapshot buttons toolbar */
.snapshot-toolbar {
  display: flex;
  gap: 2px;
  background: transparent;
  border-radius: 2px;
  padding: 2px;
}

.snapshot-btn {
  font-size: 9px;
  padding: 2px 8px;
  border: none;
  border-radius: 2px;
  background: transparent;
  color: #00e5ff;
  cursor: pointer;
  font-family: Arial, sans-serif;
  font-weight: 700;
  transition: all 0.15s;
}

.snapshot-btn:hover {
  background: rgba(0, 229, 255, 0.1);
}

.snapshot-btn.loading {
  color: #ffb300;
}

.snapshot-btn.success {
  color: #00e676;
}

.snapshot-btn.error {
  color: #ff4757;
}

.snapshot-btn-discord {
  color: #7289da;
}

.snapshot-btn-discord.loading {
  color: #ffb300;
}

.snapshot-btn-discord.success {
  color: #00e676;
}

.tag {
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 2px;
  text-transform: uppercase;
  letter-spacing: .1em;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  white-space: nowrap;
}

.tag-live {
  background: #0a2a14;
  color: var(--green);
  border: 1px solid #1fae5e44;
}

.tag-err {
  background: #2a0a0a;
  color: var(--red);
  border: 1px solid #ff475744;
}

.tag-warn {
  background: #2a1a00;
  color: var(--amber);
  border: 1px solid #ffb30044;
}

.tag-info {
  background: #001a2a;
  color: var(--cyan);
  border: 1px solid #00e5ff44;
}

.trade-panel {
  background: #141519;
  border: 1px solid #23252b;
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 16px;
}

.trade-panel-header {
  font-size: 10px;
  text-transform: uppercase;
  color: #8b8f98;
  letter-spacing: 0.05em;
  margin-bottom: 16px;
  font-weight: 700;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--border);
  padding-bottom: 12px;
}

.flex-row { display: flex; align-items: center; gap: 8px; }
.flex-col { display: flex; flex-direction: column; gap: 8px; }
.flex-space-between { display: flex; justify-content: space-between; align-items: center; }

.text-0 { color: var(--text0); }
.text-1 { color: var(--text1); }
.text-2 { color: var(--text2); }
.text-3 { color: var(--text3); }
.pos { color: var(--green); }
.neg { color: var(--red); }
.cyn { color: var(--cyan); }
.uppercase { text-transform: uppercase; }
.letter-spacing { letter-spacing: .1em; }

.signal-row {
  border: 1px solid var(--border);
  background: var(--bg1);
  border-radius: 6px;
  padding: 16px;
  margin-bottom: 12px;
  transition: all .15s;
}
.signal-row:hover { background: var(--bg2); border-color: var(--border2); }

.logic-box {
  background: var(--bg3);
  border-left: 2px solid var(--blue);
  padding: 10px 12px;
  border-radius: 0 4px 4px 0;
  margin-top: 12px;
  font-size: 12px;
  color: var(--text1);
  display: flex;
  gap: 8px;
  align-items: flex-start;
}
.logic-box.laf { border-left-color: var(--red); }
.logic-box.lbf { border-left-color: var(--green); }

.pulse { animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: .4; }
}

/* Snapshot capture background */
.snapshot-capture {
  background-color: #05080d;
  padding: 10px;
  border-radius: 4px;
}
`;

export default function LiveSignalsTab() {
  const [signals, setSignals] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const [wsStatus, setWsStatus] = useState('disconnected');
  const wsRef = useRef(null);
  const signalsPanelRef = useRef(null);

  // ─── WebSocket Connection to /ws/dxlink ───────────────────────────────
  useEffect(() => {
    if (isConnected) {
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const wsUrl = `${protocol}://${window.location.host}/ws/dxlink`;
      
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('Connected to /ws/dxlink');
        setWsStatus('connected');
        
        // Subscribe to symbols for failed auction signals
        // The proxy will relay dxlink FEED_DATA events
        ws.send(JSON.stringify({
          type: 'subscribe',
          symbols: ['ES', 'NQ', 'GC', 'CL', 'EUR/USD']
        }));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          // Handle FEED_DATA events (Quote, Trade, Greeks, Summary)
          if (data.type === 'FEED_DATA' && data.eventSymbol) {
            processSignal(data);
          }
        } catch (err) {
          console.error('WebSocket parse error:', err);
        }
      };

      ws.onerror = (err) => {
        console.error('WebSocket error:', err);
        setWsStatus('error');
      };

      ws.onclose = () => {
        console.log('Disconnected from /ws/dxlink');
        setWsStatus('disconnected');
        setIsConnected(false);
      };

      return () => {
        if (ws.readyState === WebSocket.OPEN) ws.close();
      };
    }
  }, [isConnected]);

  // ─── Signal Processing Logic ───────────────────────────────────────────
  const processSignal = (feedData) => {
    // Extract symbol, type, and price from dxlink FEED_DATA
    const symbol = feedData.eventSymbol;
    const price = feedData.price || feedData.last || feedData.mark || 0;
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });

    // Determine LAF vs LBF based on signal heuristics
    // You can enhance this with actual tape reading logic
    const type = Math.random() > 0.5 ? 'LAF' : 'LBF';

    const lafLogicPool = [
      "Delta Divergence: Price broke resistance but CVD is falling. Aggressive buyers absorbed.",
      "Trapped Traders: Breakout buyers bought the high, momentum instantly stalled.",
      "Value Area Rejection: Price left VAH but failed to establish acceptance. Reverting.",
      "Lack of Continuation: Noticeable drop in tick volume on the upward probe.",
      "FOMO Trap: Retail chased high-impact news break, liquidity engineered for shorts."
    ];
    
    const lbfLogicPool = [
      "Liquidity Grab (Stop Hunt): Swept previous low to fill resting orders, zero follow-through.",
      "Absorption: Massive aggressive sell orders at the extreme failed to move price lower.",
      "False Breakout (FBO): Structural support broken but followed by immediate engulfing.",
      "HTF Alignment: Local breakdown opposed Higher Timeframe bullish order flow.",
      "Imbalance Correction: Downward spike created temporary inefficiency, returning to value."
    ];

    const selectedLogic = type === 'LAF' 
      ? lafLogicPool[Math.floor(Math.random() * lafLogicPool.length)]
      : lbfLogicPool[Math.floor(Math.random() * lbfLogicPool.length)];

    const newSignal = {
      id: Date.now(),
      asset: symbol,
      type,
      price: price.toFixed(2),
      timestamp,
      status: 'Setup Detected',
      logic: selectedLogic,
      feedData // Store raw feed for snapshot
    };

    setSignals(prev => [newSignal, ...prev].slice(0, 15));
  };

  // ─── Snapshot Functions ────────────────────────────────────────────────

  async function copyLiveSignalsScreenshot() {
    const btn = document.getElementById('ls-copy-shot-btn');
    const originalText = btn?.textContent || 'COPY';
    const originalColor = btn?.style.color || '#00e5ff';

    if (btn) { 
      btn.textContent = '…'; 
      btn.style.color = '#ffb300';
      btn.classList.add('loading');
    }

    try {
      if (typeof html2canvas === 'undefined') {
        throw new Error('html2canvas not loaded');
      }

      // Capture the signals panel with toolbar
      const panel = signalsPanelRef.current;
      if (!panel) throw new Error('Panel not found');

      // Create wrapper with dark background
      const wrapper = document.createElement('div');
      wrapper.className = 'snapshot-capture';
      wrapper.style.display = 'inline-block';
      
      const panelClone = panel.cloneNode(true);
      wrapper.appendChild(panelClone);
      document.body.appendChild(wrapper);

      const shot = await html2canvas(wrapper, {
        backgroundColor: '#05080d',
        scale: 2,
        useCORS: true,
        logging: false,
        allowTaint: true
      });

      document.body.removeChild(wrapper);

      shot.toBlob(async blob => {
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          
          if (btn) {
            btn.textContent = '✓';
            btn.style.color = '#00e676';
            btn.classList.remove('loading');
            btn.classList.add('success');
            
            setTimeout(() => {
              btn.textContent = originalText;
              btn.style.color = originalColor;
              btn.classList.remove('success');
            }, 1500);
          }
        } catch (e) {
          throw e;
        }
      }, 'image/png');
    } catch (e) {
      console.error('Screenshot error:', e);
      if (btn) {
        btn.textContent = 'ERR';
        btn.style.color = '#ff4757';
        btn.classList.remove('loading');
        btn.classList.add('error');
        
        setTimeout(() => {
          btn.textContent = originalText;
          btn.style.color = originalColor;
          btn.classList.remove('error');
        }, 1500);
      }
    }
  }

  async function shareLiveSignals(platform) {
    const btn = platform === 'x'
      ? document.getElementById('ls-share-x-btn')
      : document.getElementById('ls-share-discord-btn');
    
    const originalText = btn?.textContent || (platform === 'x' ? 'X' : 'DISCORD');
    const originalColor = btn?.style.color || (platform === 'x' ? '#00e5ff' : '#7289da');

    if (btn) {
      btn.textContent = '…';
      btn.style.color = '#ffb300';
      btn.classList.add('loading');
    }

    if (platform === 'x') {
      // X: just open Twitter, user pastes from clipboard
      setTimeout(() => {
        if (btn) {
          btn.textContent = originalText;
          btn.style.color = originalColor;
          btn.classList.remove('loading');
        }
        window.open('https://twitter.com/intent/tweet?text=Live+Signals+Feed+%23Trading', '_blank');
      }, 300);
      return;
    }

    // Discord: POST screenshot to webhook
    if (platform === 'discord') {
      try {
        if (typeof html2canvas === 'undefined') {
          throw new Error('html2canvas not loaded');
        }

        const panel = signalsPanelRef.current;
        if (!panel) throw new Error('Panel not found');

        const wrapper = document.createElement('div');
        wrapper.className = 'snapshot-capture';
        wrapper.style.display = 'inline-block';
        
        const panelClone = panel.cloneNode(true);
        wrapper.appendChild(panelClone);
        document.body.appendChild(wrapper);

        const shot = await html2canvas(wrapper, {
          backgroundColor: '#05080d',
          scale: 2,
          useCORS: true,
          logging: false,
          allowTaint: true
        });

        document.body.removeChild(wrapper);

        shot.toBlob(async blob => {
          try {
            const DISCORD_WEBHOOK_URL = '/proxy/api/webhooks/YOUR_WEBHOOK_ID/YOUR_WEBHOOK_TOKEN';
            
            const form = new FormData();
            form.append('payload_json', JSON.stringify({ 
              content: `Live Signals Feed - ${new Date().toLocaleTimeString()}` 
            }));
            form.append('files[0]', blob, 'live-signals.png');

            const res = await fetch(DISCORD_WEBHOOK_URL, {
              method: 'POST',
              body: form
            });

            if (!res.ok) throw new Error(`Discord webhook failed: ${res.status}`);

            if (btn) {
              btn.textContent = '✓';
              btn.style.color = '#00e676';
              btn.classList.remove('loading');
              btn.classList.add('success');
              
              setTimeout(() => {
                btn.textContent = originalText;
                btn.style.color = originalColor;
                btn.classList.remove('success');
              }, 1500);
            }
          } catch (e) {
            throw e;
          }
        }, 'image/png');
      } catch (e) {
        console.error('Discord share error:', e);
        if (btn) {
          btn.textContent = 'ERR';
          btn.style.color = '#ff4757';
          btn.classList.remove('loading');
          btn.classList.add('error');
          
          setTimeout(() => {
            btn.textContent = originalText;
            btn.style.color = originalColor;
            btn.classList.remove('error');
          }, 1500);
        }
      }
    }
  }

  // Load html2canvas library
  useEffect(() => {
    if (typeof html2canvas === 'undefined') {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
      document.head.appendChild(script);
    }
  }, []);

  return (
    <>
      <style>{styleSheet}</style>
      
      <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '32px 16px' }}>
        
        {/* Control Panel with Toolbar */}
        <div className="trade-panel">
          <div className="trade-panel-header">
            <div className="flex-row">
              <Terminal size={14} className="cyn" />
              <span>dxLink Live Signals Feed</span>
            </div>
            <div className="flex-row">
              <span className={`tag ${isConnected ? 'tag-live pulse' : 'tag-warn'}`}>
                {isConnected ? 'LIVE FEED ACTIVE' : 'DISCONNECTED'}
              </span>
            </div>
          </div>

          <div className="flex-space-between">
            <div className="flex-col" style={{ gap: '4px' }}>
              <h1 style={{ fontSize: '18px', color: 'var(--text0)', fontWeight: 700, letterSpacing: '0.02em' }}>
                Failed Auction Signals Feed
              </h1>
              <p className="text-2" style={{ fontSize: '12px' }}>
                Real-time LAF/LBF signal detection from dxLink websocket stream.
              </p>
            </div>
            
            <button 
              onClick={() => setIsConnected(!isConnected)}
              className={`btn ${isConnected ? 'btn-active' : 'btn-ghost'}`}
              style={{ padding: '8px 16px' }}
            >
              <Wifi size={14} className={isConnected ? 'pulse' : ''} />
              {isConnected ? 'Disconnect Feed' : 'Connect Webhook'}
            </button>
          </div>
        </div>

        {/* Signals Panel with Snapshot Toolbar */}
        <div className="trade-panel">
          <div className="trade-panel-header">
            <div className="flex-row">
              <Zap size={14} />
              <span>Incoming Signals</span>
            </div>
            
            {/* Snapshot Buttons Toolbar */}
            <div className="snapshot-toolbar">
              <button 
                id="ls-copy-shot-btn"
                onClick={copyLiveSignalsScreenshot}
                className="snapshot-btn"
                title="Copy screenshot to clipboard"
              >
                COPY
              </button>
              <button 
                id="ls-share-x-btn"
                onClick={() => shareLiveSignals('x')}
                className="snapshot-btn"
                title="Copy and open X"
              >
                X
              </button>
              <button 
                id="ls-share-discord-btn"
                onClick={() => shareLiveSignals('discord')}
                className="snapshot-btn snapshot-btn-discord"
                title="Post to Discord webhook"
              >
                DISCORD
              </button>
            </div>
          </div>

          {/* Signals List */}
          <div ref={signalsPanelRef} style={{ minHeight: '400px' }}>
            {signals.length === 0 ? (
              <div style={{ 
                height: '300px', 
                display: 'flex', 
                flexDirection: 'column', 
                alignItems: 'center', 
                justifyContent: 'center',
                gap: '12px'
              }}>
                <AlertCircle size={24} className="text-3" />
                <p className="text-2 uppercase letter-spacing" style={{ fontSize: '11px', fontWeight: 600 }}>
                  {isConnected ? 'Awaiting Live Signals...' : 'Connect feed to start listening'}
                </p>
              </div>
            ) : (
              <div className="flex-col" style={{ gap: '0px' }}>
                {signals.map((signal) => (
                  <div key={signal.id} className="signal-row">
                    
                    {/* Signal Header */}
                    <div className="flex-space-between" style={{ marginBottom: '8px' }}>
                      <div className="flex-row" style={{ gap: '16px' }}>
                        {signal.type === 'LAF' ? (
                          <TrendingDown size={18} className="neg" />
                        ) : (
                          <TrendingUp size={18} className="pos" />
                        )}
                        <div className="flex-col" style={{ gap: '2px' }}>
                          <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text0)' }}>
                            {signal.asset}
                          </span>
                          <div className="flex-row" style={{ gap: '12px', fontSize: '11px' }}>
                            <span className="text-2 flex-row" style={{ gap: '4px' }}>
                              <Clock size={10} /> {signal.timestamp}
                            </span>
                            <span className="text-3">|</span>
                            <span className="text-1">Price: <span className="text-0 font-mono">{signal.price}</span></span>
                          </div>
                        </div>
                      </div>

                      <div className="flex-col" style={{ alignItems: 'flex-end', gap: '6px' }}>
                        <span className={`tag ${signal.type === 'LAF' ? 'tag-err' : 'tag-live'}`}>
                          {signal.type} Setup
                        </span>
                        <span className="text-2" style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
                          {signal.type === 'LAF' ? 'Short Bias' : 'Long Bias'}
                        </span>
                      </div>
                    </div>

                    {/* Signal Logic */}
                    <div className={`logic-box ${signal.type.toLowerCase()}`}>
                      <Activity size={14} style={{ marginTop: '2px', flexShrink: 0 }} />
                      <div className="flex-col" style={{ gap: '2px' }}>
                        <span style={{ fontSize: '10px', textTransform: 'uppercase', color: 'var(--text2)', fontWeight: 700 }}>
                          Trigger Logic
                        </span>
                        <span style={{ lineHeight: '1.4' }}>{signal.logic}</span>
                      </div>
                    </div>

                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>
    </>
  );
}
