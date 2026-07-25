import { PieChart, PieSlice, PieCenter } from "@/components/charts"
import { Frame, Row } from "../Frame"
import { categories } from "../demo-data"

export default function Demo() {
  return (
    <Row>
      <Frame title="Solid" hint="size 280">
        <div className="flex justify-center">
          <PieChart data={categories} size={280}>
            {categories.map((_, index) => (
              <PieSlice key={index} index={index} />
            ))}
          </PieChart>
        </div>
      </Frame>

      <Frame title="Donut + centre readout" hint="innerRadius 78, padAngle 0.03">
        <div className="flex justify-center">
          <PieChart
            data={categories}
            size={280}
            innerRadius={78}
            padAngle={0.03}
            cornerRadius={4}
          >
            {categories.map((_, index) => (
              <PieSlice key={index} index={index} hoverEffect="grow" />
            ))}
            <PieCenter defaultLabel="Revenue" prefix="$" />
          </PieChart>
        </div>
      </Frame>
    </Row>
  )
}
