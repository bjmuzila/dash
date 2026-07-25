import { CandlestickChart, Candlestick, Grid, ChartTooltip, XAxis } from "@/components/charts"
import { Frame } from "../Frame"
import { ohlc } from "../demo-data"

export default function Demo() {
  return (
    <>
      <Frame title="Default" hint="60 daily OHLC bars">
        <CandlestickChart
          data={ohlc}
          margin={{ top: 16, right: 16, bottom: 40, left: 16 }}
          style={{ height: 360 }}
        >
          <Grid horizontal />
          <Candlestick fadedOpacity={0.25} />
          <ChartTooltip />
          <XAxis />
        </CandlestickChart>
      </Frame>

      <Frame title="Custom colours + gap" hint="positiveFill / negativeFill, candleGap 0.4">
        <CandlestickChart
          data={ohlc.slice(-30)}
          margin={{ top: 16, right: 16, bottom: 40, left: 16 }}
          style={{ height: 300 }}
        >
          <Grid horizontal />
          <Candlestick
            candleGap={0.4}
            positiveFill="var(--chart-2)"
            negativeFill="var(--chart-5)"
          />
          <ChartTooltip />
          <XAxis />
        </CandlestickChart>
      </Frame>
    </>
  )
}
