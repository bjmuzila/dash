import { Link, useLocation } from "react-router-dom";
import { MONO, PAPER, PAPER_QUIET } from "../theme";
import { Card, PageShell } from "../components/PageCard";

export default function NotFound() {
  const { pathname } = useLocation();
  return (
    <PageShell title="No such page" maxWidth={640}>
      <Card>
        <p style={{ margin: 0, fontSize: 14, color: PAPER_QUIET }}>
          Nothing is routed at <span style={{ fontFamily: MONO, color: PAPER }}>{pathname}</span>. Every page
          on this site is listed on the contents board.
        </p>
        <div style={{ marginTop: 16 }}>
          <Link to="/" className="vk-pill" style={{ textDecoration: "none" }}>
            Back to contents
          </Link>
        </div>
      </Card>
    </PageShell>
  );
}
