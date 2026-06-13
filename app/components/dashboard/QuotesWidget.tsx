'use client';

import { useEffect, useState } from 'react';

/**
 * Quotes Widget for the Overview sidebar
 * Displays live market quotes with % changes
 */
export default function QuotesWidget() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;

    // Load and render the vanilla quotes panel
    const loadPanel = async () => {
      try {
        const response = await fetch('/pages/quotes/quotes.html');
        if (response.ok) {
          const html = await response.text();
          const container = document.getElementById('quotes-widget-container');
          if (container) {
            // Extract just the inner content, not the outer div
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const quotesDiv = doc.getElementById('page-quotes');

            if (quotesDiv) {
              // Clone the content without the outer wrapper
              const inner = quotesDiv.innerHTML;
              container.innerHTML = inner;

              // Re-execute scripts
              const scripts = container.querySelectorAll('script');
              scripts.forEach((oldScript: any) => {
                const newScript = document.createElement('script');
                newScript.textContent = oldScript.textContent;
                oldScript.parentNode?.replaceChild(newScript, oldScript);
              });
            }
          }
        }
      } catch (e) {
        console.error('Failed to load quotes widget:', e);
      }
    };

    loadPanel();
  }, [mounted]);

  return (
    <div
      id="quotes-widget-container"
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: '0 0 240px',
        minHeight: 0,
        overflow: 'hidden',
        borderLeft: '1px solid #1a2a3a',
        background: 'var(--bg0)',
        minWidth: '180px',
        maxWidth: '280px'
      }}
    />
  );
}
