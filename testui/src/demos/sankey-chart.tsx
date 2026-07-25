import { SankeyChart, SankeyNode, SankeyLink, SankeyTooltip } from "@/components/charts"
import { Frame } from "@/components/frame"
import { sankey } from "@/lib/demo-data"

export default function Demo() {
  return (
    <Frame title="Traffic → landing → outcome" hint="hover a node or link">
      <SankeyChart data={sankey}>
        <SankeyLink />
        <SankeyNode lineCap={4} labelOrientation="vertical" />
        <SankeyTooltip />
      </SankeyChart>
    </Frame>
  )
}
