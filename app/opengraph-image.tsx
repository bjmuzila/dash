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
<svg width="516" height="398" viewBox="0 0 516 398" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="posBar" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#4FC3F7"/><stop offset="1" stop-color="#1976A8"/>
    </linearGradient>
    <linearGradient id="negBar" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#E0A82E"/><stop offset="1" stop-color="#B8860B"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="516" height="398" rx="16" fill="#0a0d13" stroke="#ffffff" stroke-opacity="0.10"/>
  <path d="M0 16 a16 16 0 0 1 16 -16 h484 a16 16 0 0 1 16 16 v24 h-516 z" fill="#0d1119"/>
  <circle cx="22" cy="20" r="6" fill="#ff5b6e"/><circle cx="42" cy="20" r="6" fill="#f0a83c"/><circle cx="62" cy="20" r="6" fill="#22e3a0"/>
  <g font-family="Inter" font-size="11" font-weight="700">
    <rect x="16" y="50" width="64" height="22" rx="7" fill="#13202b" stroke="#29B6F6" stroke-opacity="0.5"/><text x="48" y="65" text-anchor="middle" fill="#4FC3F7">Net GEX</text>
    <rect x="88" y="50" width="60" height="22" rx="7" fill="#11161f" stroke="#ffffff" stroke-opacity="0.08"/><text x="118" y="65" text-anchor="middle" fill="#8b94a7">Call-Put</text>
    <rect x="156" y="50" width="56" height="22" rx="7" fill="#13202b" stroke="#29B6F6" stroke-opacity="0.5"/><text x="184" y="65" text-anchor="middle" fill="#4FC3F7">OI+Vol</text>
    <rect x="220" y="50" width="40" height="22" rx="7" fill="#11161f" stroke="#ffffff" stroke-opacity="0.08"/><text x="240" y="65" text-anchor="middle" fill="#8b94a7">Flip</text>
    <rect x="268" y="50" width="34" height="22" rx="7" fill="#11161f" stroke="#ffffff" stroke-opacity="0.08"/><text x="285" y="65" text-anchor="middle" fill="#8b94a7">5m</text>
  </g>
  <g transform="translate(0,84)">
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
          <div style={{ display: "flex", flexDirection: "column", width: 540 }}>
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
                fontSize: 25,
                lineHeight: 1.35,
              }}
            >
              <span>Track gamma exposure, options flow, and</span>
              <span>
                key levels{" "}
                <span style={{ color: "#c7ccd1", fontWeight: 700 }}>
                  live, every session.
                </span>
              </span>
            </div>
          </div>

          {/* RIGHT: dashboard mock */}
          <div
            style={{
              display: "flex",
              flex: 1,
              alignItems: "center",
              justifyContent: "flex-end",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={chartDataUri} width={516} height={398} alt="" />
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
