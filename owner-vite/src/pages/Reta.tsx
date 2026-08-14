/**
 * /owner/reta — retatrutide protocol tracker (owner-only). owner-vite page;
 * the Next twin at app/owner/reta/page.tsx is the fallback copy.
 *
 * TWO HALVES, ONE SOURCE OF TRUTH
 *   1. RECON CALCULATOR — vial mg + BAC water mL → concentration, and each
 *      person's dose in mg → units on a U-100 syringe. Saving it writes a
 *      `reta_setups` row keyed by the Sunday it takes effect.
 *   2. WEEKLY LOG — one row per Sunday. Each row resolves the recon in force on
 *      that date (the latest setup with effective_from <= the row's date), so
 *      changing the mix this week never rewrites the units of a past week.
 *
 * Units are NEVER stored. dose_mg is the stored fact; units and mL are derived
 * at render from the resolved recon. That's what makes a corrected recon fix a
 * whole week at once instead of leaving stale numbers in the table.
 *
 * Educational / personal tracking only — this page does no medical validation.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { HOME_THEME, RETA_PALETTE, SOFT_RED, homeInputStyle, statTileStyle } from "../lib/theme";
import { Card, PageShell } from "../components/PageCard";
import { ThemedDatePicker } from "../components/ThemedDatePicker";

// ── types ────────────────────────────────────────────────────────────────────
type PersonKey = "brandon" | "heather";
type Setup = {
  id: number;
  effective_from: string;
  vial_mg: number;
  bac_ml: number;
  syringe_units: number;
  note?: string | null;
};
type Shot = {
  id: number;
  shot_date: string;
  person: PersonKey;
  dose_mg: number;
  weight_lb: number | null;
  taken: number;
};

const PEOPLE: { key: PersonKey; label: string; color: string }[] = [
  { key: "brandon", label: "Brandon", color: RETA_PALETTE.blue },
  { key: "heather", label: "Heather", color: RETA_PALETTE.rose },
];

// Preset pills — mirror the vial sizes / water volumes actually used, with a
// Custom escape hatch for anything else.
const VIAL_PRESETS = [2, 5, 10, 15];
const WATER_PRESETS = [1, 2, 3, 5];
const DOSE_PRESETS = [0.25, 0.5, 1, 2];
const SYRINGE_PRESETS = [30, 50, 100];

const U_PER_ML = 100; // U-100 insulin syringe: 100 units = 1 mL

type TabKey = "tracker" | "charts";
const TABS: { key: TabKey; label: string }[] = [
  { key: "tracker", label: "Tracker" },
  { key: "charts", label: "Charts" },
];

/** One Sunday's plotted values for a person. null = nothing logged that week. */
type ChartPoint = { date: string; dose: number | null; weight: number | null; units: number | null };

// ── date helpers (all dates are "YYYY-MM-DD"; shot day is always Sunday) ─────
function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function todayIso(): string {
  return isoDate(new Date());
}
function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return isoDate(new Date(y, m - 1, d + days));
}
/** The Sunday on or before `iso` — every log row is anchored to one of these. */
function sundayOf(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return isoDate(new Date(y, m - 1, d - dt.getDay()));
}
function fmtDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function fmtDayYear(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ── dosing math ──────────────────────────────────────────────────────────────
/** mg per mL after reconstitution. */
function concentration(vialMg: number, bacMl: number): number {
  return bacMl > 0 ? vialMg / bacMl : 0;
}
/** mL to draw for a dose at a given concentration. */
function drawMl(doseMg: number, conc: number): number {
  return conc > 0 ? doseMg / conc : 0;
}
/** Syringe units to draw (U-100). */
function drawUnits(doseMg: number, conc: number): number {
  return drawMl(doseMg, conc) * U_PER_ML;
}
/**
 * Inverse of drawUnits: the mg delivered by N units on a U-100 syringe at a
 * given concentration. Lets a week be logged from the syringe — what you
 * actually read off the barrel — instead of from the mg. Still stores mg.
 */
function doseFromUnits(units: number, conc: number): number {
  return conc > 0 ? Math.round((units / U_PER_ML) * conc * 10000) / 10000 : 0;
}

function rgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}

const num = (v: number, dp = 2) => (Number.isFinite(v) ? v.toFixed(dp) : "—");

// ── small shared styles ──────────────────────────────────────────────────────
const LABEL: CSSProperties = {
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: rgba(HOME_THEME.text, 0.55),
};
const CELL: CSSProperties = {
  padding: "8px 10px",
  borderBottom: `1px solid ${HOME_THEME.border}`,
  fontSize: 13,
  whiteSpace: "nowrap",
};
const TH: CSSProperties = {
  ...CELL,
  ...LABEL,
  fontSize: 10,
  position: "sticky",
  top: 0,
  background: HOME_THEME.panelBgStrong,
  backdropFilter: "blur(12px)",
  zIndex: 1,
};

/** Numbered step badge, matching the calculator's "1 / 2 / 3" markers. */
function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
      <span
        style={{
          width: 22,
          height: 22,
          borderRadius: "50%",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 11,
          fontWeight: 800,
          color: HOME_THEME.cyan,
          border: `1px solid ${rgba(HOME_THEME.cyan, 0.45)}`,
          background: rgba(HOME_THEME.cyan, 0.12),
          flexShrink: 0,
        }}
      >
        {n}
      </span>
      <span style={{ fontSize: 14, fontWeight: 700 }}>{children}</span>
    </div>
  );
}

/**
 * Preset pill row with a Custom escape hatch. `value` is always the live number;
 * picking Custom reveals a free input without clearing what's already set.
 */
