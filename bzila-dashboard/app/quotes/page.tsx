'use client';

import { useEffect } from 'react';

export default function QuotesPage() {
  useEffect(() => {
    // Load the vanilla HTML quotes panel that works 100%
    const loadVanillaPanel = async () => {
      try {
        const response = await fetch('/pages/quotes/quotes.html');
        if (response.ok) {
          const html = await response.text();
          const container = document.getElementById('quotes-container-wrapper');
          if (container) {
            container.innerHTML = html;

            // Re-execute inline scripts
            const scripts = container.querySelectorAll('script');
            scripts.forEach((oldScript: any) => {
              const newScript = document.createElement('script');
              newScript.textContent = oldScript.textContent;
              oldScript.parentNode?.replaceChild(newScript, oldScript);
            });
          }
        }
      } catch (e) {
        console.error('Failed to load vanilla quotes panel:', e);
      }
    };

    loadVanillaPanel();
  }, []);

  return <div id="quotes-container-wrapper" style={{ display: 'flex', flex: 1, minHeight: 0 }} />;
}
