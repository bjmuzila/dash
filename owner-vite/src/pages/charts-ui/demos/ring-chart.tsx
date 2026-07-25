import { useState } from "react"
import {
  RingChart,
  Ring,
  RingCenter,
  Legend,
  LegendItemComponent,
  LegendMarker,
  LegendLabel,
  LegendValue,
} from "@/components/charts"
import { Frame } from "../Frame"
import { channels } from "../demo-data"

export default function Demo() {
  const [hovered, setHovered] = useState<number | null>(null)

  return (
    <Frame title="Rings synced with a legend" hint="hover either side">
      <div className="flex flex-wrap items-center justify-center gap-10">
        <RingChart
          data={channels}
          size={300}
          hoveredIndex={hovered}
          onHoverChange={setHovered}
        >
          {channels.map((item, index) => (
            <Ring key={item.label} index={index} />
          ))}
          <RingCenter defaultLabel="Total Sessions" />
        </RingChart>

        <Legend
          items={channels}
          title="Sessions by channel"
          hoveredIndex={hovered}
          onHoverChange={setHovered}
          className="min-w-56"
        >
          <LegendItemComponent className="flex items-center gap-3">
            <LegendMarker />
            <LegendLabel className="flex-1" />
            <LegendValue showPercentage />
          </LegendItemComponent>
        </Legend>
      </div>
    </Frame>
  )
}
