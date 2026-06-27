import { ImageResponse } from "next/og";

export const runtime = "nodejs";
// Render on-demand, not at build time — avoids the Google Fonts fetch running
// inside `docker build` where outbound network may be unavailable.
export const dynamic = "force-dynamic";
export const alt = "CB Edge Dashboard — Real-time SPX GEX & Orderflow";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Real-dashboard GEX histogram rendered as a single inline SVG (Satori-supported).
const chartSvg = `
<svg width="512" height="300" viewBox="0 0 512 300" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="posBar" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#4FC3F7"/><stop offset="1" stop-color="#1976A8"/>
    </linearGradient>
    <linearGradient id="negBar" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#E0A82E"/><stop offset="1" stop-color="#B8860B"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="512" height="300" fill="#0a0d13"/>
  <g transform="translate(0,30)">
    <line x1="14" y1="118" x2="502" y2="118" stroke="#ffffff" stroke-opacity="0.10"/>
    <line x1="238" y1="6" x2="238" y2="230" stroke="#9aa0a6" stroke-width="1" stroke-dasharray="3 3" opacity="0.7"/>
    <text x="238" y="2" text-anchor="middle" fill="#9aa0a6" font-family="Inter" font-size="9">SPX 7,354</text>
    <g fill="url(#negBar)">
      <rect x="20" y="118" width="9" height="44"/><rect x="32" y="118" width="9" height="70"/><rect x="44" y="118" width="9" height="38"/>
      <rect x="56" y="118" width="9" height="58"/><rect x="68" y="118" width="9" height="48"/><rect x="80" y="118" width="9" height="66"/>
      <rect x="92" y="118" width="9" height="40"/><rect x="104" y="118" width="9" height="54"/>
      <rect x="116" y="118" width="9" height="92"/>
      <rect x="128" y="118" width="9" height="50"/><rect x="140" y="118" width="9" height="60"/><rect x="152" y="118" width="9" height="44"/>
      <rect x="164" y="118" width="9" height="74"/><rect x="176" y="118" width="9" height="52"/><rect x="188" y="118" width="9" height="46"/>
      <rect x="200" y="118" width="9" height="58"/><rect x="212" y="118" width="9" height="40"/><rect x="224" y="118" width="9" height="34"/>
    </g>
    <g fill="url(#posBar)">
      <rect x="236" y="110" width="9" height="8"/><rect x="248" y="106" width="9" height="12"/><rect x="260" y="100" width="9" height="18"/>
      <rect x="272" y="84" width="9" height="34"/><rect x="284" y="90" width="9" height="28"/>
      <rect x="296" y="48" width="9" height="70"/>
      <rect x="308" y="78" width="9" height="40"/><rect x="320" y="70" width="9" height="48"/><rect x="332" y="66" width="9" height="52"/>
      <rect x="344" y="62" width="9" height="56"/><rect x="356" y="80" width="9" height="38"/>
      <rect x="368" y="56" width="9" height="62"/>
      <rect x="380" y="84" width="9" height="34"/><rect x="392" y="92" width="9" height="26"/><rect x="404" y="96" width="9" height="22"/>
      <rect x="416" y="88" width="9" height="30"/><rect x="428" y="100" width="9" height="18"/><rect x="440" y="104" width="9" height="14"/>
      <rect x="452" y="108" width="9" height="10"/><rect x="464" y="110" width="9" height="8"/><rect x="476" y="112" width="9" height="6"/>
    </g>
    <rect x="104" y="216" width="34" height="14" rx="3" fill="#1a1405" stroke="#E0A82E" stroke-opacity="0.7"/>
    <text x="121" y="226" text-anchor="middle" fill="#E0A82E" font-family="Inter" font-size="8" font-weight="700">MVC 7,300</text>
  </g>
  <g transform="translate(0,344)" font-family="Inter">
    <rect x="0" y="0" width="516" height="54" fill="#0d1119"/>
    <line x1="0" y1="0" x2="516" y2="0" stroke="#ffffff" stroke-opacity="0.08"/>
    <g font-size="10" font-weight="700">
      <text x="20" y="22" fill="#8b94a7">NET GEX</text><text x="20" y="42" fill="#ff5b6e" font-size="15" font-weight="800">-$8.40B</text>
      <text x="150" y="22" fill="#8b94a7">CALL WALL</text><text x="150" y="42" fill="#4FC3F7" font-size="15" font-weight="800">7,400</text>
      <text x="280" y="22" fill="#8b94a7">PUT WALL</text><text x="280" y="42" fill="#E0A82E" font-size="15" font-weight="800">7,300</text>
      <text x="400" y="22" fill="#8b94a7">FLIP</text><text x="400" y="42" fill="#f0a83c" font-size="15" font-weight="800">7,359.90</text>
    </g>
  </g>
</svg>`;

const chartDataUri = `data:image/svg+xml;base64,${Buffer.from(chartSvg).toString("base64")}`;

