import { card, labelCap, T } from '../theme'

/**
 * Today — the default screen. Phase 1 step 4 fills these in:
 *   Top 3 (starred tasks) · Google Calendar block · open tasks by due date ·
 *   Slipping / Resurfacing rail · money strip (balances + next bills).
 *
 * Rendered as labelled empty cards on purpose rather than being left out, so
 * the deployed shell shows the real layout while the data routes are built.
 */
export default function Today() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Placeholder title="Top 3" note="Starred tasks for today." />
      <Placeholder title="Calendar" note="Today's Google Calendar events." />
      <Placeholder title="Open tasks" note="Everything else, by due date." />
      <Placeholder title="Slipping" note="Untouched for more than 7 days." />
      <Placeholder title="Money" note="Balances and the next bills due." />
    </div>
  )
}

function Placeholder({ title, note }: { title: string; note: string }) {
  return (
    <section style={card()}>
      <div style={labelCap()}>{title}</div>
      <div style={{ fontSize: 14, color: T.muted, marginTop: 8, lineHeight: 1.45 }}>{note}</div>
      <div style={{ fontSize: 12, color: T.muted, opacity: 0.55, marginTop: 10 }}>Not wired up yet.</div>
    </section>
  )
}
