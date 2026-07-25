import { ScatterChart, Scatter, Grid, XAxis, ChartTooltip } from "@/components/charts"
import { Frame } from "../Frame"
import { timeSeriesShort } from "../demo-data"

export default function Demo() {
  return (
    <>
      <Frame title="Basic" hint="hover isolates the active point">
        <ScatterChart data={timeSeriesShort}>
          <Grid horizontal />
          <Scatter dataKey="users" />
          <XAxis />
          <ChartTooltip />
        </ScatterChart>
      </Frame>

      <Frame title="Two series + y-gradient" hint="radius 6, ringGap 3">
        <ScatterChart data={timeSeriesShort}>
          <Grid horizontal vertical />
          <Scatter dataKey="revenue" fill="var(--chart-1)" radius={6} ringGap={3} yGradient />
          <Scatter dataKey="costs" fill="var(--chart-2)" radius={5} />
          <XAxis />
          <ChartTooltip />
        </ScatterChart>
      </Frame>
    </>
  )
}