function PillRow({
  presets,
  value,
  onChange,
  suffix,
  accent = HOME_THEME.cyan,
  step = "0.05",
}: {
  presets: number[];
  value: number;
  onChange: (v: number) => void;
  suffix: string;
  accent?: string;
  step?: string;
}) {
  const isPreset = presets.some((p) => Math.abs(p - value) < 1e-9);
  const [custom, setCustom] = useState(!isPreset);
  useEffect(() => {
    // A value arriving from the server (or a preset click) that matches a pill
    // collapses the custom input again.
    if (isPreset) setCustom(false);
  }, [isPreset]);

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {presets.map((p) => {
        const on = !custom && Math.abs(p - value) < 1e-9;
        return (
          <button
            key={p}
            type="button"
            onClick={() => {
              setCustom(false);
              onChange(p);
            }}
            style={{
              padding: "9px 16px",
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
              color: on ? accent : HOME_THEME.text,
              border: `1px solid ${on ? rgba(accent, 0.55) : HOME_THEME.border}`,
              background: on ? rgba(accent, 0.16) : "rgba(255,255,255,0.03)",
              boxShadow: on ? `0 0 14px ${rgba(accent, 0.18)}` : "none",
            }}
          >
            {p} {suffix}
          </button>
        );
      })}
      <button
        type="button"
        onClick={() => setCustom(true)}
        style={{
          padding: "9px 16px",
          borderRadius: 10,
          fontSize: 13,
          fontWeight: 700,
          cursor: "pointer",
          color: custom ? accent : rgba(HOME_THEME.text, 0.7),
          border: `1px solid ${custom ? rgba(accent, 0.55) : HOME_THEME.border}`,
          background: custom ? rgba(accent, 0.16) : "rgba(255,255,255,0.03)",
        }}
      >
        Custom
      </button>
      {custom && (
        <input
          type="number"
          step={step}
          min="0"
          value={Number.isFinite(value) ? value : ""}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ ...homeInputStyle, width: 110, padding: "9px 12px" }}
          aria-label={`Custom ${suffix}`}
        />
      )}
    </div>
  );
}

