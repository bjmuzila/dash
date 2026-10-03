// The Vela data provider's registration name — a symbol typed as `cbedge:XYZ` routes to
// pages/vela/cbedgeProvider.ts. Its own module so the script engine
// (pages/vela/script/engine.ts, which fetches other symbols for request.security) can
// name it without pulling in the provider and everything it imports.
export const PROVIDER_NAME = 'cbedge'
