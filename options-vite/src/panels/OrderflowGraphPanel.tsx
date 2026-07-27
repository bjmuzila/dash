import Card from '../components/Card'
import Placeholder from '../components/Placeholder'
import { useTicker } from '../TickerContext'

export default function OrderflowGraphPanel() {
  const { ticker } = useTicker()
  return (
    <Card title="Orderflow Graph" right="cumulative delta">
      <Placeholder label="orderflow" ticker={ticker} shape="bars" />
    </Card>
  )
}
