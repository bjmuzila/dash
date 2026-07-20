import { ImageResponse } from "next/og";
import { readFileSync } from "fs";
import { join } from "path";

// Real chrome CB Edge logo, inlined so it bakes into the generated PNG.
const cbLogoDataUri = `data:image/png;base64,${readFileSync(
  join(process.cwd(), "public", "cb-edge-logo.png")
).toString("base64")}`;

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
            "radial-gradient(circle at 76% 40%, rgba(41,182,246,0.08), transparent 55%)",
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
              <img src={cbLogoDataUri} width={392} height={214} alt="CB Edge" style={{ marginLeft: -60, marginTop: -54, marginBottom: -50 }} />
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                marginTop: 0,
                color: "#FFFFFF",
                fontSize: 50,
                fontWeight: 800,
                lineHeight: 1.1,
                letterSpacing: -1,
              }}
            >
              <span>REAL-TIME SPX GEX</span>
              <span>&amp; ORDERFLOW</span>
            </div>

            <div
              style={{
                display: "flex",
                marginTop: 12,
                color: "#8b94a7",
                fontSize: 21,
                lineHeight: 1.35,
              }}
            >
              <span>Everything you need to trade the tape&nbsp;</span>
              <span style={{ color: "#c7ccd1", fontWeight: 700 }}>live.</span>
            </div>

            {/* feature chips — what CB Edge offers */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                width: 470,
                marginTop: 22,
                gap: 10,
              }}
            >
              {[
                { t: "Real-Time SPX GEX", c: "#4FC3F7" },
                { t: "Options Orderflow", c: "#22e3a0" },
                { t: "TPO · Squeeze Scanner", c: "#E0A82E" },
                { t: "ICT Alerts", c: "#c084fc" },
              ].map((f) => (
                <div
                  key={f.t}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    width: 218,
                    padding: "9px 14px",
                    borderRadius: 10,
                    background: "rgba(41,182,246,0.10)",
                    border: "1px solid rgba(41,182,246,0.28)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      width: 9,
                      height: 9,
                      borderRadius: 5,
                      marginRight: 10,
                      background: f.c,
                    }}
                  />
                  <span style={{ color: "#dbe9f2", fontSize: 16, fontWeight: 700 }}>
                    {f.t}
                  </span>
                </div>
              ))}
            </div>

            {/* CTA pill */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                alignSelf: "flex-start",
                marginTop: 22,
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

          {/* RIGHT: real dashboard Card (homeTheme surface: frosted fill, hairline
              edge, faint light-blue top glow, soft shadow) */}
          <div
            style={{
              display: "flex",
              flex: 1,
              flexDirection: "column",
              alignItems: "flex-end",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                width: 452,
                padding: 16,
                borderRadius: 18,
                border: "1px solid rgba(255,255,255,0.10)",
                background:
                  "radial-gradient(circle at 50% 0%, rgba(126,211,252,0.10) 0%, transparent 60%), rgba(13,17,25,0.72)",
                boxShadow: "0 18px 40px rgba(0,0,0,0.22)",
              }}
            >
              {/* card header — dashboard title + LIVE badge */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingBottom: 12,
                  marginBottom: 12,
                  borderBottom: "1px solid rgba(255,255,255,0.10)",
                }}
              >
                <span
                  style={{
                    color: "#FFFFFF",
                    fontSize: 14,
                    fontWeight: 800,
                    letterSpacing: 1.6,
                  }}
                >
                  SPX · 0DTE GEX
                </span>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    padding: "5px 11px",
                    borderRadius: 999,
                    background: "rgba(31,217,138,0.10)",
                    border: "1px solid rgba(31,217,138,0.35)",
                  }}
                >
                  <div style={{ display: "flex", width: 7, height: 7, borderRadius: 4, marginRight: 7, background: "#1FD98A" }} />
                  <span style={{ color: "#1FD98A", fontSize: 12, fontWeight: 800, letterSpacing: 1 }}>LIVE</span>
                </div>
              </div>

              {/* toolbar pill row */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                {[
                  { t: "Net GEX", on: true },
                  { t: "Call−Put", on: false },
                  { t: "OI+Vol", on: true },
                  { t: "Flip", on: false },
                ].map((p, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      padding: "6px 13px",
                      borderRadius: 8,
                      fontSize: 13,
                      fontWeight: 700,
                      background: p.on ? "rgba(33,158,188,0.14)" : "rgba(255,255,255,0.03)",
                      border: p.on
                        ? "1px solid rgba(33,158,188,0.45)"
                        : "1px solid rgba(255,255,255,0.08)",
                      color: p.on ? "#7dd3fc" : "#aeb4be",
                    }}
                  >
                    {p.t}
                  </div>
                ))}
                <div style={{ display: "flex", flex: 1 }} />
                <div
                  style={{
                    display: "flex",
                    padding: "6px 11px",
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 700,
                    background: "rgba(33,158,188,0.14)",
                    border: "1px solid rgba(33,158,188,0.45)",
                    color: "#7dd3fc",
                  }}
                >
                  ↻ Now
                </div>
              </div>

              {/* chart */}
              <div style={{ display: "flex", position: "relative", borderRadius: 10, overflow: "hidden" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={chartDataUri} width={420} height={246} alt="" />
                {/* MVC tag */}
                <div
                  style={{
                    display: "flex",
                    position: "absolute",
                    left: 76,
                    bottom: 25,
                    padding: "3px 7px",
                    borderRadius: 4,
                    fontSize: 11,
                    fontWeight: 700,
                    background: "#1a1405",
                    border: "1px solid rgba(224,168,46,0.7)",
                    color: "#E0A82E",
                  }}
                >
                  MVC 7,300
                </div>
              </div>

              {/* stat tiles */}
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                {[
                  { k: "NET GEX", v: "-$8.40B", c: "#f4948e" },
                  { k: "CALL WALL", v: "7,400", c: "#7dd3fc" },
                  { k: "PUT WALL", v: "7,300", c: "#E0A82E" },
                  { k: "FLIP", v: "7,359.90", c: "#f0a83c" },
                ].map((s) => (
                  <div
                    key={s.k}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      flex: 1,
                      padding: "9px 11px",
                      borderRadius: 12,
                      background:
                        "radial-gradient(circle at 50% 0%, rgba(126,211,252,0.10) 0%, transparent 60%), rgba(13,17,25,0.35)",
                    }}
                  >
                    <span style={{ color: "#8b94a7", fontSize: 10, fontWeight: 700, letterSpacing: 0.6 }}>
                      {s.k}
                    </span>
                    <span style={{ color: s.c, fontSize: 16, fontWeight: 800, marginTop: 3 }}>
                      {s.v}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
