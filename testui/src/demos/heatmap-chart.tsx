import {
  HeatmapCells,
  HeatmapChart,
  HeatmapInteractionBoundary,
  HeatmapInteractionProvider,
  HeatmapLegend,
  HeatmapTooltip,
  HeatmapXAxis,
  HeatmapYAxis,
} from "@/components/charts"
import { Frame } from "@/components/frame"
import { heatmap } from "@/lib/demo-data"

export default function Demo() {
  return (
    <Frame title="Contribution grid" hint="26 weeks × 7 day bins">
      <HeatmapInteractionProvider>
        <HeatmapInteractionBoundary>
          <HeatmapChart data={heatmap} layout="fluid" gap={3}>
            <HeatmapCells />
            <HeatmapXAxis />
            <HeatmapYAxis />
            <HeatmapTooltip />
          </HeatmapChart>
          <HeatmapLegend />
        </HeatmapInteractionBoundary>
      </HeatmapInteractionProvider>
    </Frame>
  )
}
