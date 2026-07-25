import { useState } from "react"
import {
  RadarChart,
  RadarGrid,
  RadarAxis,
  RadarLabels,
  RadarArea,
} from "@/components/charts"
import { Frame } from "../Frame"
import { radarMetrics, radarSeries } from "../demo-data"

export default function Demo() {
  const [hovered, setHovered] = useState<number | null>(null)

  return (
    <Frame title="Two players, six metrics" hint="hover a series to isolate it">
      <div className="flex justify-center">
        <RadarChart
          data={radarSeries}
          metrics={radarMetrics}
          size={420}
          hoveredIndex={hovered}
          onHoverChange={setHovered}
        >
          <RadarGrid />
          <RadarAxis />
          <RadarLabels />
          {radarSeries.map((item, index) => (
            <RadarArea key={item.label} index={index} />
          ))}
        </RadarChart>
      </div>
    </Frame>
  )
}
