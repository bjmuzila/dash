import type { ComponentType } from 'react'
import CandlesPanel from '../panels/CandlesPanel'
import OrderflowGraphPanel from '../panels/OrderflowGraphPanel'
import OrderflowFeedPanel from '../panels/OrderflowFeedPanel'
import Card from '../components/Card'
import Placeholder from '../components/Placeholder'
import { useTicker } from '../TickerContext'

// A page only fills three slots. The toolbar, ticker selector, heatmap and
// sunburst are owned by the layout and show on every page.
export type PageDef = {
  path: string
  label: string
  main: ComponentType // big bottom-left area
  side: ComponentType // right middle
  feed: ComponentType // right bottom
}

function slot(title: string, label: string, shape: 'bars' | 'candles' | 'grid' | 'radial' | 'rows') {
  return function Slot() {
    const { ticker } = useTicker()
    return (
      <Card title={title}>
        <Placeholder label={label} ticker={ticker} shape={shape} />
      </Card>
    )
  }
}

export const PAGES: PageDef[] = [
  {
    path: '/',
    label: 'Overview',
    main: CandlesPanel,
    side: OrderflowGraphPanel,
    feed: OrderflowFeedPanel,
  },
  {
    path: '/chain',
    label: 'Chain',
    main: slot('Options Chain', 'chain', 'rows'),
    side: slot('IV Skew', 'skew', 'bars'),
    feed: slot('Chain Alerts', 'alerts', 'rows'),
  },
  {
    path: '/flow',
    label: 'Flow',
    main: slot('Options Flow', 'flow', 'rows'),
    side: slot('Premium By Strike', 'premium', 'bars'),
    feed: slot('Live Flow Feed', 'flow feed', 'rows'),
  },
  {
    path: '/greeks',
    label: 'Greeks',
    main: slot('Greeks Profile', 'greeks', 'bars'),
    side: slot('Gamma By Strike', 'gamma', 'bars'),
    feed: slot('Greek Alerts', 'alerts', 'rows'),
  },
]
