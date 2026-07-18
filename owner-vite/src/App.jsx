import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import OwnerShell from './OwnerShell.tsx'
import { OWNER_ROUTES } from './lib/nav.ts'
import { PAGES } from './pages/registry.ts'
import NotFound from './pages/NotFound.tsx'

// owner-vite — standalone Vite recreation of the /owner backend section.
// One router, one persistent shell (OwnerShell), a page per sidebar route.
// Served at the root of owner.cbedge.net → BrowserRouter basename is "/".
export default function App() {
  return (
    <BrowserRouter basename="/">
      <Routes>
        <Route element={<OwnerShell />}>
          <Route index element={<Navigate to="/owner" replace />} />
          {OWNER_ROUTES.map((r) => {
            const Comp = PAGES[r.key] || NotFound
            return <Route key={r.path} path={r.path} element={<Comp />} />
          })}
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
