import {
  AreaChart,
  Area,
  ChartBrush,
  ChartBrushLayout,
  Grid,
  XAxis,
  ChartTooltip,
} from "@/components/charts"
import { Frame } from "@/components/frame"
import { timeSeries } from "@/lib/demo-data"

export default function Demo() {
  return (
    <Frame title="Range select" hint="drag the strip below to zoom the main chart">
      <ChartBrushLayout
        data={timeSeries}
        enabled
        height={72}
        brushStrip={(layout: any) => (
          <AreaChart
            animationDuration={0}
            data={timeSeries}
            status="ready"
            style={{ aspectRatio: "unset", height: "100%" }}
          >
            <Area
              dataKey="revenue"
              fillOpacity={0.15}
              animate={false}
              showHighlight={false}
            />
            <ChartBrush
              initialSelection={layout.brushSelection ?? undefined}
              onSelectionChange={layout.onBrushSelectionChange}
            />
          </AreaChart>
        )}
      >
        {(layout: any) => (
          <AreaChart
            data={timeSeries}
            tweenYDomainOnXDomainChange
            xDomain={layout.xDomain}
            xDomainSlotCount={layout.xDomainSlotCount}
            yDomainTween
          >
            <Grid horizontal />
            <Area dataKey="revenue" fillOpacity={0.35} />
            <XAxis />
            <ChartTooltip />
          </AreaChart>
        )}
      </ChartBrushLayout>
    </Frame>
  )
}
