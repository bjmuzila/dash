import { Gauge } from "@/components/charts"
import { Frame, Row } from "@/components/frame"

export default function Demo() {
  return (
    <>
      <Row>
        <Frame title="Arc" hint="value 66, spacing 25">
          <div className="flex justify-center">
            <Gauge
              value={66}
              centerValue={428_000}
              spacing={25}
              inactiveFillOpacity={0.4}
              defaultLabel="ARR run rate"
              formatOptions={{
                style: "currency",
                currency: "USD",
                maximumFractionDigits: 0,
              }}
            />
          </div>
        </Frame>

        <Frame title="Arc + gradient" hint="useGradient, 72 notches">
          <div className="flex justify-center">
            <Gauge
              value={41}
              centerValue={0.41}
              totalNotches={72}
              spacing={10}
              useGradient
              defaultLabel="Utilisation"
              formatOptions={{ style: "percent", maximumFractionDigits: 0 }}
            />
          </div>
        </Frame>
      </Row>

      <Frame title="Linear" hint='orientation="linear", label bottom-centre'>
        <div className="flex justify-center">
          <Gauge
            orientation="linear"
            value={72}
            centerValue={428_000}
            defaultLabel="ARR run rate"
            labelPlacement="bottom"
            labelAlign="center"
            totalNotches={72}
            spacing={0}
            notchCornerRadius={3}
            inactiveFillOpacity={0.4}
            useGradient
          />
        </div>
      </Frame>
    </>
  )
}
