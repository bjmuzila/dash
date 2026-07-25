import { AreaChart, Area, Grid, XAxis, ChartTooltip } from "@/components/charts"
import { Frame } from "../Frame"
import { timeSeries } from "../demo-data"

export default function Demo() {
  return (
    <>
      <Frame title="Two stacked series" hint="revenue vs costs">
        <AreaChart data={timeSeries}>
          <Grid horizontal />
          <Area dataKey="revenue" fill="var(--chart-line-primary)" />
          <Area dataKey="costs" fill="var(--chart-line-secondary)" />
          <XAxis />
          <ChartTooltip />
        </AreaChart>
      </Frame>

      <Frame title="Single series, faded edges" hint="fillOpacity 0.5, gradientToOpacity 0">
        <AreaChart data={timeSeries} aspectRatio="3 / 1">
          <Grid horizontal />
          <Area
            dataKey="users"
            fill="var(--chart-4)"
            fillOpacity={0.5}
            fadeEdges
            showMarkers
          />
          <XAxis numTicks={7} />
          <ChartTooltip showDatePill />
        </AreaChart>
      </Frame>
    </>
  )
}
