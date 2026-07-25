import { useState } from "react"
import { LineChart, Line, Grid, XAxis, ChartTooltip } from "@/components/charts"
import { Frame } from "@/components/frame"
import { timeSeries } from "@/lib/demo-data"

export default function Demo() {
  const [status, setStatus] = useState<"loading" | "ready">("ready")

  return (
    <>
      <Frame title="Basic" hint="Line + Grid + XAxis + ChartTooltip">
        <LineChart data={timeSeries}>
          <Grid horizontal />
          <Line dataKey="users" />
          <XAxis />
          <ChartTooltip />
        </LineChart>
      </Frame>

      <Frame title="Multi-series" hint="two Lines, custom strokes + markers">
        <LineChart data={timeSeries}>
          <Grid horizontal vertical />
          <Line dataKey="revenue" stroke="var(--chart-1)" showMarkers />
          <Line dataKey="costs" stroke="var(--chart-2)" strokeWidth={2} />
          <XAxis numTicks={8} />
          <ChartTooltip matchCrosshair />
        </LineChart>
      </Frame>

      <Frame
        title="Loading state"
        hint={
          <button
            onClick={() => setStatus((s) => (s === "ready" ? "loading" : "ready"))}
            className="rounded border border-border px-2 py-0.5 text-xs hover:text-foreground"
          >
            toggle → {status}
          </button>
        }
      >
        <LineChart data={timeSeries} status={status} loadingLabel="Fetching series…">
          <Grid horizontal shimmer />
          <Line dataKey="users" />
          <XAxis />
          <ChartTooltip />
        </LineChart>
      </Frame>
    </>
  )
}
