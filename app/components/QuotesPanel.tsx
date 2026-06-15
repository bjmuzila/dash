'use client';

import { useEffect } from 'react';

export default function QuotesPanel() {
  useEffect(() => {
    // Create the QuotesPanel object exactly like the vanilla version
    const quotesPanel = {
      symbols: ['/ES', '/NQ', 'SPX', 'SPCX', 'VIX', 'SPY', 'QQQ', 'SMH', 'AAPL', 'AMD', 'AMZN', 'GOOGL', 'META', 'MSFT', 'NVDA', 'TSLA'],
      quotes: {},
      prevCloses: {},
      pageId: 'quotes-' + Date.now(),

      quoteNumber(q: Record<string, unknown>, ...keys: string[]) {
        for (const key of keys) {
          const value = Number(q[key]);
          if (Number.isFinite(value)) return value;
        }
        return null;
      },

      pctFromQuote(q: Record<string, unknown>) {
        const directPct = this.quoteNumber(q, 'percent-change', 'changePercent', 'netPercentChange', 'netPercentChangeInDouble', 'pctChange', 'dayPercentChange');
        if (directPct != null && Math.abs(directPct) <= 20) return directPct;
        const last = this.quoteNumber(q, 'last', 'lastPrice', 'mark', 'mark-price', 'price', 'close', 'closePrice');
        const prev = this.quoteNumber(q, 'prev-close', 'prevClose', 'previousClose', 'prevDayClosePrice', 'close-price', 'closePrice');
        if (last != null && prev != null && prev > 0) {
          const pct = ((last - prev) / prev) * 100;
          if (Number.isFinite(pct) && Math.abs(pct) <= 20) return pct;
        }
        const change = this.quoteNumber(q, 'change', 'netChange', 'dayChange', 'tradeChange');
        if (change != null && prev != null && prev > 0) {
          const pct = (change / prev) * 100;
          if (Number.isFinite(pct) && Math.abs(pct) <= 20) return pct;
        }
        return null;
      },

      async init() {
        console.log('[Quotes] Initializing');
        const searchInput = document.getElementById('quote-search');
        if (searchInput) {
          searchInput.addEventListener('input', (e: any) => {
            this.filterQuotes(e.target.value);
          });
        }

        await this.loadPrevCloses();
        this.render();
        setInterval(() => this.loadPrevCloses(), 60000);
      },

      async loadPrevCloses() {
        try {
          const response = await fetch('/proxy/api/spx-prevclose');
          if (!response.ok) return;
          const data = await response.json();
          if (data && typeof data === 'object') {
            if (data.prevClose !== undefined) {
              this.prevCloses = {
                '/ES': data.prevClose,
                '/NQ': data.prevClose
              };
            } else {
              this.prevCloses = { ...data };
            }
          }
        } catch (e) {
          console.warn('[Quotes] Failed to load previous closes:', e);
        }
      },

      async fetchQuotes() {
        try {
          const symbolsParam = this.symbols.join(',');
          // Use the Next.js API route which properly forwards to the proxy
          const url = `/api/quotes-batch?symbols=${encodeURIComponent(symbolsParam)}`;

          const response = await fetch(url);
          if (!response.ok) return [];
          const data = await response.json();
          if (!Array.isArray(data)) return [];

          return data;
        } catch (e) {
          console.warn('[Quotes] Failed to fetch quotes:', e);
          return [];
        }
      },

      calculateChange(symbol: string, lastPrice: number) {
        const prevClose = (this.prevCloses as any)[symbol];
        if (!prevClose || prevClose === 0) return null;
        const change = lastPrice - prevClose;
        const changePercent = (change / prevClose) * 100;
        return {
          change: change.toFixed(2),
          changePercent: changePercent.toFixed(2),
          up: change > 0,
          down: change < 0
        };
      },

      formatPrice(price: number) {
        if (!price) return '—';
        return parseFloat(price.toString()).toFixed(2);
      },

      async render() {
        const container = document.getElementById('quotes-container');
        if (!container) return;

        const quotes = await this.fetchQuotes();
        if (!quotes || quotes.length === 0) {
          container.innerHTML = '<div class="quotes-empty">No quotes available</div>';
          return;
        }

        let rows = '';
        let visibleCount = 0;

        quotes.forEach((q: any) => {
          if (!q || !q.symbol) return;

          const change = this.calculateChange(q.symbol, q.last) || (() => {
            const pct = this.pctFromQuote(q);
            if (pct == null) return null;
            return {
              change: '',
              changePercent: Math.abs(pct).toFixed(2),
              up: pct >= 0,
              down: pct < 0
            };
          })();
          const searchVal = (document.getElementById('quote-search') as any)?.value.toUpperCase() || '';
          const matches = searchVal === '' || q.symbol.toUpperCase().includes(searchVal);

          if (!matches) return;
          visibleCount++;

          const changeClass = change ? (change.up ? 'up' : 'down') : '';
          const arrow = change ? (change.up ? '▲' : '▼') : '';
          const changeDisplay = change
            ? `<span class="quote-change-arrow">${arrow}</span><span>${change.up ? '+' : ''}${change.changePercent}%</span>`
            : '—';

          rows += `
            <div class="quote-row">
              <div class="quote-symbol">${q.symbol}</div>
              <div class="quote-price">${this.formatPrice(q.last)}</div>
              <div class="quote-change ${changeClass}">
                ${changeDisplay}
              </div>
              <div class="quote-bid-ask">
                <span>B: ${this.formatPrice(q.bid)}</span>
                <span>A: ${this.formatPrice(q.ask)}</span>
              </div>
            </div>
          `;
        });

        const headerHtml = '<div class="quotes-header"><div>SYMBOL</div><div>PRICE</div><div>CHANGE</div><div>BID / ASK</div></div>';

        if (visibleCount === 0) {
          container.innerHTML = headerHtml + '<div class="quotes-empty">No matches found</div>';
        } else {
          container.innerHTML = headerHtml + rows;
        }
      },

      filterQuotes(searchTerm: string) {
        this.render();
      }
    };

    // Initialize
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => quotesPanel.init());
    } else {
      quotesPanel.init();
    }
  }, []);

  return (
    <div id="page-quotes" style={{display:'flex',flexDirection:'column',flex:1,minHeight:0,background:'var(--bg0)',color:'var(--text2)',fontFamily:'Arial,sans-serif'}}>
      <style>{`
        #quotes-container {
          display: flex;
          flex-direction: column;
          flex: 1;
          min-height: 0;
          overflow-y: auto;
          gap: 1px;
          background: var(--bg0);
        }

        .quote-row {
          display: grid;
          grid-template-columns: 0.8fr 1fr 1fr 1.2fr;
          gap: 12px;
          padding: 10px 14px;
          align-items: center;
          border-bottom: 1px solid #1a2a3a;
          transition: background-color 0.15s ease;
        }

        .quote-row:hover {
          background-color: rgba(0, 229, 255, 0.05);
        }

        .quote-symbol {
          font-weight: 700;
          font-size: 13px;
          color: var(--cyan);
          letter-spacing: 0.5px;
          font-variant-numeric: tabular-nums;
        }

        .quote-price {
          font-weight: 600;
          font-size: 13px;
          color: #fff;
          font-variant-numeric: tabular-nums;
        }

        .quote-change {
          font-weight: 600;
          font-size: 13px;
          font-variant-numeric: tabular-nums;
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .quote-change.up {
          color: #00d876;
        }

        .quote-change.down {
          color: #ff4444;
        }

        .quote-change-arrow {
          font-size: 11px;
          font-weight: 700;
          margin-right: 2px;
        }

        .quote-bid-ask {
          display: flex;
          gap: 8px;
          font-size: 11px;
          color: #9fb0bf;
          font-variant-numeric: tabular-nums;
        }

        .quotes-header {
          display: grid;
          grid-template-columns: 0.8fr 1fr 1fr 1.2fr;
          gap: 12px;
          padding: 8px 14px;
          background: #0a0f16;
          border-bottom: 1px solid #1a2a3a;
          font-size: 10px;
          font-weight: 700;
          color: #7fa3bf;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          position: sticky;
          top: 0;
          z-index: 10;
        }

        .quotes-empty {
          padding: 40px 20px;
          text-align: center;
          color: #666;
          font-size: 12px;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>

      {/* Toolbar */}
      <div style={{display:'flex',alignItems:'center',gap:8,padding:'8px 14px',background:'#0a0f16',borderBottom:'1px solid #1a2a3a',flexShrink:0}}>
        <div style={{fontWeight:700,color:'var(--cyan)',fontSize:13}}>Quotes</div>
        <input type="text" id="quote-search" placeholder="Search symbol..." style={{flex:1,maxWidth:200,padding:'4px 8px',fontSize:11,background:'#070c14',border:'1px solid #1a2a3a',borderRadius:3,color:'#fff'}} />
        <button onClick={() => window.location.reload()} style={{padding:'4px 10px',fontSize:10,background:'#0d1825',border:'1px solid #1a3a5f',borderRadius:3,color:'#00e5ff',cursor:'pointer',fontWeight:700}}>RELOAD</button>
      </div>

      {/* Quotes List */}
      <div id="quotes-container">
        <div style={{padding:'40px 20px',textAlign:'center',color:'#7fa3bf',fontSize:12}}>
          Loading quotes...
        </div>
      </div>
    </div>
  );
}
