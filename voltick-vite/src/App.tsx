import { Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import Shell from "./components/Shell";
import Home from "./pages/Home";
import NotFound from "./pages/NotFound";
import Placeholder from "./pages/Placeholder";
import { PAGES } from "./pages/registry";
import { VOLTICK_ROUTES } from "./lib/nav";
import { MONO, PAPER_QUIET } from "./theme";

/**
 * voltick.cbedge.net — the merger sandbox.
 *
 * There is no sign-in gate in this app on purpose. Access is Cloudflare Access
 * in FRONT of the container (one-time-PIN policy on an email allowlist), the
 * same way demo.cbedge.net is gated: revoking an email is a change in the
 * Cloudflare dashboard and nothing here rebuilds. If a gate ever moves into the
 * app, it fails CLOSED, the way owner-vite's AuthGate does.
 *
 * One router, one persistent shell, one route per contents entry. The routes are
 * generated from lib/nav.ts, so a link on the board and the route that answers
 * it cannot drift apart.
 */
export default function App() {
  return (
    <BrowserRouter basename="/">
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route element={<Shell />}>
            <Route index element={<Home />} />
            {VOLTICK_ROUTES.map((r) => {
              const Comp = PAGES[r.key] || Placeholder;
              return <Route key={r.path} path={r.path} element={<Comp />} />;
            })}
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

function Loading() {
  return (
    <div
      style={{
        minHeight: "60vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: MONO,
        fontSize: 11,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color: PAPER_QUIET,
      }}
    >
      Loading
    </div>
  );
}
