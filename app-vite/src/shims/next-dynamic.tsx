// Shim for `next/dynamic` → React.lazy + Suspense.
// Supports the common call shapes: dynamic(() => import('./X')) and
// dynamic(() => import('./X'), { ssr: false, loading: () => <.../> }).
import { lazy, Suspense, createElement } from 'react'
import type { ComponentType, ReactNode } from 'react'

type Loader = () => Promise<ComponentType<any> | { default: ComponentType<any> }>
type DynamicOptions = {
  ssr?: boolean
  loading?: (() => ReactNode) | ReactNode
}

export default function dynamic(loader: Loader, options: DynamicOptions = {}) {
  const Lazy = lazy(async () => {
    const mod = await loader()
    const Comp = (mod as any)?.default ?? (mod as ComponentType<any>)
    return { default: Comp as ComponentType<any> }
  })
  const fallback: ReactNode =
    typeof options.loading === 'function' ? (options.loading as () => ReactNode)() : (options.loading ?? null)

  return function DynamicShim(props: any) {
    return createElement(Suspense, { fallback }, createElement(Lazy, props))
  }
}
