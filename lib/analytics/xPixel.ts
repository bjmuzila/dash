declare global {
  interface Window {
    twq?: (...args: unknown[]) => void;
  }
}

// Base pixel ID from X Ads Manager > Events Manager > Universal Website Tag.
export const X_PIXEL_ID = "q57lo";

// Conversion event ID for the paid-subscription event. Create a "Website
// Conversion" event in Events Manager (Purchase / Sign up), then paste its
// Event ID here — it looks like "tw-q57lo-xxxxx" and is DIFFERENT from the
// base pixel ID above.
export const X_SUBSCRIBE_EVENT_ID = "tw-q57lo-rdkd1";

export function trackXEvent(eventId: string, params?: Record<string, unknown>) {
  if (typeof window === "undefined" || !window.twq) return;
  window.twq("event", eventId, params);
}
