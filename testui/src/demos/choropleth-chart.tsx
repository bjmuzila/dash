import { useMemo } from "react"
import * as topojson from "topojson-client"
import topology from "world-atlas/countries-110m.json"
import {
  ChoroplethChart,
  ChoroplethFeatureComponent,
  ChoroplethGraticule,
  ChoroplethTooltip,
} from "@/components/charts"
import { Frame } from "@/components/frame"

/** Deterministic pseudo-value per country so the map is stable across reloads. */
function valueFor(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return h % 1000
}

export default function Demo() {
  const geojson = useMemo(
    () =>
      topojson.feature(
        topology as any,
        (topology as any).objects.countries,
      ) as unknown as GeoJSON.FeatureCollection,
    [],
  )

  return (
    <Frame title="World map" hint="world-atlas 110m, value shaded per country">
      <ChoroplethChart data={geojson} aspectRatio="16 / 9" zoomEnabled>
        <ChoroplethGraticule />
        <ChoroplethFeatureComponent
          getFeatureColor={(feature: any) => {
            const v = valueFor(String(feature.id ?? feature.properties?.name ?? ""))
            const step = Math.min(4, Math.floor(v / 200)) + 1
            return `var(--chart-scale-0${step})`
          }}
        />
        <ChoroplethTooltip
          getFeatureName={(feature: any) => String(feature.properties?.name ?? "—")}
          getFeatureValue={(feature: any) =>
            valueFor(String(feature.id ?? feature.properties?.name ?? ""))
          }
          valueLabel="Sessions"
        />
      </ChoroplethChart>
    </Frame>
  )
}
