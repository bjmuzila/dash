// Shim for `next/navigation` (App Router client hooks) → react-router-dom.
import { useNavigate, useLocation, useSearchParams as useRRSearchParams } from 'react-router-dom'

export function useRouter() {
  const navigate = useNavigate()
  return {
    push: (href: string) => navigate(href),
    replace: (href: string) => navigate(href, { replace: true }),
    back: () => navigate(-1),
    forward: () => navigate(1),
    refresh: () => { /* no-op: SPA has no server round-trip to re-run */ },
    prefetch: () => { /* no-op */ },
  }
}

export function usePathname(): string {
  return useLocation().pathname
}

// Next returns a ReadonlyURLSearchParams; react-router returns [params, setParams].
// Callers only read, so hand back the URLSearchParams instance.
export function useSearchParams(): URLSearchParams {
  const [params] = useRRSearchParams()
  return params
}

// `redirect()` is a hard navigation in Next. In the SPA, do a real location
// change so any URL (including cross-app /home, /pricing) resolves correctly.
export function redirect(href: string): never {
  window.location.assign(href)
  // Satisfy the `never` contract; execution never continues past assign().
  throw new Error(`NEXT_REDIRECT:${href}`)
}

export function notFound(): never {
  throw new Error('NEXT_NOT_FOUND')
}

export function useParams<T extends Record<string, string> = Record<string, string>>(): T {
  // react-router's useParams via the same location; kept minimal — the two
  // target pages don't use it, but export it so future ported pages compile.
  const loc = useLocation()
  void loc
  return {} as T
}
