"use client";

import { useMemo, useState } from "react";
import ChipLogo from "@/components/shared/ChipLogo";
import { useEconCalendar } from "@/hooks/useEconCalendar";
import {
  bucketCount,
  etToday,
  etWeekDays,
  fmtMcap,
  fullDayLabel,
  impactColor,
  isStale,
  passes,
  type CalEvent,
  type EarnRow,
  type FilterKey,
} from "@/lib/econCalendar";
import MobileShell from "../MobileShell";
import { RefreshIcon } from "../MobileIcons";
import { MChipRow, MEmpty, MSegmented } from "../MobileUI";
import { M_COLOR, MONO, RADIUS, TYPE, gridCols, noTapHighlight, rgba } from "../mobileTheme";

/**
 * MobileEcon — the economic calendar, phone edition.
 *
 * The desktop panel's event row (a `62px 1fr` grid) is already essentially
 * mobile-correct and is reproduced here. What could NOT come across:
 *
 *   - the filter dropdown. It portals into document.body at `position: fixed`
 *     coordinates computed once from getBoundingClientRect, never recomputed on
 *     scroll or rotation, with 26px rows. On a phone that is a broken control
 *     twice over. It becomes a scrolling chip row: one gesture, 34px targets.
 *   - the standalone page's toolbar, which has ~720px of intrinsic content in a
 *     no-wrap flex row inside an `overflow: hidden` parent. At 390px the
 *     refresh button is clipped off-screen and unreachable.
 *   - `title=` tooltips on the earnings chips. Market cap and EPS estimate were
 *     hover-only, i.e. invisible on touch, so they are printed in the row.
 *
 * Data comes from the shared useEconCalendar hook.
 */

const RANGE: { id: "today" | "week"; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "week", label: "This week" },
];

// The panel's default filter set, which is the right one for a phone: USD
// macro plus the presidential calendar plus earnings.
const DEFAULT_FILTERS: FilterKey[] = ["all-usd", "trump", "earnings"];

const FILTER_CHIPS: { id: FilterKey; label: string; accent: string }[] = [
  { id: "all-usd", label: "USD", accent: "#219EBC" },
  { id: "high", label: "High", accent: "#ef4444" },
  { id: "medium", label: "Medium", accent: "#f59e0b" },
  { id: "low", label: "Low", accent: "#3a5570" },
  { id: "trump", label: "President", accent: "#a855f7" },
  { id: "earnings", label: "Earnings", accent: "#219EBC" },
  { id: "all", label: "Everything", accent: "#ffffff" },
];

