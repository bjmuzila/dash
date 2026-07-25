import { LineChart, Line, Grid, XAxis, ChartTooltip } from "@/components/charts"
import { Frame } from "@/components/frame"
import { timeSeries } from "@/lib/demo-data"

const usd = (v: number) =>
  v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })

export default function Demo() {
  return (
    <>
      <Frame title="Default" hint="crosshair + date pill + dots">
        <LineChart data={timeSeries}>
          <Grid horizontal />
          <Line dataKey="revenue" />
          <XAxis />
          <ChartTooltip />
        </LineChart>
      </Frame>

      <Frame title="Custom rows" hint="rows() formats both series">
        <LineChart data={timeSeries}>
          <Grid horizontal />
          <Line dataKey="revenue" stroke="var(--chart-1)" />
          <Line dataKey="costs" stroke="var(--chart-2)" />
          <XAxis />
          <ChartTooltip
            matchCrosshair
            rows={(point: Record<string, unknown>) => [
              { color: "var(--chart-1)", label: "Revenue", value: usd(point.revenue as number) },
              { color: "var(--chart-2)", label: "Costs", value: usd(point.costs as number) },
              {
                color: "var(--muted-foreground)",
                label: "Margin",
                value: usd((point.revenue as number) - (point.costs as number)),
              },
            ]}
          />
        </LineChart>
      </Frame>

      <Frame title="No pill, no dots" hint="showDatePill / showDots false">
        <LineChart data={timeSeries}>
          <Grid horizontal />
          <Line dataKey="users" stroke="var(--chart-4)" />
          <XAxis />
          <ChartTooltip showDatePill={false} showDots={false} indicatorDasharray="3,3" />
        </LineChart>
      </Frame>
    </>
  )
}
