/**
 * What a listed but unwritten page renders. Deliberately not a 404: the link is
 * correct and the route is correct, the page simply has not been built yet, and
 * saying so is more useful than pretending the URL is wrong.
 */
import { Link, useLocation } from "react-router-dom";
import { ACCENT, LINE, MONO, PAPER, PAPER_QUIET, R_MD, rgba } from "../theme";
import { Card, PageShell } from "../components/PageCard";
import { findRoute } from "../lib/nav";

export default function Placeholder() {
  const { pathname } = useLocation();
  const route = findRoute(pathname);

  return (
    <PageShell title={route?.label ?? "Planned"} lede={route?.note} maxWidth={760}>
      <Card title="Not built yet" subtitle="The link and the route are correct. The page is next.">
        <p style={{ margin: 0, color: PAPER_QUIET, fontSize: 14 }}>
          To build it: add a component at{" "}
          <span style={{ fontFamily: MONO, color: PAPER }}>
            src/pages/{route?.key ?? "Name"}.tsx
          </span>{" "}
          and point this key at it in{" "}
          <span style={{ fontFamily: MONO, color: PAPER }}>src/pages/registry.ts</span>. Nothing else needs
          touching: the route already exists, because it is generated from the same list the contents board
          renders.
        </p>
        <div
          style={{
            marginTop: 14,
            padding: "10px 13px",
            borderRadius: R_MD,
            border: `1px solid ${LINE}`,
            background: rgba(ACCENT, 0.06),
            fontFamily: MONO,
            fontSize: 12,
            color: PAPER,
          }}
        >
          {route?.key ?? "Name"}: lazy(() =&gt; import("./{route?.key ?? "Name"}")),
        </div>
        <div style={{ marginTop: 18 }}>
          <Link to="/" className="vk-pill" style={{ textDecoration: "none" }}>
            Back to contents
          </Link>
        </div>
      </Card>
    </PageShell>
  );
}
