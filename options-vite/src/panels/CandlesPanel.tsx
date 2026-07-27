import Card from '../components/Card'
import Placeholder from '../components/Placeholder'
import { useTicker } from '../TickerContext'

export default function CandlesPanel() {
  const { ticker } = useTicker()
  return (
    <Card title="Candlestick" right="ES-based chart">
      <Placeholder label="candles" ticker={ticker} shape="candles" note="placeholder — lightweight-charts goes here" />
    </Card>
  )
}
