import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useIsMobile } from "../hooks/useIsMobile";
import { OWNER_THEME as T, ownerRgba, homeHeaderStyle, homePanelStyle, homeShellStyle, homeSecondaryButtonStyle } from "../lib/theme";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * VOLTICK USAGE: who opens which page on voltick.cbedge.net, and how many times
 * they signed in to get there.
 *
 * Brandon, 2026-10-10: "need to track each page visit by who on the
 * voltick.cbedge.net, and how many sign ins. add it to the owner.cbedge.net".
 *
 * Fed by the sandbox's route beacon (voltick-vite/src/lib/visit.ts →
 * POST /api/voltick/visit), read from GET /api/voltick/visits
 * (server-v2/voltick-visits.cjs). Its own table, kept apart from CB Edge's
 * page_visits so the testers never show up as customer traffic.
 *
 *   A VISIT    one page opened in the sandbox, by one signed-in account
 *   A SIGN-IN  one CB Edge login session used on the sandbox. Somebody who signs
 *              in once and comes back every day for a week is one sign-in and
 *              many visits. The time shown is when that session was created
 *              (the login itself), or the first visit if the session is gone.
 *
 * Not counted: /demo/ (served by its own container) and the inside of the
 * framed v3 board, which is a different app; opening /v3-board itself is.
 * ─────────────────────────────────────────────────────────────────────────────
 */

interface Person { userId: string; email: string | null; isOwner: boolean; visits: number; pages: number; signIns: number; daysActive: number; firstAt: number | null; lastAt: number | null; topPath: string | null }
interface SignIn { userId: string; email: string | null; isOwner: boolean; signedInAt: number | null; firstAt: number | null; lastAt: number | null; visits: number; browser: string | null; os: string | null; device: string | null; city: string | null; country: string | null }
interface PageRow { path: string; label: string | null; visits: number; people: number; lastAt: number | null }
interface Visit { id: number; userId: string; email: string | null; isOwner: boolean; path: string; label: string | null; at: number | null; device: string | null; browser: string | null; city: string | null; country: string | null }
interface Payload {
  days: number;
  serverNow: number;
  totals: { visits: number; people: number; signIns: number; pages: number; granted: number };
  people: Person[];
  signIns: SignIn[];
  pages: PageRow[];
  recent: Visit[];
  daily: { day: string; visits: number; people: number; signIns: number }[];
  neverOpened: { email: string; hasAccount: boolean; grantedAt: number | null }[];
}

const RANGES = [
  { key: 1, label: "Today" },
  { key: 7, label: "7d" },
  { key: 30, label: "30d" },
  { key: 90, label: "90d" },
  { key: 0, label: "All" },
] as const;
const REFRESH_MS = 30_000;