/** U-100 syringe ruler with the draw volume filled in. */
function SyringeRuler({ units, capacity, accent }: { units: number; capacity: number; accent: string }) {
  const pct = capacity > 0 ? Math.min(100, Math.max(0, (units / capacity) * 100)) : 0;
  const overfull = units > capacity + 1e-9;
  const ticks = Math.max(1, Math.round(capacity / 10));
  return (
    <div>
      <div
        style={{
          position: "relative",
          height: 46,
          borderRadius: 8,
          border: `1px solid ${HOME_THEME.border}`,
          background: "rgba(0,0,0,0.35)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            width: `${pct}%`,
            background: `linear-gradient(180deg, ${rgba(overfull ? SOFT_RED : accent, 0.5)}, ${rgba(overfull ? SOFT_RED : accent, 0.16)})`,
            borderRight: `2px solid ${overfull ? SOFT_RED : accent}`,
          }}
        />
        {Array.from({ length: ticks + 1 }, (_, i) => {
          const u = i * 10;
          const left = capacity > 0 ? (u / capacity) * 100 : 0;
          const major = i % 2 === 0;
          return (
            <div key={u} style={{ position: "absolute", left: `${left}%`, top: 0, bottom: 0 }}>
              <div
                style={{
                  width: 1,
                  height: major ? 16 : 9,
                  background: rgba(HOME_THEME.text, major ? 0.4 : 0.22),
                }}
              />
              {major && u <= capacity && (
                <div
                  style={{
                    position: "absolute",
                    top: 18,
                    // The last label sits on the right edge — pull it inside the
                    // barrel instead of letting overflow clip it.
                    left: u === capacity ? undefined : 2,
                    right: u === capacity ? 2 : undefined,
                    fontSize: 9,
                    color: rgba(HOME_THEME.text, 0.45),
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {u}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 6, fontSize: 10, color: rgba(HOME_THEME.text, 0.5) }}>
        U-100 syringe · capacity {capacity} units
        {overfull ? " · DOSE EXCEEDS THE BARREL" : ""}
      </div>
    </div>
  );
}

/** Metric tile — label over a big number, with an optional sub-line. */
function Stat({
  label,
  value,
  sub,
  accent = HOME_THEME.text,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div style={{ ...statTileStyle, padding: "12px 14px", border: `1px solid ${HOME_THEME.border}` }}>
      <div style={{ ...LABEL, fontSize: 10 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: accent, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: rgba(HOME_THEME.text, 0.5), marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

/**
 * Number cell that only commits on blur / Enter, so a half-typed "1." never
 * round-trips to the server. Empty commits as null (clears the value).
 */
function NumCell({
  value,
  onCommit,
  width = 66,
  step = "0.05",
  placeholder,
  accent,
}: {
  value: number | null;
  onCommit: (v: number | null) => void;
  width?: number;
  step?: string;
  placeholder?: string;
  accent?: string;
}) {
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(value == null ? "" : String(value));
  }, [value, editing]);

  const commit = () => {
    setEditing(false);
    const t = draft.trim();
    if (t === "") {
      if (value != null) onCommit(null);
      return;
    }
    const n = Number(t);
    if (!Number.isFinite(n) || n < 0) {
      setDraft(value == null ? "" : String(value));
      return;
    }
    if (n !== value) onCommit(n);
  };

  return (
    <input
      type="number"
      step={step}
      min="0"
      value={draft}
      placeholder={placeholder}
      onFocus={() => setEditing(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setDraft(value == null ? "" : String(value));
          setEditing(false);
          (e.target as HTMLInputElement).blur();
        }
      }}
      style={{
        ...homeInputStyle,
        width,
        padding: "5px 8px",
        fontSize: 13,
        textAlign: "right",
        fontVariantNumeric: "tabular-nums",
        color: accent ?? HOME_THEME.text,
      }}
    />
  );
}

// ── page ─────────────────────────────────────────────────────────────────────
export default function RetaPage() {
  const thisSunday = useMemo(() => sundayOf(todayIso()), []);

  const [setups, setSetups] = useState<Setup[]>([]);
  const [shots, setShots] = useState<Shot[]>([]);
  const [weekNotes, setWeekNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [weeksAhead, setWeeksAhead] = useState(1);
  const [tab, setTab] = useState<TabKey>("tracker");

  // Calculator draft (Step 1/2/3 on the left of the card).
  const [effectiveFrom, setEffectiveFrom] = useState(thisSunday);
  const [vialMg, setVialMg] = useState(10);
  const [bacMl, setBacMl] = useState(2);
  const [syringeUnits, setSyringeUnits] = useState(100);
  const [doses, setDoses] = useState<Record<PersonKey, number>>({ brandon: 0.5, heather: 0.5 });
  // Dose entry unit — µg is just a ×1000 view over the same mg value.
  const [doseUnit, setDoseUnit] = useState<"mg" | "mcg">("mg");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/reta", { cache: "no-store" });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setSetups(data.setups ?? []);
      setShots(data.shots ?? []);
      const notes: Record<string, string> = {};
      for (const n of data.weekNotes ?? []) notes[n.shot_date] = n.note ?? "";
      setWeekNotes(notes);
      setErr(null);
    } catch (e) {
      setErr(`Could not load the Reta log (${String(e)})`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Seed the calculator from the recon currently in force so the card opens on
  // reality rather than on defaults.
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (seeded || loading) return;
    setSeeded(true);
    const inForce = [...setups].filter((s) => s.effective_from <= thisSunday).pop();
    if (inForce) {
      setVialMg(inForce.vial_mg);
      setBacMl(inForce.bac_ml);
      setSyringeUnits(inForce.syringe_units || 100);
    }
    const latest: Record<PersonKey, number> = { ...doses };
    for (const p of PEOPLE) {
      const last = shots.filter((s) => s.person === p.key && s.dose_mg > 0).pop();
      if (last) latest[p.key] = last.dose_mg;
    }
    setDoses(latest);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, setups, shots, thisSunday, seeded]);

  const post = useCallback(
    async (payload: Record<string, unknown>) => {
      setSaving(true);
      try {
        const res = await fetch("/api/reta", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const detail = await res.json().catch(() => ({}));
          throw new Error(detail?.error || `${res.status}`);
        }
        setErr(null);
        return true;
      } catch (e) {
        setErr(`Save failed — ${String(e)}`);
        return false;
      } finally {
        setSaving(false);
      }
    },
    []
  );

  // ── derived: shot lookup + recon resolution ────────────────────────────────
  const shotMap = useMemo(() => {
    const m = new Map<string, Shot>();
    for (const s of shots) m.set(`${s.shot_date}|${s.person}`, s);
    return m;
  }, [shots]);

  const sortedSetups = useMemo(
    () => [...setups].sort((a, b) => a.effective_from.localeCompare(b.effective_from)),
    [setups]
  );

  /** The recon in force on `date` — the latest setup effective on or before it. */
  const setupFor = useCallback(
    (date: string): Setup | null => {
      let hit: Setup | null = null;
      for (const s of sortedSetups) {
        if (s.effective_from <= date) hit = s;
        else break;
      }
      return hit;
    },
    [sortedSetups]
  );

  // Every Sunday that needs a row: from the earliest thing on record through
  // `weeksAhead` past this week, so the upcoming shot can be filled in early.
  const weeks = useMemo(() => {
    const marks = new Set<string>([thisSunday]);
    for (const s of shots) marks.add(sundayOf(s.shot_date));
    for (const d of Object.keys(weekNotes)) marks.add(sundayOf(d));
    for (const s of sortedSetups) marks.add(sundayOf(s.effective_from));
    const all = [...marks].sort();
    const start = all[0] ?? thisSunday;
    const lastMark = all[all.length - 1] ?? thisSunday;
    const end = [addDays(thisSunday, 7 * weeksAhead), lastMark].sort().pop() as string;
    const out: string[] = [];
    for (let d = start; d <= end; d = addDays(d, 7)) out.push(d);
    return out;
  }, [shots, weekNotes, sortedSetups, thisSunday, weeksAhead]);

  /** Dose to show when a week has no row yet: carry the last dose forward. */
  const carriedDose = useCallback(
    (person: PersonKey, date: string): number | null => {
      const prior = shots
        .filter((s) => s.person === person && s.shot_date < date && s.dose_mg > 0)
        .sort((a, b) => a.shot_date.localeCompare(b.shot_date))
        .pop();
      return prior ? prior.dose_mg : null;
    },
    [shots]
  );

  // ── writes (optimistic, then reconcile with the row the server returns) ────
  const saveShot = async (
    date: string,
    person: PersonKey,
    patch: { doseMg?: number; weightLb?: number | null; taken?: boolean }
  ) => {
    const key = `${date}|${person}`;
    const prev = shotMap.get(key);
    // Optimistic local write so the table never lags a keystroke behind.
    setShots((rows) => {
      const next = rows.filter((r) => !(r.shot_date === date && r.person === person));
      next.push({
        id: prev?.id ?? -Date.parse(date) - (person === "brandon" ? 1 : 2),
        shot_date: date,
        person,
        dose_mg: patch.doseMg ?? prev?.dose_mg ?? 0,
        weight_lb: patch.weightLb !== undefined ? patch.weightLb : prev?.weight_lb ?? null,
        taken: patch.taken !== undefined ? (patch.taken ? 1 : 0) : prev?.taken ?? 0,
      });
      return next.sort((a, b) => a.shot_date.localeCompare(b.shot_date) || a.person.localeCompare(b.person));
    });
    const ok = await post({ action: "shot", date, person, ...patch });
    if (ok) void load();
  };

  const saveNote = async (date: string, note: string) => {
    setWeekNotes((n) => ({ ...n, [date]: note }));
    await post({ action: "weekNote", date, note });
  };

  const saveSetup = async () => {
    const day = sundayOf(effectiveFrom);
    const ok = await post({
      action: "setup",
      effectiveFrom: day,
      vialMg,
      bacMl,
      syringeUnits,
    });
    if (!ok) return;
    // The recon and the doses it was calculated for belong together, so saving
    // the mix also stamps that week's doses (mg — units are always derived).
    for (const p of PEOPLE) {
      if (doses[p.key] > 0) await post({ action: "shot", date: day, person: p.key, doseMg: doses[p.key] });
    }
    void load();
  };

  const deleteSetup = async (id: number) => {
    setSetups((s) => s.filter((x) => x.id !== id));
    const ok = await post({ action: "setupDelete", id });
    if (ok) void load();
  };

  // ── derived: calculator preview + per-person summary ───────────────────────
  const conc = concentration(vialMg, bacMl);
  const weeklyTotalMg = PEOPLE.reduce((sum, p) => sum + (doses[p.key] || 0), 0);
  const weeksPerVial = weeklyTotalMg > 0 ? vialMg / weeklyTotalMg : 0;

  const summary = useMemo(() => {
    return PEOPLE.map((p) => {
      const mine = shots
        .filter((s) => s.person === p.key)
        .sort((a, b) => a.shot_date.localeCompare(b.shot_date));
      const weights = mine.filter((s) => s.weight_lb != null);
      const first = weights[0]?.weight_lb ?? null;
      const last = weights[weights.length - 1]?.weight_lb ?? null;
      const taken = mine.filter((s) => s.taken === 1);
      const lastDose = taken[taken.length - 1] ?? mine.filter((s) => s.dose_mg > 0).pop() ?? null;
      return {
        person: p,
        first,
        last,
        change: first != null && last != null ? last - first : null,
        shotsTaken: taken.length,
        totalMg: taken.reduce((sum, s) => sum + s.dose_mg, 0),
        lastDoseMg: lastDose?.dose_mg ?? null,
      };
    });
  }, [shots]);

  const inForce = setupFor(thisSunday);

  // One aligned series per person: every Sunday in `weeks` gets a slot so both
  // people share an x-axis and a skipped week reads as a gap, not a straight
  // line across it.
  const chartSeries = useMemo(() => {
    const out = {} as Record<PersonKey, ChartPoint[]>;
    for (const p of PEOPLE) {
      out[p.key] = weeks.map((day) => {
        const shot = shotMap.get(`${day}|${p.key}`);
        const dose = shot && shot.dose_mg > 0 ? shot.dose_mg : null;
        const setup = setupFor(day);
        const c = setup ? concentration(setup.vial_mg, setup.bac_ml) : 0;
        return {
          date: day,
          dose,
          weight: shot?.weight_lb ?? null,
          units: dose != null && c > 0 ? drawUnits(dose, c) : null,
        };
      });
    }
    return out;
  }, [weeks, shotMap, setupFor]);

  return (
    <PageShell>
      {/* header */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.01em" }}>Reta</div>
          <div style={{ fontSize: 12, color: rgba(HOME_THEME.text, 0.55), marginTop: 2 }}>
            Reconstitution calculator + weekly shot log — Brandon &amp; Heather. Shot day is Sunday.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {saving && <span style={{ fontSize: 11, color: HOME_THEME.cyan }}>saving…</span>}
          <span style={{ ...LABEL, fontSize: 10 }}>
            In force now:{" "}
            {inForce
              ? `${num(inForce.vial_mg, 0)} mg / ${num(inForce.bac_ml, 2)} mL = ${num(concentration(inForce.vial_mg, inForce.bac_ml))} mg/mL`
              : "no recon saved yet"}
          </span>
        </div>
      </div>

      {err && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            border: `1px solid ${rgba(SOFT_RED, 0.5)}`,
            background: rgba(SOFT_RED, 0.1),
            color: SOFT_RED,
            fontSize: 12,
          }}
        >
          {err}
        </div>
      )}

      {/* ── summary tiles ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
        <Stat
          label="Concentration"
          value={`${num(conc)} mg/mL`}
          sub={`${num(vialMg, 0)} mg ÷ ${num(bacMl, 2)} mL`}
          accent={RETA_PALETTE.peach}
        />
        <Stat
          label="Weeks per vial"
          value={weeksPerVial > 0 ? num(weeksPerVial, 1) : "—"}
          sub={`${num(weeklyTotalMg)} mg used per week`}
        />
        {summary.map((s) => (
          <Stat
            key={s.person.key}
            label={`${s.person.label} — weight`}
            value={s.last != null ? `${num(s.last, 1)} lb` : "—"}
            sub={
              s.change != null
                ? `${s.change <= 0 ? "▼" : "▲"} ${num(Math.abs(s.change), 1)} lb since ${num(s.first ?? 0, 1)}`
                : "no weight logged yet"
            }
            accent={s.change != null && s.change < 0 ? RETA_PALETTE.green : HOME_THEME.text}
          />
        ))}
        {summary.map((s) => (
          <Stat
            key={`${s.person.key}-dose`}
            label={`${s.person.label} — shots`}
            value={String(s.shotsTaken)}
            sub={`${num(s.totalMg)} mg total · last ${s.lastDoseMg != null ? `${num(s.lastDoseMg)} mg` : "—"}`}
            accent={s.person.color}
          />
        ))}
      </div>

      {/* ── tabs ── */}
      <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
        {TABS.map((t) => {
          const on = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              style={{
                padding: "9px 18px",
                borderRadius: 10,
                fontSize: 12,
                fontWeight: 800,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                cursor: "pointer",
                color: on ? HOME_THEME.cyan : rgba(HOME_THEME.text, 0.7),
                border: `1px solid ${on ? rgba(HOME_THEME.cyan, 0.5) : HOME_THEME.border}`,
                background: on ? rgba(HOME_THEME.cyan, 0.14) : "rgba(255,255,255,0.03)",
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "charts" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(430px, 1fr))", gap: 16, flexShrink: 0 }}>
          {PEOPLE.map((p) => (
            <PersonChart key={p.key} person={p} series={chartSeries[p.key]} />
          ))}
        </div>
      )}

      {tab === "tracker" && (
      <>
      {/* ── calculator ── */}
      <Card variant="budget" padding={0} style={{ overflow: "hidden", flexShrink: 0 }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 1fr) minmax(320px, 1fr)", gap: 0 }}>
          {/* left: inputs */}
          <div style={{ padding: 22, borderRight: `1px solid ${HOME_THEME.border}` }}>
            <div style={{ ...LABEL, marginBottom: 4 }}>Step 1 of 2 — start with the basics</div>
            <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 18 }}>This week&apos;s mix</div>

            <div style={{ marginBottom: 18 }}>
              <Step n={1}>What&apos;s in your vial?</Step>
              <PillRow presets={VIAL_PRESETS} value={vialMg} onChange={setVialMg} suffix="mg" step="0.5" />
            </div>

            <div style={{ marginBottom: 18 }}>
              <Step n={2}>How much BAC water did you add?</Step>
              <PillRow presets={WATER_PRESETS} value={bacMl} onChange={setBacMl} suffix="mL" step="0.1" />
            </div>

            <div style={{ marginBottom: 18 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <Step n={3}>What dose does each of you want?</Step>
                <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
                  {(["mg", "mcg"] as const).map((u) => (
                    <button
                      key={u}
                      type="button"
                      onClick={() => setDoseUnit(u)}
                      style={{
                        padding: "6px 12px",
                        borderRadius: 8,
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: "pointer",
                        color: doseUnit === u ? HOME_THEME.bg : HOME_THEME.text,
                        background: doseUnit === u ? HOME_THEME.cyan : "rgba(255,255,255,0.04)",
                        border: `1px solid ${doseUnit === u ? HOME_THEME.cyan : HOME_THEME.border}`,
                      }}
                    >
                      {u === "mg" ? "mg" : "µg"}
                    </button>
                  ))}
                </div>
              </div>
              {PEOPLE.map((p) => (
                <div key={p.key} style={{ marginBottom: 12 }}>
                  <div style={{ ...LABEL, color: p.color, marginBottom: 6 }}>{p.label}</div>
                  {doseUnit === "mg" ? (
                    <PillRow
                      presets={DOSE_PRESETS}
                      value={doses[p.key]}
                      onChange={(v) => setDoses((d) => ({ ...d, [p.key]: v }))}
                      suffix="mg"
                      accent={p.color}
                    />
                  ) : (
                    <PillRow
                      presets={DOSE_PRESETS.map((d) => d * 1000)}
                      value={Math.round(doses[p.key] * 1000)}
                      onChange={(v) => setDoses((d) => ({ ...d, [p.key]: v / 1000 }))}
                      suffix="µg"
                      accent={p.color}
                      step="25"
                    />
                  )}
                </div>
              ))}
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 14 }}>
              <div>
                <div style={{ ...LABEL, marginBottom: 6 }}>Effective from (Sunday)</div>
                <ThemedDatePicker value={effectiveFrom} onChange={(v) => setEffectiveFrom(sundayOf(v))} width={160} />
              </div>
              <div>
                <div style={{ ...LABEL, marginBottom: 6 }}>Syringe</div>
                <div style={{ display: "flex", gap: 6 }}>
                  {SYRINGE_PRESETS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setSyringeUnits(c)}
                      style={{
                        padding: "8px 12px",
                        borderRadius: 8,
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: "pointer",
                        color: syringeUnits === c ? HOME_THEME.cyan : HOME_THEME.text,
                        border: `1px solid ${syringeUnits === c ? rgba(HOME_THEME.cyan, 0.55) : HOME_THEME.border}`,
                        background: syringeUnits === c ? rgba(HOME_THEME.cyan, 0.16) : "rgba(255,255,255,0.03)",
                      }}
                    >
                      {c}u
                    </button>
                  ))}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void saveSetup()}
                disabled={saving || conc <= 0}
                style={{
                  padding: "11px 20px",
                  borderRadius: 10,
                  fontSize: 13,
                  fontWeight: 800,
                  letterSpacing: "0.04em",
                  cursor: saving || conc <= 0 ? "not-allowed" : "pointer",
                  color: HOME_THEME.bg,
                  background: `linear-gradient(180deg, ${RETA_PALETTE.green}, ${RETA_PALETTE.blue})`,
                  border: "none",
                  opacity: saving || conc <= 0 ? 0.5 : 1,
                }}
              >
                Save this week&apos;s recon
              </button>
            </div>
            <div style={{ fontSize: 10, color: rgba(HOME_THEME.text, 0.4), marginTop: 10 }}>
              Applies from {fmtDayYear(sundayOf(effectiveFrom))} forward — earlier weeks keep the recon they were logged
              under. Educational / personal tracking only.
            </div>
          </div>

          {/* right: live preview */}
          <div style={{ padding: 22, background: rgba(HOME_THEME.cyan, 0.03) }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <div style={{ ...LABEL, marginBottom: 4 }}>Instant result preview</div>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "4px 10px",
                  borderRadius: 999,
                  color: RETA_PALETTE.green,
                  border: `1px solid ${rgba(RETA_PALETTE.green, 0.4)}`,
                  background: rgba(RETA_PALETTE.green, 0.1),
                }}
              >
                Updates as you enter
              </span>
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 16 }}>What to draw</div>

            {PEOPLE.map((p) => {
              const doseMg = doses[p.key] || 0;
              const units = drawUnits(doseMg, conc);
              const ml = drawMl(doseMg, conc);
              return (
                <div
                  key={p.key}
                  style={{
                    marginBottom: 14,
                    padding: 16,
                    borderRadius: 14,
                    border: `1px solid ${rgba(p.color, 0.35)}`,
                    background: rgba(p.color, 0.07),
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                    <div style={{ ...LABEL, color: p.color }}>{p.label}</div>
                    <div style={{ fontSize: 11, color: rgba(HOME_THEME.text, 0.6) }}>
                      dose {num(doseMg)} mg ({Math.round(doseMg * 1000)} µg)
                    </div>
                  </div>
                  <div style={{ textAlign: "center", margin: "8px 0 12px" }}>
                    <span style={{ fontSize: 40, fontWeight: 800, color: p.color, fontVariantNumeric: "tabular-nums" }}>
                      {num(units, 1)}
                    </span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: rgba(HOME_THEME.text, 0.7), marginLeft: 8 }}>
                      units
                    </span>
                    <div style={{ fontSize: 11, color: rgba(HOME_THEME.text, 0.5), marginTop: 2 }}>
                      = {num(ml, 3)} mL on the syringe
                    </div>
                  </div>
                  <SyringeRuler units={units} capacity={syringeUnits} accent={p.color} />
                </div>
              );
            })}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10 }}>
              <Stat label="Concentration" value={`${num(conc)}`} sub="mg / mL" accent={RETA_PALETTE.peach} />
              <Stat label="Total volume" value={`${num(bacMl, 2)}`} sub="mL in vial" />
              <Stat label="mL per mg" value={num(conc > 0 ? 1 / conc : 0, 3)} sub="draw factor" />
              <Stat
                label="Weeks per vial"
                value={weeklyTotalMg > 0 ? num(vialMg / weeklyTotalMg, 1) : "—"}
                sub={`both doses = ${num(weeklyTotalMg)} mg/wk`}
              />
            </div>
          </div>
        </div>
      </Card>

      {/* ── recon history ── */}
      <Card variant="classic" title="Recon history" padding={18}>
        {sortedSetups.length === 0 ? (
          <div style={{ fontSize: 12, color: rgba(HOME_THEME.text, 0.5) }}>
            No recon saved yet — set the mix above and hit “Save this week&apos;s recon”.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[...sortedSetups].reverse().map((s) => {
              const c = concentration(s.vial_mg, s.bac_ml);
              const current = inForce?.id === s.id;
              return (
                <div
                  key={s.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    flexWrap: "wrap",
                    padding: "10px 14px",
                    borderRadius: 10,
                    border: `1px solid ${current ? rgba(RETA_PALETTE.green, 0.4) : HOME_THEME.border}`,
                    background: current ? rgba(RETA_PALETTE.green, 0.07) : "rgba(255,255,255,0.02)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13, fontWeight: 800, minWidth: 110 }}>{fmtDayYear(s.effective_from)}</span>
                    <span style={{ fontSize: 12, color: rgba(HOME_THEME.text, 0.7) }}>
                      {num(s.vial_mg, 0)} mg + {num(s.bac_ml, 2)} mL BAC
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 800, color: RETA_PALETTE.peach }}>{num(c)} mg/mL</span>
                    <span style={{ fontSize: 11, color: rgba(HOME_THEME.text, 0.45) }}>{s.syringe_units}u syringe</span>
                    {current && (
                      <span style={{ ...LABEL, fontSize: 9, color: RETA_PALETTE.green }}>in force</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setVialMg(s.vial_mg);
                      setBacMl(s.bac_ml);
                      setSyringeUnits(s.syringe_units || 100);
                      setEffectiveFrom(s.effective_from);
                    }}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 8,
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: "pointer",
                      color: HOME_THEME.cyan,
                      border: `1px solid ${rgba(HOME_THEME.cyan, 0.35)}`,
                      background: rgba(HOME_THEME.cyan, 0.1),
                    }}
                  >
                    Load
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteSetup(s.id)}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 8,
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: "pointer",
                      color: SOFT_RED,
                      border: `1px solid ${rgba(SOFT_RED, 0.35)}`,
                      background: rgba(SOFT_RED, 0.08),
                    }}
                  >
                    Delete
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* ── weekly log ── */}
      <Card variant="classic" padding={0} style={{ overflow: "hidden", flexShrink: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
            padding: "16px 18px",
            borderBottom: `1px solid ${HOME_THEME.border}`,
          }}
        >
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase" }}>
              Weekly log
            </div>
            <div style={{ fontSize: 11, color: rgba(HOME_THEME.text, 0.5), marginTop: 2 }}>
              Type the dose in mg <em>or</em> the units you drew on the syringe — each fills in the other using the recon in
              force that week. Tick it when it&apos;s taken.
            </div>
          </div>
          <button
            type="button"
            onClick={() => setWeeksAhead((w) => w + 1)}
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              cursor: "pointer",
              color: HOME_THEME.cyan,
              border: `1px solid ${rgba(HOME_THEME.cyan, 0.35)}`,
              background: rgba(HOME_THEME.cyan, 0.1),
            }}
          >
            + Add a week
          </button>
        </div>

        <div style={{ overflow: "auto", maxHeight: "60vh" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
            <thead>
              <tr>
                <th style={{ ...TH, textAlign: "left" }}>Wk</th>
                <th style={{ ...TH, textAlign: "left" }}>Sunday</th>
                <th style={{ ...TH, textAlign: "right" }}>Recon</th>
                {PEOPLE.map((p) => (
                  <th
                    key={p.key}
                    colSpan={4}
                    style={{ ...TH, textAlign: "center", color: p.color, borderLeft: `1px solid ${HOME_THEME.border}` }}
                  >
                    {p.label}
                  </th>
                ))}
                <th style={{ ...TH, textAlign: "left", borderLeft: `1px solid ${HOME_THEME.border}` }}>Note</th>
              </tr>
              <tr>
                <th style={{ ...TH, top: 30 }} />
                <th style={{ ...TH, top: 30 }} />
                <th style={{ ...TH, top: 30, textAlign: "right" }}>mg/mL</th>
                {PEOPLE.map((p) => (
                  <ThHeadGroup key={p.key} />
                ))}
                <th style={{ ...TH, top: 30, borderLeft: `1px solid ${HOME_THEME.border}` }} />
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td style={{ ...CELL, textAlign: "center", padding: 24 }} colSpan={12}>
                    Loading…
                  </td>
                </tr>
              )}
              {!loading &&
                // Newest Sunday on top. `weeks` stays chronological (the charts
                // and the carry-forward lookups depend on it), so only the render
                // order flips — the Wk number still counts up from week 1.
                weeks.map((_d, idx) => weeks[weeks.length - 1 - idx]).map((day) => {
                  const i = weeks.indexOf(day);
                  const setup = setupFor(day);
                  const c = setup ? concentration(setup.vial_mg, setup.bac_ml) : 0;
                  const isThisWeek = day === thisSunday;
                  const future = day > thisSunday;
                  return (
                    <tr
                      key={day}
                      style={{
                        background: isThisWeek ? rgba(HOME_THEME.cyan, 0.08) : future ? "rgba(255,255,255,0.01)" : "transparent",
                      }}
                    >
                      <td style={{ ...CELL, color: rgba(HOME_THEME.text, 0.4), fontVariantNumeric: "tabular-nums" }}>
                        {i + 1}
                      </td>
                      <td style={{ ...CELL, fontWeight: isThisWeek ? 800 : 600 }}>
                        {fmtDay(day)}
                        {isThisWeek && (
                          <span style={{ ...LABEL, fontSize: 9, color: HOME_THEME.cyan, marginLeft: 8 }}>this week</span>
                        )}
                      </td>
                      <td
                        style={{
                          ...CELL,
                          textAlign: "right",
                          color: c > 0 ? RETA_PALETTE.peach : rgba(HOME_THEME.text, 0.3),
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {c > 0 ? num(c) : "—"}
                      </td>

                      {PEOPLE.map((p) => {
                        const shot = shotMap.get(`${day}|${p.key}`);
                        const carried = carriedDose(p.key, day);
                        const doseMg = shot?.dose_mg ?? null;
                        const effectiveDose = doseMg && doseMg > 0 ? doseMg : null;
                        const units = effectiveDose != null ? drawUnits(effectiveDose, c) : null;
                        return (
                          <PersonCells
                            key={p.key}
                            accent={p.color}
                            doseMg={effectiveDose}
                            placeholder={carried != null ? String(carried) : undefined}
                            units={units}
                            unitsPlaceholder={
                              carried != null && c > 0 ? String(Math.round(drawUnits(carried, c) * 10) / 10) : undefined
                            }
                            canEditUnits={c > 0}
                            weight={shot?.weight_lb ?? null}
                            taken={shot?.taken === 1}
                            onUnits={(v) => void saveShot(day, p.key, { doseMg: v == null ? 0 : doseFromUnits(v, c) })}
                            onDose={(v) => void saveShot(day, p.key, { doseMg: v ?? 0 })}
                            onWeight={(v) => void saveShot(day, p.key, { weightLb: v })}
                            onTaken={(v) => void saveShot(day, p.key, { taken: v })}
                          />
                        );
                      })}

                      <td style={{ ...CELL, borderLeft: `1px solid ${HOME_THEME.border}`, whiteSpace: "normal", minWidth: 180 }}>
                        <NoteCell value={weekNotes[day] ?? ""} onCommit={(v) => void saveNote(day, v)} />
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </Card>
      </>
      )}
    </PageShell>
  );
}

/** Sub-header cells for one person's column group. */
function ThHeadGroup() {
  return (
    <>
      <th style={{ ...TH, top: 30, textAlign: "right", borderLeft: `1px solid ${HOME_THEME.border}` }}>Dose mg</th>
      <th style={{ ...TH, top: 30, textAlign: "right" }}>Units (u)</th>
      <th style={{ ...TH, top: 30, textAlign: "right" }}>Weight</th>
      <th style={{ ...TH, top: 30, textAlign: "center" }}>Took</th>
    </>
  );
}

/**
 * One person's four cells for a week: dose, units, weight, taken.
 *
 * Dose and units are two views of the SAME stored fact (dose_mg) — type either
 * one and the other follows. Units are only editable once that week has a recon
 * in force, since without a concentration there is nothing to convert with.
 */
function PersonCells({
  accent,
  doseMg,
  placeholder,
  units,
  unitsPlaceholder,
  canEditUnits,
  weight,
  taken,
  onDose,
  onUnits,
  onWeight,
  onTaken,
}: {
  accent: string;
  doseMg: number | null;
  placeholder?: string;
  units: number | null;
  unitsPlaceholder?: string;
  canEditUnits: boolean;
  weight: number | null;
  taken: boolean;
  onDose: (v: number | null) => void;
  onUnits: (v: number | null) => void;
  onWeight: (v: number | null) => void;
  onTaken: (v: boolean) => void;
}) {
  return (
    <>
      <td style={{ ...CELL, textAlign: "right", borderLeft: `1px solid ${HOME_THEME.border}` }}>
        <NumCell value={doseMg} onCommit={onDose} placeholder={placeholder} accent={accent} />
      </td>
      <td
        style={{
          ...CELL,
          textAlign: "right",
          fontWeight: 800,
          color: units != null ? accent : rgba(HOME_THEME.text, 0.25),
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {canEditUnits ? (
          <NumCell
            value={units != null ? Math.round(units * 10) / 10 : null}
            onCommit={onUnits}
            placeholder={unitsPlaceholder}
            accent={accent}
            step="0.5"
            width={66}
          />
        ) : (
          units != null ? num(units, 1) : "—"
        )}
      </td>
      <td style={{ ...CELL, textAlign: "right" }}>
        <NumCell value={weight} onCommit={onWeight} step="0.1" width={72} />
      </td>
      <td style={{ ...CELL, textAlign: "center" }}>
        <input
          type="checkbox"
          checked={taken}
          onChange={(e) => onTaken(e.target.checked)}
          aria-label="Shot taken"
          style={{ width: 16, height: 16, accentColor: accent, cursor: "pointer" }}
        />
      </td>
    </>
  );
}

// ── charts ───────────────────────────────────────────────────────────────────
// Hand-rolled SVG: two stacked panels per person sharing one x-axis. Dose and
// weight are NOT overlaid on twin y-scales — a dual-axis plot lets you slide one
// series against the other until any correlation you like appears. Stacked
// panels keep both readable against their own scale with the dates aligned.
const CHART_W = 640;
const CHART_H = 344;
const PAD_L = 48;
const PAD_R = 16;
const DOSE_TOP = 34, DOSE_H = 96;
const WEIGHT_TOP = 176, WEIGHT_H = 108;
const X_LABEL_Y = 300;

/** Round a raw step up to something a human would label an axis with. */
function niceStep(raw: number): number {
  const steps = [0.05, 0.1, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 250];
  return steps.find((s) => s >= raw) ?? 500;
}

/** Padded, round-numbered domain + tick list for one panel. */
function scaleFor(values: number[]): { lo: number; hi: number; ticks: number[] } | null {
  const vals = values.filter((v) => Number.isFinite(v));
  if (!vals.length) return null;
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (hi === lo) { lo -= Math.max(0.5, Math.abs(lo) * 0.05); hi += Math.max(0.5, Math.abs(hi) * 0.05); }
  const step = niceStep((hi - lo) / 3);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return { lo, hi, ticks };
}

/** Path string that breaks at gaps instead of drawing through missing weeks. */
function pathFor(pts: (number | null)[], x: (i: number) => number, y: (v: number) => number): string {
  let d = "", pen = false;
  pts.forEach((v, i) => {
    if (v == null) { pen = false; return; }
    d += `${pen ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
    pen = true;
  });
  return d.trim();
}

/**
 * Backlit line: a blurred colored copy under a solid stroke under a thin white
 * core — the glow reads on the near-black surface without any area fill.
 */
function GlowLine({ d, color, id }: { d: string; color: string; id: string }) {
  if (!d) return null;
  return (
    <>
      <path d={d} stroke={color} strokeWidth={3.5} fill="none" opacity={0.75} filter={`url(#${id})`}
        strokeLinecap="round" strokeLinejoin="round" />
      <path d={d} stroke={color} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d={d} stroke={HOME_THEME.text} strokeWidth={0.8} fill="none" opacity={0.65}
        strokeLinecap="round" strokeLinejoin="round" />
    </>
  );
}

/** One person's card: dose panel over weight panel, shared dates, hover readout. */
function PersonChart({
  person,
  series,
}: {
  person: { key: PersonKey; label: string; color: string };
  series: ChartPoint[];
}) {
  const [hover, setHover] = useState<number | null>(null);
  const glowId = `reta-glow-${person.key}`;
  const n = series.length;

  const doseScale = scaleFor(series.map((p) => p.dose).filter((v): v is number => v != null));
  const weightScale = scaleFor(series.map((p) => p.weight).filter((v): v is number => v != null));

  const x = (i: number) => (n <= 1 ? PAD_L : PAD_L + (i * (CHART_W - PAD_L - PAD_R)) / (n - 1));
  const yIn = (v: number, s: { lo: number; hi: number }, top: number, h: number) =>
    top + h - ((v - s.lo) / (s.hi - s.lo || 1)) * h;

  // Label roughly 8 dates, always including the newest.
  const labelEvery = Math.max(1, Math.ceil(n / 8));
  const labelIdx = series.map((_, i) => i).filter((i) => i === n - 1 || i % labelEvery === 0);

  const active = hover != null ? series[hover] : [...series].reverse().find((p) => p.dose != null || p.weight != null) ?? null;

  const onMove = (e: ReactMouseEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const vx = ((e.clientX - r.left) / r.width) * CHART_W;
    const i = Math.round(((vx - PAD_L) / (CHART_W - PAD_L - PAD_R)) * (n - 1));
    setHover(Math.min(n - 1, Math.max(0, i)));
  };

  const panel = (
    label: string,
    unit: string,
    color: string,
    values: (number | null)[],
    s: { lo: number; hi: number; ticks: number[] } | null,
    top: number,
    h: number,
    dp: number
  ) => (
    <>
      <rect x={PAD_L} y={top - 19} width={7} height={7} rx={1.5} fill={color} />
      <text x={PAD_L + 12} y={top - 12} fill={rgba(HOME_THEME.text, 0.75)} fontSize={10} fontWeight={800} letterSpacing="0.12em">
        {label}
      </text>
      {s ? (
        <>
          {s.ticks.map((t) => {
            const ty = yIn(t, s, top, h);
            return (
              <g key={t}>
                <line x1={PAD_L} x2={CHART_W - PAD_R} y1={ty} y2={ty} stroke={rgba(HOME_THEME.text, 0.09)} strokeDasharray="3 4" />
                <text x={PAD_L - 8} y={ty + 3} textAnchor="end" fill={rgba(HOME_THEME.text, 0.4)} fontSize={9}>
                  {t.toFixed(dp)}
                </text>
              </g>
            );
          })}
          <GlowLine d={pathFor(values, x, (v) => yIn(v, s, top, h))} color={color} id={glowId} />
          {values.map((v, i) =>
            v == null ? null : (
              <circle key={i} cx={x(i)} cy={yIn(v, s, top, h)} r={hover === i ? 4 : 2.4}
                fill={HOME_THEME.text} stroke={color} strokeWidth={hover === i ? 2 : 1} />
            )
          )}
          {hover != null && values[hover] != null && (
            <text x={x(hover)} y={yIn(values[hover] as number, s, top, h) - 10} textAnchor="middle"
              fill={rgba(HOME_THEME.text, 0.9)} fontSize={10} fontWeight={800}>
              {(values[hover] as number).toFixed(dp)} {unit}
            </text>
          )}
        </>
      ) : (
        <text x={CHART_W / 2} y={top + h / 2} textAnchor="middle" fill={rgba(HOME_THEME.text, 0.3)} fontSize={11}>
          nothing logged yet
        </text>
      )}
    </>
  );

  return (
    <Card variant="classic" padding={16} style={{ flexShrink: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 4 }}>
        <div style={{ ...LABEL, color: person.color, fontSize: 12 }}>Weekly log — {person.label}</div>
        <div style={{ fontSize: 11, color: rgba(HOME_THEME.text, 0.6), fontVariantNumeric: "tabular-nums" }}>
          {active
            ? `${fmtDay(active.date)} · ${active.dose != null ? `${num(active.dose)} mg` : "— mg"}${
                active.units != null ? ` (${num(active.units, 1)}u)` : ""
              } · ${active.weight != null ? `${num(active.weight, 1)} lb` : "— lb"}`
            : "no data yet"}
        </div>
      </div>
      <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} style={{ width: "100%", height: "auto", display: "block" }}
        onMouseLeave={() => setHover(null)}>
        <defs>
          <filter id={glowId} x="-20%" y="-60%" width="140%" height="220%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
        </defs>

        {/* shared vertical guides + date axis */}
        {labelIdx.map((i) => (
          <line key={`v${i}`} x1={x(i)} x2={x(i)} y1={DOSE_TOP} y2={WEIGHT_TOP + WEIGHT_H}
            stroke={rgba(HOME_THEME.text, 0.06)} strokeDasharray="2 6" />
        ))}
        {hover != null && (
          <line x1={x(hover)} x2={x(hover)} y1={DOSE_TOP} y2={WEIGHT_TOP + WEIGHT_H}
            stroke={rgba(person.color, 0.5)} strokeDasharray="3 3" />
        )}

        {panel("DOSE", "mg", person.color, series.map((p) => p.dose), doseScale, DOSE_TOP, DOSE_H, 2)}
        {panel("WEIGHT", "lb", RETA_PALETTE.green, series.map((p) => p.weight), weightScale, WEIGHT_TOP, WEIGHT_H, 1)}

        {labelIdx.map((i) => (
          <text key={`x${i}`} x={x(i)} y={X_LABEL_Y} textAnchor="middle" fill={rgba(HOME_THEME.text, 0.4)} fontSize={9}>
            {fmtDay(series[i].date)}
          </text>
        ))}
        <text x={PAD_L} y={CHART_H - 8} fill={rgba(HOME_THEME.text, 0.35)} fontSize={9}>
          mg per shot (top) and body weight (bottom) — x-axis is the Sunday of each week
        </text>

        {/* hover capture sits above everything, transparent */}
        <rect x={PAD_L - 10} y={DOSE_TOP - 20} width={CHART_W - PAD_L - PAD_R + 20} height={WEIGHT_TOP + WEIGHT_H - DOSE_TOP + 24}
          fill="transparent" onMouseMove={onMove} />
      </svg>
    </Card>
  );
}

/** Free-text week note — commits on blur so typing isn't a write per keystroke. */
function NoteCell({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);
  return (
    <input
      value={draft}
      placeholder="—"
      onFocus={() => setEditing(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setEditing(false);
        if (draft !== value) onCommit(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      style={{ ...homeInputStyle, width: "100%", minWidth: 160, padding: "5px 8px", fontSize: 12 }}
    />
  );
}
