import Card from '../components/Card'
import Placeholder from '../components/Placeholder'
import { useTicker } from '../TickerContext'

// Persistent panel — renders on every page.
export default function SunburstPanel() {
  const { ticker } = useTicker()
  return (
    <Card title="S&P 500 Sunburst" right="sectors → industries → members">
      <Placeholder label="sunburst" ticker={ticker} shape="radial" note="placeholder — highlights selected ticker when wired" />
    </Card>
  )
}
