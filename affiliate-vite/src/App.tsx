import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { api, type Affiliate } from "./lib/api";
import { shellStyle } from "./lib/theme";
import Landing from "./pages/Landing";
import Apply from "./pages/Apply";
import Login from "./pages/Login";
import Terms from "./pages/Terms";
import Dashboard from "./pages/Dashboard";
import Creatives from "./pages/Creatives";
import CodePage from "./pages/CodePage";
import Payouts from "./pages/Payouts";

/**
 * affiliate.cbedge.net.
 *
 * PUBLIC FIRST. The landing page is the product for anyone who has not applied,
 * so it is the index route and it never waits on a session lookup to paint —
 * `/api/aff/auth/me` resolves in the background and only the toolbar changes
 * when it lands. An affiliate program whose front page flashes a spinner at a
 * cold visitor has already lost the visitor.
 *
 * ONE SESSION SHAPE. Everything authed reads `useSession()`. `affiliate` is
 * null when signed out and carries `status` when signed in — and status, not
 * the presence of a session, is what decides between the waiting-room view and
 * the real dashboard. A pending applicant IS signed in on purpose: without it
 * they have no way back to check on their application, and "apply again to see
 * where it went" is how duplicate rows get created.
 */

type SessionValue = {
  affiliate: Affiliate | null;
  loading: boolean;
  refresh: () => Promise<void>;
  setAffiliate: (a: Affiliate | null) => void;
  signOut: () => Promise<void>;
};

const SessionCtx = createContext<SessionValue>({
  affiliate: null, loading: true,
  refresh: async () => {}, setAffiliate: () => {}, signOut: async () => {},
});

export const useSession = () => useContext(SessionCtx);

function SessionProvider({ children }: { children: ReactNode }) {
  const [affiliate, setAffiliate] = useState<Affiliate | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const j = await api.me();
      setAffiliate(j.affiliate);
    } catch {
      // 401 is the normal signed-out answer here, not an error worth surfacing.
      setAffiliate(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const signOut = useCallback(async () => {
    try { await api.logout(); } catch { /* clear locally regardless */ }
    setAffiliate(null);
  }, []);

  const value = useMemo(
    () => ({ affiliate, loading, refresh, setAffiliate, signOut }),
    [affiliate, loading, refresh, signOut],
  );
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

/** Gate for every /dashboard route. Sends a signed-out visitor to the login
 *  screen rather than the landing page — they clearly meant to go somewhere. */
function RequireSession({ children }: { children: ReactNode }) {
  const { affiliate, loading } = useSession();
  const navigate = useNavigate();
  useEffect(() => {
    if (!loading && !affiliate) navigate("/login", { replace: true });
  }, [loading, affiliate, navigate]);
  if (loading || !affiliate) return <div style={{ flex: 1 }} />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <SessionProvider>
        <div style={shellStyle}>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/apply" element={<Apply />} />
            <Route path="/login" element={<Login />} />
            {/* Public and unauthenticated on purpose — the apply form asks
                people to accept these, so they have to be readable BEFORE
                anyone has an account. */}
            <Route path="/terms" element={<Terms />} />
            <Route path="/dashboard" element={<RequireSession><Dashboard /></RequireSession>} />
            <Route path="/dashboard/creatives" element={<RequireSession><Creatives /></RequireSession>} />
            <Route path="/dashboard/code" element={<RequireSession><CodePage /></RequireSession>} />
            <Route path="/dashboard/payouts" element={<RequireSession><Payouts /></RequireSession>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </SessionProvider>
    </BrowserRouter>
  );
}
