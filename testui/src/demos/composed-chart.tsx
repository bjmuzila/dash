import { curveCatmullRom } from "@visx/curve"
import {
  Area,
  ComposedChart,
  Grid,
  Line,
  SeriesBar,
  XAxis,
  ChartTooltip,
} from "@/components/charts"
import { Frame } from "@/components/frame"
import { timeSeriesShort } from "@/lib/demo-data"

const smooth = curveCatmullRom.alpha(0.42)

export default function Demo() {
  return (
    <Frame title="Area + Bar + Line" hint="one shared x-scale">
      <ComposedChart
        aspectRatio="2 / 1"
        barGap={0}
        data={timeSeriesShort}
        maxBarSize={32}
        xDataKey="date"
      >
        <Grid horizontal />
        <Area curve={smooth} dataKey="runRate" fill="var(--chart-4)" fillOpacity={0.32} />
        <SeriesBar dataKey="units" fill="var(--chart-3)" radius={4} />
        <Line curve={smooth} dataKey="revenue" stroke="var(--chart-1)" />
        <ChartTooltip showCrosshair={false} />
        <XAxis numTicks={8} />
      </ComposedChart>
    </Frame>
  )
}
