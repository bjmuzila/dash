import { Page } from '@/design/primitives/Page'
import { Card } from '@/design/primitives/Card'

// Intentionally blank. This is where you start designing.
//
// The plumbing underneath is already live: the socket is open, the store is
// receiving, the cache is seeded. Drop a useField() call into a Stat and it
// will tick.

export default function Home() {
  return (
    <Page title="Home">
      <Card title="Blank slate">
        <p className="text-sm text-muted">
          Nothing is designed yet — that is the point. The data layer, socket, cache and perf
          budgets are all wired. Start here.
        </p>
      </Card>
    </Page>
  )
}