function EventRow({ ev, stale }: { ev: CalEvent; stale: boolean }) {
  const color = impactColor(ev.impact);
  const high = ev.impact === "High";
  return (
    <div
      style={{
        display: "grid",
        ...gridCols("64px 1fr"),
        gap: 8,
        padding: "9px 10px",
        borderRadius: RADIUS.md,
        background: stale ? "transparent" : "rgba(255,255,255,0.028)",
        opacity: stale ? 0.42 : 1,
        marginBottom: 4,
        borderLeft: `2px solid ${stale ? "transparent" : rgba(color, 0.75)}`,
      }}
    >
      <div style={{ ...MONO, fontSize: TYPE.label, fontWeight: 700, color: M_COLOR.dim, paddingTop: 1 }}>
        {ev.time_formatted || "—"}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2, flexWrap: "wrap" }}>
          <span
            style={{
              fontSize: TYPE.micro - 2,
              fontWeight: 800,
              letterSpacing: "0.07em",
              color,
              border: `1px solid ${rgba(color, 0.4)}`,
              borderRadius: 4,
              padding: "1px 5px",
              lineHeight: 1.4,
            }}
          >
            {ev.impact.toUpperCase()}
          </span>
          <span style={{ fontSize: TYPE.micro - 1, fontWeight: 700, color: M_COLOR.faint, letterSpacing: "0.06em" }}>
            {ev.country}
          </span>
        </div>
        <div
          style={{
            fontSize: TYPE.body,
            fontWeight: high ? 700 : 500,
            lineHeight: 1.35,
            color: M_COLOR.text,
            overflowWrap: "anywhere",
          }}
        >
          {ev.title}
        </div>
        {(ev.actual || ev.forecast || ev.previous) && (
          <div style={{ display: "flex", gap: 12, marginTop: 4, flexWrap: "wrap" }}>
            {ev.actual && (
              <span style={{ ...MONO, fontSize: TYPE.micro }}>
                <span style={{ color: M_COLOR.faint }}>A </span>
                <span style={{ color: "#22c55e", fontWeight: 700 }}>{ev.actual}</span>
              </span>
            )}
            {ev.forecast && (
              <span style={{ ...MONO, fontSize: TYPE.micro }}>
                <span style={{ color: M_COLOR.faint }}>F </span>
                <span style={{ color: "#f59e0b", fontWeight: 700 }}>{ev.forecast}</span>
              </span>
            )}
            {ev.previous && (
              <span style={{ ...MONO, fontSize: TYPE.micro }}>
                <span style={{ color: M_COLOR.faint }}>P </span>
                <span style={{ color: M_COLOR.dim, fontWeight: 700 }}>{ev.previous}</span>
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// "tbd" is the unconfirmed-time bucket (Nasdaq "time-not-supplied"). Same block,
// desaturated, so it never reads as a confirmed session at a glance.
type EarnKind = "pre" | "after" | "tbd";

function EarningsBlock({ kind, rows }: { kind: EarnKind; rows: EarnRow[] }) {
  if (!rows.length) return null;
  const label = kind === "pre" ? "PRE" : kind === "after" ? "AFTER" : "TBD";
  const accent = kind === "tbd" ? M_COLOR.faint : M_COLOR.cyan;
  return (
    <div
      style={{
        display: "grid",
        ...gridCols("64px 1fr"),
        gap: 8,
        padding: "8px 10px",
        marginBottom: 4,
        borderRadius: RADIUS.md,
        background: "rgba(255,255,255,0.02)",
        borderLeft: `2px solid ${rgba(accent, 0.5)}`,
      }}
    >
      <div
        style={{
          fontSize: TYPE.micro - 1,
          fontWeight: 800,
          letterSpacing: "0.07em",
          color: accent,
          paddingTop: 3,
        }}
      >
        {label}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
        {rows.map((r) => (
          <div key={r.symbol} style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <ChipLogo sym={r.symbol} company={r.company} size={22} radius={5} />
            <span style={{ ...MONO, fontSize: TYPE.body, fontWeight: 800, minWidth: 46 }}>{r.symbol}</span>
            <span
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: TYPE.micro,
                color: M_COLOR.faint,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {r.company}
            </span>
            {/* mcap + EPS were hover-only tooltips on desktop — printed here. */}
            <span style={{ ...MONO, fontSize: TYPE.micro, color: M_COLOR.dim, whiteSpace: "nowrap" }}>
              {fmtMcap(r.market_cap)}
              {r.eps_est ? ` · ${r.eps_est}` : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function MobileEcon() {
  const cal = useEconCalendar({ withQuote: false });
  const [range, setRange] = useState<"today" | "week">("today");
  const [filters, setFilters] = useState<Set<FilterKey>>(() => new Set(DEFAULT_FILTERS));

  const today = etToday();
  const days = useMemo(() => (range === "today" ? [today] : etWeekDays()), [range, today]);

  const toggleFilter = (id: string) => {
    const key = id as FilterKey;
    setFilters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      // Never leave the user with an empty filter set staring at a blank list.
      if (next.size === 0) next.add("all");
      return next;
    });
  };

  const showEarnings = filters.has("earnings") || filters.has("all");

  const byDay = useMemo(() => {
    const wanted = cal.events
      .filter((e) => days.includes(e.date) && passes(e, filters))
      .sort((a, b) => (a.date !== b.date ? a.date.localeCompare(b.date) : a.time.localeCompare(b.time)));
    const map = new Map<string, CalEvent[]>();
    for (const d of days) map.set(d, []);
    for (const e of wanted) map.get(e.date)?.push(e);
    return map;
  }, [cal.events, days, filters]);

  const anything = useMemo(() => {
    for (const d of days) {
      if ((byDay.get(d) ?? []).length) return true;
      if (showEarnings) {
        if (bucketCount(cal.earnByDate.get(d))) return true;
      }
    }
    return false;
  }, [days, byDay, cal.earnByDate, showEarnings]);

  return (
    <MobileShell
      title="Economic Calendar"
      right={
        <button
          type="button"
          onClick={() => void cal.reload()}
          aria-label="Refresh calendar"
          style={{
            ...noTapHighlight,
            width: 30,
            height: 30,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "50%",
            border: `1px solid ${M_COLOR.border}`,
            background: "rgba(255,255,255,0.04)",
            color: M_COLOR.dim,
            cursor: "pointer",
          }}
        >
          <RefreshIcon size={15} />
        </button>
      }
      sticky={
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <MSegmented options={RANGE} value={range} onChange={setRange} />
          <MChipRow
            items={FILTER_CHIPS.map((f) => ({ id: f.id, label: f.label, accent: f.accent }))}
            activeIds={filters as Set<string>}
            multi
            onSelect={toggleFilter}
          />
        </div>
      }
    >
      {/* The feed answers 200 with an empty array when it is down, so this
          banner is the only way a user can tell "nothing scheduled" from
          "nothing fetched". */}
      {(cal.warning || cal.source === "unavailable") && (
        <div
          style={{
            fontSize: TYPE.micro,
            lineHeight: 1.4,
            color: M_COLOR.orange,
            background: rgba(M_COLOR.orange, 0.1),
            border: `1px solid ${rgba(M_COLOR.orange, 0.3)}`,
            borderRadius: RADIUS.sm,
            padding: "7px 10px",
          }}
        >
          {cal.warning ?? "Calendar feed is unavailable — showing what was last cached."}
        </div>
      )}

      {cal.loading ? (
        <MEmpty tall>Loading the calendar…</MEmpty>
      ) : cal.error ? (
        <MEmpty tall>{cal.error}</MEmpty>
      ) : !anything ? (
        <MEmpty tall>
          Nothing scheduled {range === "today" ? "today" : "this week"} under these filters.
        </MEmpty>
      ) : (
        days.map((d) => {
          const evs = byDay.get(d) ?? [];
          const earn = showEarnings ? cal.earnByDate.get(d) : undefined;
          const hasEarn = bucketCount(earn) > 0;
          if (!evs.length && !hasEarn) return null;
          return (
            <section key={d}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "2px 2px 7px",
                  position: "sticky",
                  top: 0,
                  zIndex: 2,
                  background: "linear-gradient(180deg, rgba(5,6,10,0.96) 60%, rgba(5,6,10,0))",
                }}
              >
                <span
                  style={{
                    fontSize: TYPE.micro,
                    fontWeight: 800,
                    letterSpacing: "0.12em",
                    color: d === today ? M_COLOR.cyan : M_COLOR.faint,
                  }}
                >
                  {fullDayLabel(d, today)}
                </span>
                <span style={{ flex: 1, height: 1, background: M_COLOR.border }} />
                <span style={{ ...MONO, fontSize: TYPE.micro - 1, color: M_COLOR.faint }}>
                  {evs.length}
                </span>
              </div>
              {evs.map((ev, i) => (
                <EventRow key={`${ev.date}-${ev.time}-${ev.title}-${i}`} ev={ev} stale={isStale(ev, cal.now)} />
              ))}
              {earn && <EarningsBlock kind="pre" rows={earn.pre} />}
              {earn && <EarningsBlock kind="after" rows={earn.after} />}
              {/* Unconfirmed time last — no place in the day's sequence. */}
              {earn && <EarningsBlock kind="tbd" rows={earn.tbd} />}
            </section>
          );
        })
      )}
    </MobileShell>
  );
}
