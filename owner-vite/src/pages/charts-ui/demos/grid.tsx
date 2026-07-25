import { LineChart, Line, Grid, XAxis, ChartTooltip } from "@/components/charts"
import { Frame } from "../Frame"
import { timeSeries } from "../demo-data"

export default function Demo() {
  return (
    <>
      <Frame title="Horizontal only" hint="the default">
        <LineChart data={timeSeries}>
          <Grid horizontal />
          <Line dataKey="users" />
          <XAxis />
          <ChartTooltip />
        </LineChart>
      </Frame>

      <Frame title="Both axes, solid stroke" hint='strokeDasharray "0", 8 columns'>
        <LineChart data={timeSeries}>
          <Grid horizontal vertical strokeDasharray="0" numTicksColumns={8} strokeOpacity={0.5} />
          <Line dataKey="users" stroke="var(--chart-2)" />
          <XAxis />
          <ChartTooltip />
        </LineChart>
      </Frame>

      <Frame title="Highlight rows + shimmer" hint="highlightRowValues, shimmer">
        <LineChart data={timeSeries}>
          <Grid
            horizontal
            highlightRowValues={[1200, 1600]}
            highlightRowStrokeDasharray="0"
            shimmer
          />
          <Line dataKey="users" stroke="var(--chart-4)" />
          <XAxis />
          <ChartTooltip />
        </LineChart>
      </Frame>
    </>
  )
}
