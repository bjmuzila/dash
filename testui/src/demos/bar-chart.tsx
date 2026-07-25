import { BarChart, Bar, BarXAxis, BarYAxis, Grid, ChartTooltip } from "@/components/charts"
import { Frame } from "@/components/frame"
import { monthly } from "@/lib/demo-data"

export default function Demo() {
  return (
    <>
      <Frame title="Grouped" hint="revenue vs profit">
        <BarChart data={monthly} xDataKey="month">
          <Grid horizontal />
          <Bar dataKey="revenue" fill="var(--chart-line-primary)" lineCap="round" />
          <Bar dataKey="profit" fill="var(--chart-line-secondary)" lineCap="round" />
          <BarXAxis />
          <ChartTooltip />
        </BarChart>
      </Frame>

      <Frame title="Stacked" hint="stacked + stackGap 2">
        <BarChart data={monthly} xDataKey="month" stacked stackGap={2}>
          <Grid horizontal />
          <Bar dataKey="profit" fill="var(--chart-2)" />
          <Bar dataKey="churn" fill="var(--chart-5)" />
          <BarXAxis showAllLabels />
          <ChartTooltip />
        </BarChart>
      </Frame>

      <Frame title="Horizontal" hint='orientation="horizontal"'>
        <BarChart data={monthly.slice(0, 6)} xDataKey="month" orientation="horizontal">
          <Grid vertical horizontal={false} />
          <Bar dataKey="revenue" fill="var(--chart-4)" lineCap="round" />
          <BarYAxis />
          <ChartTooltip />
        </BarChart>
      </Frame>
    </>
  )
}
