import { useEffect, useRef, useState } from "react"
import {
  LiveLineChart,
  LiveLine,
  ChartTooltip,
  LiveXAxis,
  LiveYAxis,
} from "@/components/charts"
import { Frame } from "@/components/frame"
import { makeTicker } from "@/lib/demo-data"

type Point = { time: number; value: number }

export default function Demo() {
  const [data, setData] = useState<Point[]>([])
  const [value, setValue] = useState(6100)
  const [paused, setPaused] = useState(false)
  const tick = useRef(makeTicker(6100))

  useEffect(() => {
    if (paused) return
    const id = setInterval(() => {
      const point = tick.current()
      setData((prev) => [...prev.slice(-500), point])
      setValue(point.value)
    }, 250)
    return () => clearInterval(id)
  }, [paused])

  return (
    <Frame
      title="Streaming feed"
      hint={
        <button
          onClick={() => setPaused((p) => !p)}
          className="rounded border border-border px-2 py-0.5 text-xs hover:text-foreground"
        >
          {paused ? "▶ resume" : "⏸ pause"}
        </button>
      }
    >
      <LiveLineChart data={data} value={value} window={30} paused={paused}>
        <LiveLine
          dataKey="value"
          stroke="var(--chart-line-primary)"
          formatValue={(v: number) => `$${v.toFixed(2)}`}
        />
        <ChartTooltip showDatePill={false} />
        <LiveXAxis />
        <LiveYAxis position="right" formatValue={(v: number) => `$${v.toFixed(2)}`} />
      </LiveLineChart>
    </Frame>
  )
}