// ── formatting ──
const mono: CSSProperties = { fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" };
// Secondary text is the theme's green, not white faded with opacity (AGENTS.md: "Colour, on this surface").
const quiet: CSSProperties = { color: T.green };
const th: CSSProperties = { textAlign: "left", fontWeight: 600, fontSize: 12, ...quiet, padding: "6px 8px", borderBottom: `1px solid ${T.border}`, whiteSpace: "nowrap", position: "sticky", top: 0, background: T.panelBgStrong, zIndex: 1 };
const td: CSSProperties = { padding: "6px 8px", borderBottom: `1px solid ${ownerRgba("#FFFFFF", 0.05)}`, fontSize: 13, verticalAlign: "top" };
const num: CSSProperties = { ...td, ...mono, textAlign: "right", whiteSpace: "nowrap" };

function dur(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d`;
}
const ago = (t: number | null, now: number) => (t == null ? "—" : `${dur((now - t) / 1000)} ago`);
const ET = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const when = (t: number | null) => (t == null ? "—" : ET.format(t));
const who = (email: string | null, id: string) => email || `user ${id.slice(0, 10)}`;
const place = (city: string | null, country: string | null) => [city, country].filter(Boolean).join(", ");
const device = (d: string | null, b: string | null, os: string | null) => [d, b, os].filter(Boolean).join(" · ");

async function getJson<J>(url: string): Promise<J> {
  const r = await fetch(url, { cache: "no-store" });
  const j = (await r.json().catch(() => ({}))) as J & { error?: string };
  if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
  return j;
}

// ── pieces ──
function Card({ title, right, children, span = 1, height }: { title: string; right?: ReactNode; children: ReactNode; span?: number; height?: number }) {
  return (
    <section style={{ ...homePanelStyle, padding: 14, gridColumn: `span ${span}`, minWidth: 0, display: "flex", flexDirection: "column", gap: 10, ...(height ? { height } : {}) }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{title}</span>
        {right}
      </div>
      <div style={{ flex: "1 1 auto", minHeight: 0, overflow: "auto", margin: "0 -4px", padding: "0 4px" }}>{children}</div>
    </section>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ ...homePanelStyle, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
      <span style={{ fontSize: 12, ...quiet }}>{label}</span>
      <span style={{ ...mono, fontSize: 24, fontWeight: 700, color: T.text }}>{value}</span>
      {sub && <span style={{ fontSize: 12, ...quiet }}>{sub}</span>}
    </div>
  );
}

const Empty = ({ children }: { children: ReactNode }) => <div style={{ fontSize: 13, ...quiet, padding: "8px 2px" }}>{children}</div>;

function OwnerTag() {
  return <span style={{ fontSize: 11, marginLeft: 6, padding: "0 6px", borderRadius: 999, border: `1px solid ${T.border}`, color: T.gold }}>you</span>;
}

function Daily({ rows }: { rows: Payload["daily"] }) {
  if (!rows.length) return <Empty>No days yet.</Empty>;
  const maxV = Math.max(1, ...rows.map((r) => r.visits));
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 180, gap: 6 }}>
      <div style={{ flex: "1 1 auto", display: "flex", alignItems: "stretch", gap: 6, overflowX: "auto" }}>
        {rows.map((r) => (
          <div key={r.day} title={`${r.day}: ${r.visits} visits, ${r.people} people, ${r.signIns} sign-ins`} style={{ flex: "1 0 26px", maxWidth: 80, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <span style={{ ...mono, fontSize: 11 }}>{r.visits}</span>
            <div style={{ flex: "1 1 auto", width: "100%", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
              <div style={{ width: "60%", maxWidth: 30, height: `${(r.visits / maxV) * 100}%`, minHeight: 2, background: ownerRgba(T.lightBlue, 0.9), borderRadius: 2 }} />
            </div>
            <span style={{ ...mono, fontSize: 10, ...quiet, whiteSpace: "nowrap" }}>{r.day.slice(5)}</span>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11, ...quiet }}>visits per day (ET) · hover a day for people and sign-ins</div>
    </div>
  );
}

export default function VoltickUsage() {
  const [days, setDays] = useState<number>(30);
  const [hideOwner, setHideOwner] = useState(true);
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [person, setPerson] = useState<string>("");
  const [now, setNow] = useState(() => Date.now());
  const isMobile = useIsMobile();
  const wide = isMobile ? 1 : 2;

  const load = useCallback(async () => {
    try {
      setData(await getJson<Payload>(`/api/voltick/visits?days=${days}`));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, [days]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const t = window.setInterval(() => {
      if (document.hidden) return;
      void load();
      setNow(Date.now());
    }, REFRESH_MS);
    return () => window.clearInterval(t);
  }, [load]);

  const keep = <R extends { isOwner: boolean; userId?: string }>(rows: R[]) =>
    rows.filter((r) => (!hideOwner || !r.isOwner) && (!person || r.userId === person));
  const people = data ? data.people.filter((p) => !hideOwner || !p.isOwner) : [];
  const signIns = data ? keep(data.signIns) : [];
  const recent = data ? keep(data.recent) : [];
  // the tiles follow the switches, so "hide me" really hides me everywhere
  const totals = {
    visits: people.reduce((n, p) => n + p.visits, 0),
    people: people.length,
    signIns: data ? data.signIns.filter((s) => !hideOwner || !s.isOwner).length : 0,
  };

  const seg = (on: boolean): CSSProperties => ({
    padding: "6px 10px", fontSize: 13, fontWeight: 600, border: 0, cursor: "pointer",
    background: on ? ownerRgba("#FFFFFF", 0.1) : "transparent", color: T.text,
  });

  return (
    <div style={homeShellStyle}>
      <div style={{ ...homeHeaderStyle, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 17, fontWeight: 600, color: T.text }}>Voltick Usage</span>
          <a href="https://voltick.cbedge.net" target="_blank" rel="noreferrer" style={{ fontSize: 13, color: T.lightBlue, textDecoration: "none" }}>
            voltick.cbedge.net ↗
          </a>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "inline-flex", border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
            {RANGES.map((r) => (
              <button key={r.key} type="button" style={seg(days === r.key)} onClick={() => setDays(r.key)}>{r.label}</button>
            ))}
          </div>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: T.text, cursor: "pointer" }}>
            <input type="checkbox" checked={hideOwner} onChange={(e) => setHideOwner(e.target.checked)} /> Hide me
          </label>
          <button type="button" onClick={() => void load()} style={{ ...homeSecondaryButtonStyle, padding: "6px 12px", fontSize: 13 }}>↻ Refresh</button>
        </div>
      </div>

      <div style={{ flex: "1 1 auto", minHeight: 0, overflow: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
        {error && <div style={{ ...homePanelStyle, padding: 12, color: T.red, fontSize: 13 }}>Could not load: {error}</div>}

        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, minmax(0,1fr))" : "repeat(5, minmax(0,1fr))", gap: 10 }}>
          <Tile label="Page visits" value={data ? String(totals.visits) : "…"} sub={days ? `last ${days === 1 ? "day" : `${days} days`}` : "all time"} />
          <Tile label="People" value={data ? String(totals.people) : "…"} sub="signed-in accounts" />
          <Tile label="Sign-ins" value={data ? String(totals.signIns) : "…"} sub="login sessions used here" />
          <Tile label="Pages opened" value={data ? String(data.totals.pages) : "…"} sub="distinct pages" />
          <Tile label="Have access" value={data ? String(data.totals.granted) : "…"} sub={data ? `${data.neverOpened.length} never opened it` : ""} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0,1fr))", gap: 14 }}>
          <Card title="People" span={wide} right={person ? <button type="button" onClick={() => setPerson("")} style={{ ...homeSecondaryButtonStyle, padding: "3px 10px", fontSize: 12 }}>Show everyone</button> : <span style={{ fontSize: 12, ...quiet }}>click a row to filter</span>}>
            {!people.length ? <Empty>{data ? "Nobody has opened the sandbox in this range." : "Loading…"}</Empty> : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>
                  <th style={th}>Who</th>
                  <th style={{ ...th, textAlign: "right" }}>Visits</th>
                  <th style={{ ...th, textAlign: "right" }}>Sign-ins</th>
                  <th style={{ ...th, textAlign: "right" }}>Pages</th>
                  <th style={{ ...th, textAlign: "right" }}>Days</th>
                  {!isMobile && <th style={th}>Most opened</th>}
                  <th style={th}>Last seen</th>
                  {!isMobile && <th style={th}>First seen</th>}
                </tr></thead>
                <tbody>
                  {people.map((p) => (
                    <tr key={p.userId} onClick={() => setPerson(person === p.userId ? "" : p.userId)} style={{ cursor: "pointer", background: person === p.userId ? ownerRgba(T.lightBlue, 0.12) : undefined }}>
                      <td style={{ ...td, fontWeight: 600 }}>{who(p.email, p.userId)}{p.isOwner && <OwnerTag />}</td>
                      <td style={num}>{p.visits}</td>
                      <td style={num}>{p.signIns}</td>
                      <td style={num}>{p.pages}</td>
                      <td style={num}>{p.daysActive}</td>
                      {!isMobile && <td style={{ ...td, ...mono, fontSize: 12 }}>{p.topPath ?? "—"}</td>}
                      <td style={{ ...td, whiteSpace: "nowrap" }}>{ago(p.lastAt, now)}</td>
                      {!isMobile && <td style={{ ...td, whiteSpace: "nowrap", ...quiet }}>{when(p.firstAt)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card title="Sign-ins" height={420} right={<span style={{ fontSize: 12, ...quiet }}>one row per login session used here</span>}>
            {!signIns.length ? <Empty>No sign-ins in this range.</Empty> : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>
                  <th style={th}>Who</th>
                  <th style={th}>Signed in</th>
                  <th style={{ ...th, textAlign: "right" }}>Visits</th>
                  <th style={th}>Device · where</th>
                </tr></thead>
                <tbody>
                  {signIns.map((s, i) => (
                    <tr key={`${s.userId}-${s.firstAt}-${i}`}>
                      <td style={{ ...td, fontWeight: 600 }}>{who(s.email, s.userId)}{s.isOwner && <OwnerTag />}</td>
                      <td style={{ ...td, whiteSpace: "nowrap" }} title={s.signedInAt ? "when this login session was created" : "login session gone: time of the first visit"}>
                        {when(s.signedInAt ?? s.firstAt)}{s.signedInAt ? "" : " *"}
                      </td>
                      <td style={num}>{s.visits}</td>
                      <td style={{ ...td, fontSize: 12 }}>{device(s.device, s.browser, s.os) || "—"}<div style={quiet}>{place(s.city, s.country)}</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card title="Pages" height={420} right={hideOwner ? <span style={{ fontSize: 12, ...quiet }}>includes your own visits</span> : undefined}>
            {!data?.pages.length ? <Empty>No pages yet.</Empty> : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>
                  <th style={th}>Page</th>
                  <th style={{ ...th, textAlign: "right" }}>Visits</th>
                  <th style={{ ...th, textAlign: "right" }}>People</th>
                  <th style={th}>Last</th>
                </tr></thead>
                <tbody>
                  {data.pages.map((p) => {
                    const top = Math.max(1, ...data.pages.map((x) => x.visits));
                    return (
                      <tr key={p.path}>
                        <td style={{ ...td, width: "50%" }}>
                          <div style={{ fontWeight: 600 }}>{p.label ?? p.path}</div>
                          <div style={{ ...mono, fontSize: 11, ...quiet }}>{p.path}</div>
                          <div style={{ height: 2, marginTop: 3, borderRadius: 2, background: ownerRgba(T.lightBlue, 0.85), width: `${Math.max(2, (p.visits / top) * 100)}%` }} />
                        </td>
                        <td style={num}>{p.visits}</td>
                        <td style={num}>{p.people}</td>
                        <td style={{ ...td, whiteSpace: "nowrap" }}>{ago(p.lastAt, now)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Card>

          <Card title="Visits per day" height={260} right={hideOwner ? <span style={{ fontSize: 12, ...quiet }}>includes your own visits</span> : undefined}>
            <Daily rows={data?.daily ?? []} />
          </Card>

          <Card title="Invited, never opened it" height={260}>
            {!data?.neverOpened.length ? <Empty>Everyone with access has been in.</Empty> : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr><th style={th}>Email</th><th style={th}>Granted</th><th style={th}>Account</th></tr></thead>
                <tbody>
                  {data.neverOpened.map((g) => (
                    <tr key={g.email}>
                      <td style={{ ...td, fontWeight: 600 }}>{g.email}</td>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>{when(g.grantedAt)}</td>
                      <td style={{ ...td, ...quiet }}>{g.hasAccount ? "has a password" : "never set one"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card title={person ? `Every visit · ${who(people.find((p) => p.userId === person)?.email ?? null, person)}` : "Every visit"} span={wide} height={460}>
            {!recent.length ? <Empty>No visits in this range.</Empty> : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>
                  <th style={th}>When</th>
                  <th style={th}>Who</th>
                  <th style={th}>Page</th>
                  {!isMobile && <th style={th}>Device · where</th>}
                </tr></thead>
                <tbody>
                  {recent.map((v) => (
                    <tr key={v.id}>
                      <td style={{ ...td, whiteSpace: "nowrap" }} title={when(v.at)}>{ago(v.at, now)}</td>
                      <td style={{ ...td, fontWeight: 600 }}>{who(v.email, v.userId)}{v.isOwner && <OwnerTag />}</td>
                      <td style={td}>{v.label ?? v.path}<span style={{ ...mono, fontSize: 11, marginLeft: 6, ...quiet }}>{v.path}</span></td>
                      {!isMobile && <td style={{ ...td, fontSize: 12 }}>{device(v.device, v.browser, null) || "—"}<span style={{ marginLeft: 6, ...quiet }}>{place(v.city, v.country)}</span></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>

        <div style={{ fontSize: 12, ...quiet, lineHeight: 1.5 }}>
          A visit is one page opened on voltick.cbedge.net by a signed-in account. A sign-in is one CB Edge login session
          used here: sign in once and come back all week, and that is one sign-in. * means the login session has since
          ended, so the time shown is the first visit. Not counted: /demo/ and pages inside the framed v3 board.
        </div>
      </div>
    </div>
  );
}
