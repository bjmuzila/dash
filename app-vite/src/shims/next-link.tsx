// Shim for `next/link` → react-router-dom <Link>.
// Next passes `href` (string | UrlObject); react-router uses `to`. External /
// hash links and non-string hrefs fall back to a plain <a>. Unknown Next-only
// props (prefetch, scroll, shallow, passHref, legacyBehavior) are stripped.
import { forwardRef } from 'react'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { Link as RRLink } from 'react-router-dom'

type NextLinkProps = {
  href: string | { pathname?: string; query?: Record<string, string> }
  children?: ReactNode
  replace?: boolean
  prefetch?: boolean
  scroll?: boolean
  shallow?: boolean
  passHref?: boolean
  legacyBehavior?: boolean
} & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>

function toHref(href: NextLinkProps['href']): string {
  if (typeof href === 'string') return href
  const p = href?.pathname ?? '/'
  const q = href?.query
    ? '?' + new URLSearchParams(href.query as Record<string, string>).toString()
    : ''
  return p + q
}

const Link = forwardRef<HTMLAnchorElement, NextLinkProps>(function Link(
  { href, children, replace, prefetch: _p, scroll: _s, shallow: _sh, passHref: _ph, legacyBehavior: _lb, ...rest },
  ref,
) {
  const to = toHref(href)
  // External, protocol, mailto/tel, or hash-only → plain anchor.
  const isExternal = /^(https?:)?\/\//i.test(to) || /^(mailto:|tel:|#)/i.test(to)
  if (isExternal) {
    return <a ref={ref} href={to} {...rest}>{children}</a>
  }
  return <RRLink ref={ref} to={to} replace={replace} {...rest}>{children}</RRLink>
})

export default Link
