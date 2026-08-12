import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth'
import { auth as authApi, recipes as api } from '../api'
import PinPad from '../components/PinPad'
import { T, label, display, body, section, button, input } from '../theme'

/**
 * More — the account bits and the one link that matters.
 *
 * Deliberately thin. Everything about the household (people, timezone, the
 * budget, the week board) is configured in the household app; duplicating any
 * of it here would give two screens that disagree. This one covers the things
 * that are genuinely per-app or per-device: who you're signed in as, the PIN on
 * THIS browser, and a way back to the list you just sent ingredients to.
 */
export default function Settings() {
  const { user, signOut } = useAuth()
  const qc = useQueryClient()

  const { data: cookbook } = useQuery({ queryKey: ['recipes', '', 'all', false], queryFn: () => api.list() })
  const { data: pin } = useQuery({ queryKey: ['pin'], queryFn: () => authApi.pinInfo() })

  const [settingPin, setSettingPin] = useState(false)
  const [entry, setEntry] = useState('')
  const [pinError, setPinError] = useState<string | null>(null)

  const savePin = useMutation({
    mutationFn: (p: string) => authApi.setPin(p),
    onSuccess: () => {
      setSettingPin(false); setEntry(''); setPinError(null)
      qc.invalidateQueries({ queryKey: ['pin'] })
    },
    onError: (e: Error) => { setPinError(e.message); setEntry('') },
  })

  const removePin = useMutation({
    mutationFn: (all: boolean) => authApi.removePin(all),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pin'] }),
  })

  const [pw, setPw] = useState({ current: '', next: '' })
  const [pwNote, setPwNote] = useState<string | null>(null)
  const changePw = useMutation({
    mutationFn: () => authApi.changePassword(pw.current, pw.next),
    onSuccess: () => { setPw({ current: '', next: '' }); setPwNote('Password changed.') },
    onError: (e: Error) => setPwNote(e.message),
  })

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={section()}>
        <div style={label()}>Signed in</div>
        <h2 style={{ ...display(22), marginTop: 6 }}>{user?.displayName}</h2>
        <p style={{ ...body(13), marginTop: 4, color: T.muted }}>{user?.email}</p>
        {cookbook && (
          <p style={{ ...body(14), marginTop: 12 }}>
            {cookbook.total} {cookbook.total === 1 ? 'recipe' : 'recipes'} in the cookbook.
          </p>
        )}
      </div>

      <div style={section()}>
        <div style={label()}>Where the shopping goes</div>
        <p style={{ ...body(14), marginTop: 8 }}>
          “Add all” writes straight into the household grocery list — same list,
          same aisles, no sync. Open it to check things off while you shop.
        </p>
        <p style={{ ...body(13), marginTop: 8, color: T.faint }}>
          The Week tab reads the same board, so a meal planned on either side
          shows up on both.
        </p>
        <a
          href="https://budget.cbedge.net/lists"
          style={{ ...button('ghost'), display: 'inline-flex', alignItems: 'center',
                   textDecoration: 'none', marginTop: 12 }}
        >
          Open the grocery list ↗
        </a>
      </div>

      {/* ── Quick sign-in ─────────────────────────────────────────────────── */}
      <div style={section()}>
        <div style={label()}>Quick sign-in</div>
        {settingPin ? (
          <>
            <p style={{ ...body(14), marginTop: 8 }}>Pick a 4-digit PIN for this browser.</p>
            {pinError && <p style={{ ...body(13), marginTop: 8, color: T.bad }}>{pinError}</p>}
            <div style={{ marginTop: 12 }}>
              <PinPad
                value={entry}
                onChange={(v) => {
                  setEntry(v)
                  if (v.length === 4) savePin.mutate(v)
                }}
                disabled={savePin.isPending}
              />
            </div>
            <button onClick={() => { setSettingPin(false); setEntry(''); setPinError(null) }}
                    style={{ ...button('ghost'), width: '100%', marginTop: 12 }}>
              Cancel
            </button>
          </>
        ) : pin?.hasPinOnThisDevice ? (
          <>
            <p style={{ ...body(14), marginTop: 8 }}>
              This browser is armed. {pin.devices > 1 ? `${pin.devices} devices total.` : ''}
            </p>
            <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
              <button onClick={() => removePin.mutate(false)} style={button('ghost')}>Forget this device</button>
              {pin.devices > 1 && (
                <button onClick={() => removePin.mutate(true)} style={button('ghost')}>Forget all devices</button>
              )}
            </div>
          </>
        ) : (
          <>
            <p style={{ ...body(14), marginTop: 8 }}>
              Set a PIN and this browser signs in with four taps instead of a password.
            </p>
            <button onClick={() => setSettingPin(true)} style={{ ...button('primary'), marginTop: 12 }}>
              Set a PIN
            </button>
          </>
        )}
      </div>

      <div style={section()}>
        <div style={label()}>Password</div>
        <input style={{ ...input(), marginTop: 10 }} type="password" autoComplete="current-password"
               placeholder="Current password" value={pw.current}
               onChange={(e) => setPw({ ...pw, current: e.target.value })} />
        <input style={{ ...input(), marginTop: 8 }} type="password" autoComplete="new-password"
               placeholder="New password" value={pw.next}
               onChange={(e) => setPw({ ...pw, next: e.target.value })} />
        {pwNote && <p style={{ ...body(13), marginTop: 8, color: T.muted }}>{pwNote}</p>}
        <button
          onClick={() => changePw.mutate()}
          disabled={!pw.current || !pw.next || changePw.isPending}
          style={{ ...button('ghost'), width: '100%', marginTop: 10,
                   opacity: pw.current && pw.next ? 1 : 0.5 }}
        >
          {changePw.isPending ? 'Changing…' : 'Change password'}
        </button>
      </div>

      {/* Signing out deliberately leaves the device PIN alone — forgetting the
          device is the separate, explicit choice above. */}
      <button onClick={() => void signOut()} style={{ ...button('ghost'), color: T.bad }}>
        Sign out
      </button>
    </div>
  )
}
