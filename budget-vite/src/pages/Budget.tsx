import { card, labelCap, T } from '../theme'

/**
 * Budget — phase 1 step 6 brings this over.
 *
 * Reads the SAME budget tables the existing /owner/budget page uses, scoped by
 * the signed-in user's budget_profile_key (default 'owner', which is the single
 * existing profile — so both accounts see the current register with no
 * migration). /owner/budget on cbedge.net stays live and untouched throughout.
 */
export default function Budget() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <section style={card()}>
        <div style={labelCap()}>Budget</div>
        <div style={{ fontSize: 14, color: T.muted, marginTop: 8, lineHeight: 1.5 }}>
          Balances, the register, bills due and category spend land here — reading the same
          data as the desktop budget page.
        </div>
        <div style={{ fontSize: 12, color: T.muted, opacity: 0.55, marginTop: 10 }}>Not wired up yet.</div>
      </section>
    </div>
  )
}