// Small logo mark as inline SVG data URI.
const logoSvg = `
<svg width="56" height="56" viewBox="0 0 56 56" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="lb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8ECae6"/><stop offset="1" stop-color="#219EBC"/></linearGradient></defs>
  <rect width="56" height="56" rx="14" fill="url(#lb)"/>
  <path d="M14 40 L24 28 L31 34 L42 18" fill="none" stroke="#05060A" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M36 18 H42 V24" fill="none" stroke="#05060A" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
const logoDataUri = `data:image/svg+xml;base64,${Buffer.from(logoSvg).toString("base64")}`;

export default function OpengraphImage() {

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          padding: 56,
          backgroundColor: "#05060A",
          backgroundImage:
            "radial-gradient(circle at 76% 40%, rgba(41,182,246,0.15), transparent 55%)",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            flex: 1,
            border: "1px solid rgba(255,255,255,0.07)",
            borderRadius: 24,
            padding: 40,
          }}
        >
          {/* LEFT: brand + copy */}
          <div style={{ display: "flex", flexDirection: "column", width: 500 }}>
            <div style={{ display: "flex", alignItems: "center" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logoDataUri} width={56} height={56} alt="" />
              <div
                style={{
                  marginLeft: 18,
                  color: "#FFFFFF",
                  fontSize: 34,
                  fontWeight: 800,
                  letterSpacing: -0.5,
                }}
              >
                CB Edge
              </div>
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                marginTop: 56,
                color: "#FFFFFF",
                fontSize: 62,
                fontWeight: 800,
                lineHeight: 1.08,
                letterSpacing: -1,
              }}
            >
              <span>REAL-TIME</span>
              <span>SPX GEX &amp;</span>
              <span>ORDERFLOW</span>
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                marginTop: 34,
                color: "#8b94a7",
                fontSize: 23,
                lineHeight: 1.4,
              }}
            >
              <span>Track gamma exposure, options</span>
              <span style={{ display: "flex" }}>
                flow, and key levels&nbsp;
                <span style={{ color: "#c7ccd1", fontWeight: 700 }}>
                  live.
                </span>
              </span>
            </div>

            {/* CTA pill */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                alignSelf: "flex-start",
                marginTop: 34,
                padding: "14px 28px",
                borderRadius: 12,
                background: "#219EBC",
                color: "#04121A",
                fontSize: 22,
                fontWeight: 800,
                letterSpacing: 0.5,
              }}
            >
              SIGN UP NOW →
            </div>
          </div>

          {/* RIGHT: dashboard mock + real-text stat bar */}
          <div
            style={{
              display: "flex",
              flex: 1,
              flexDirection: "column",
              alignItems: "flex-end",
              justifyContent: "center",
            }}
          >
            {/* chart panel: titlebar dots + real-DOM toolbar pills + chart img */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                width: 516,
                background: "#0d1119",
                borderRadius: "16px 16px 0 0",
                border: "2px solid rgba(41,182,246,0.45)",
                borderBottom: "none",
                overflow: "hidden",
              }}
            >
              {/* titlebar */}
              <div style={{ display: "flex", alignItems: "center", padding: "12px 16px", gap: 8 }}>
                <div style={{ display: "flex", width: 11, height: 11, borderRadius: 6, background: "#ff5b6e" }} />
                <div style={{ display: "flex", width: 11, height: 11, borderRadius: 6, background: "#f0a83c" }} />
                <div style={{ display: "flex", width: 11, height: 11, borderRadius: 6, background: "#22e3a0" }} />
              </div>

              {/* toolbar pill row — matches the real GexToolbar */}
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 14px 12px" }}>
                {[
                  { t: "Mon 6/29", on: true },
                  { t: "Tue 6/30", on: false },
                  { gap: true },
                  { t: "Net GEX", on: true },
                  { t: "Call−Put", on: false },
                  { gap: true },
                  { t: "OI+Vol", on: true },
                  { t: "Vol Only", on: false },
                  { gap: true },
                  { t: "OI", dot: true },
                  { t: "DEX", dot: true },
                  { t: "Flip", dot: true },
                  { gap: true },
                  { t: "5m", dot: true },
                  { t: "15m", dot: true },
                  { t: "30m", dot: true },
                  { gap: true },
                  { t: "↻ Now", now: true },
                ].map((p, i) =>
                  p.gap ? (
                    <div key={i} style={{ display: "flex", width: 1, height: 20, background: "rgba(255,255,255,0.10)", margin: "0 3px" }} />
                  ) : (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                        padding: "5px 9px",
                        borderRadius: 7,
                        fontSize: 11,
                        fontWeight: 700,
                        background: p.on ? "rgba(41,182,246,0.16)" : "rgba(255,255,255,0.03)",
                        border: p.on
                          ? "1px solid rgba(41,182,246,0.55)"
                          : "1px solid rgba(255,255,255,0.08)",
                        color: p.on || p.now ? "#4FC3F7" : "#c2c8d2",
                      }}
                    >
                      {p.dot && (
                        <div style={{ display: "flex", width: 6, height: 6, borderRadius: 4, background: "#5a6270" }} />
                      )}
                      {p.t}
                    </div>
                  )
                )}
              </div>

              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={chartDataUri} width={512} height={300} alt="" />
            </div>

            {/* stat bar — real DOM text so the built-in font renders it */}
            <div
              style={{
                display: "flex",
                width: 516,
                marginTop: -2,
                padding: "12px 18px",
                background: "#0d1119",
                borderRadius: "0 0 16px 16px",
                border: "2px solid rgba(41,182,246,0.45)",
                borderTop: "none",
              }}
            >
              {[
                { k: "NET GEX", v: "-$8.40B", c: "#ff5b6e" },
                { k: "CALL WALL", v: "7,400", c: "#4FC3F7" },
                { k: "PUT WALL", v: "7,300", c: "#E0A82E" },
                { k: "FLIP", v: "7,359.90", c: "#f0a83c" },
              ].map((s) => (
                <div
                  key={s.k}
                  style={{ display: "flex", flexDirection: "column", flex: 1 }}
                >
                  <span style={{ color: "#8b94a7", fontSize: 11, fontWeight: 700 }}>
                    {s.k}
                  </span>
                  <span style={{ color: s.c, fontSize: 18, fontWeight: 800, marginTop: 3 }}>
                    {s.v}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
