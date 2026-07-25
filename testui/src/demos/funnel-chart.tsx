import { FunnelChart } from "@/components/charts"
import { Frame } from "@/components/frame"
import { funnelStages } from "@/lib/demo-data"

export default function Demo() {
  return (
    <>
      <Frame title="Horizontal" hint="3 layers, curved edges">
        <FunnelChart data={funnelStages} color="var(--chart-1)" layers={3} />
      </Frame>

      <Frame title="Vertical, straight edges" hint='orientation="vertical", edges="straight"'>
        <FunnelChart
          data={funnelStages}
          orientation="vertical"
          edges="straight"
          color="var(--chart-4)"
          layers={1}
          gap={6}
        />
      </Frame>
    </>
  )
}
