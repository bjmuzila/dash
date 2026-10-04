// Go to another v3 page from inside the chart (a click on a canvas, outside
// React). React Router listens for popstate, so a pushState followed by that
// event navigates in place, with no reload. On the phone build (/v3/m/…) the
// phone twin of the page is used when there is one.

const PHONE_TWIN: Record<string, string> = { '/whales': '/m/whales', '/vela': '/m/vela', '/replay': '/m/replay' }

export function goTo(path: string, query: Record<string, string | number | null | undefined> = {}): void {
  const onPhone = window.location.pathname.startsWith('/v3/m/')
  const base = onPhone ? (PHONE_TWIN[path] ?? path) : path
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) if (v != null && v !== '') sp.set(k, String(v))
  const qs = sp.toString()
  window.history.pushState({}, '', `/v3${base}${qs ? `?${qs}` : ''}`)
  window.dispatchEvent(new PopStateEvent('popstate'))
}
