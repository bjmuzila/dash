import { useLocation } from 'react-router-dom'
import { PAGES } from './registry'
import TickerSelect from '../components/TickerSelect'
import HeatmapPanel from '../panels/HeatmapPanel'
import SunburstPanel from '../panels/SunburstPanel'

// The full dashboard grid. Ticker selector + heatmap (left) and sunburst
// (right) are constant; the three remaining slots come from the active page.
export default function PageView() {
  const { pathname } = useLocation()
  const page = PAGES.find((p) => p.path === pathname) ?? PAGES[0]
  const Main = page.main
  const Side = page.side
  const Feed = page.feed

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'grid',
        gap: 10,
        padding: 12,
        gridTemplateColumns: 'minmax(0, 1.35fr) minmax(0, 1fr)',
        gridTemplateRows: 'auto minmax(0, 1.05fr) minmax(0, 0.9fr) minmax(0, 0.9fr)',
      }}
    >
      <div style={{ gridColumn: '1', gridRow: '1', display: 'flex', alignItems: 'center' }}>
        <TickerSelect />
      </div>

      <div style={{ gridColumn: '1', gridRow: '2', minHeight: 0, display: 'flex' }}>
        <HeatmapPanel />
      </div>

      <div style={{ gridColumn: '1', gridRow: '3 / span 2', minHeight: 0, display: 'flex' }}>
        <Main />
      </div>

      <div style={{ gridColumn: '2', gridRow: '1 / span 2', minHeight: 0, display: 'flex' }}>
        <SunburstPanel />
      </div>

      <div style={{ gridColumn: '2', gridRow: '3', minHeight: 0, display: 'flex' }}>
        <Side />
      </div>

      <div style={{ gridColumn: '2', gridRow: '4', minHeight: 0, display: 'flex' }}>
        <Feed />
      </div>
    </div>
  )
}
