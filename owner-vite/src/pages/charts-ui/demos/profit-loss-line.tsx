import { curveLinear } from "@visx/curve"
import {
  LineChart,
  Line,
  Grid,
  XAxis,
  ChartTooltip,
  ProfitLossLine,
  profitLossColor,
  resolveProfitLossTooltipLabel,
} from "@/components/charts"
import { Frame } from "../Frame"
import { pnl } from "../demo-data"

export default function Demo() {
  return (
    <Frame title="Daily P&L" hint="zero line highlighted, stroke coloured by sign">
      <LineChart data={pnl}>
        <Grid highlightRowValues={[0]} horizontal />
        <Line
          curve={curveLinear}
          dataKey="pnl"
          fadeEdges={false}
          showHighlight={false}
          stroke="transparent"
          strokeWidth={0}
        />
        <ProfitLossLine dataKey="pnl" />
        <XAxis />
        <ChartTooltip
          indicatorColor={(point: Record<string, unknown>) =>
            profitLossColor((point.pnl as number) ?? 0)
          }
          rows={(point: Record<string, unknown>) => {
            const value = (point.pnl as number) ?? 0
            return [
              {
                color: profitLossColor(value),
                label: resolveProfitLossTooltipLabel(""),
                value,
              },
            ]
          }}
        />
      </LineChart>
    </Frame>
  )
}
