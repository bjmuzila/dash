import {
  buildArcs,
  SunburstBreadcrumb,
  SunburstCenter,
  SunburstChart,
  SunburstHint,
  SunburstLabels,
  SunburstSegment,
  useSunburstBreadcrumbItems,
} from "@/components/charts"
import { Frame } from "../Frame"
import { sunburst } from "../demo-data"

export default function Demo() {
  const { arcs } = buildArcs(sunburst)

  return (
    <Frame title="Hierarchy with drill-down" hint="click a segment to zoom">
      <div className="flex justify-center">
        <SunburstChart data={sunburst} size={440}>
          <SunburstBreadcrumb>
            <DrillBreadcrumb />
          </SunburstBreadcrumb>
          {arcs.map((arc: any) => (
            <SunburstSegment index={arc.arcIndex} key={arc.id} />
          ))}
          <SunburstCenter />
          <SunburstLabels />
          <SunburstHint />
        </SunburstChart>
      </div>
    </Frame>
  )
}

/** Minimal breadcrumb so the demo doesn't depend on shadcn's breadcrumb primitive. */
function DrillBreadcrumb() {
  const { items, zoomTo } = useSunburstBreadcrumbItems()

  return (
    <ol className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
      {items.map((item: any, index: number) => (
        <li key={item.id} className="flex items-center gap-1">
          {index > 0 && <span className="opacity-50">/</span>}
          {item.isCurrent ? (
            <span className="text-foreground">{item.label}</span>
          ) : (
            <button
              type="button"
              onClick={() => zoomTo(item.id)}
              className="underline-offset-2 hover:text-foreground hover:underline"
            >
              {item.label}
            </button>
          )}
        </li>
      ))}
    </ol>
  )
}
