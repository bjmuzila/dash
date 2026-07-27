import { Routes, Route, Navigate } from 'react-router-dom'
import { TickerProvider } from './TickerContext'
import TopToolbar from './components/TopToolbar'
import PageView from './pages/PageView'
import { PAGES } from './pages/registry'

export default function App() {
  return (
    <TickerProvider>
      <TopToolbar />
      <Routes>
        {PAGES.map((p) => (
          <Route key={p.path} path={p.path} element={<PageView />} />
        ))}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </TickerProvider>
  )
}
