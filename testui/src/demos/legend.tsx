import {
  Legend,
  LegendItemComponent,
  LegendMarker,
  LegendLabel,
  LegendValue,
  LegendProgress,
} from "@/components/charts"
import { Frame, Row } from "@/components/frame"
import { channels } from "@/lib/demo-data"

export default function Demo() {
  return (
    <Row>
      <Frame title="Inline" hint="marker · label · value">
        <Legend items={channels}>
          <LegendItemComponent className="flex items-center gap-3">
            <LegendMarker />
            <LegendLabel className="flex-1" />
            <LegendValue />
          </LegendItemComponent>
        </Legend>
      </Frame>

      <Frame title="With progress + percentage" hint="grid layout, LegendProgress">
        <Legend items={channels} title="Sessions by Channel">
          <LegendItemComponent className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1">
            <LegendMarker />
            <LegendLabel />
            <LegendValue showPercentage />
            <div className="col-span-full">
              <LegendProgress />
            </div>
          </LegendItemComponent>
        </Legend>
      </Frame>
    </Row>
  )
}
