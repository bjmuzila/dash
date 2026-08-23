import { PublicFrame, TopBar, PublicFooter } from './Pricing'
import { T, display, label, body, section, SANS } from '../theme'

/**
 * Terms and Privacy, as real routes rather than as two dead links in the footer.
 *
 * They are SPA routes and not files on the origin for one practical reason: the
 * nginx in front of this app rewrites every unknown path to index.html, so a
 * static /terms.html would need its own location block and would then be the
 * only page on the site that doesn't inherit the app's styling. Two small
 * components cost nothing and can never drift out of the deploy.
 *
 * They are reachable in every signed-in state as well as signed out. Somebody
 * looking for the cancellation terms is usually somebody about to cancel, and
 * making them sign out first to read them is both hostile and pointless.
 *
 * NOTE FOR WHOEVER SHIPS THIS: the text below describes exactly what the
 * software actually does — what it stores, who it shares with, how billing and
 * cancellation work — and is written to be accurate rather than to be
 * comprehensive. It is a starting draft, not reviewed advice. Have a lawyer
 * read it before taking money, and update LAST_UPDATED whenever the substance
 * changes rather than whenever the wording does.
 */

const LAST_UPDATED = '23 August 2026'

function Doc({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100dvh', background: T.paper, backgroundImage: T.glow, color: T.ink, fontFamily: SANS }}>
      <PublicFrame width={720}>
        <TopBar />
        <div style={{ marginTop: 28 }}>
          <div style={label()}>Last updated {LAST_UPDATED}</div>
          <h1 style={{ ...display(34), marginTop: 8 }}>{title}</h1>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 24 }}>
          {children}
        </div>
        <PublicFooter />
      </PublicFrame>
    </div>
  )
}

function Part({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section style={section()}>
      <div style={label()}>{heading}</div>
      <div style={{ ...body(15), marginTop: 10, lineHeight: 1.6, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {children}
      </div>
    </section>
  )
}

export function Terms() {
  return (
    <Doc title="Terms of service">
      <Part heading="What Daily is">
        <p style={{ margin: 0 }}>
          Daily is a personal planning app operated by CB Edge. One subscription covers one
          account, for one person. You keep whatever you put into it; we run the software that
          stores and displays it.
        </p>
      </Part>

      <Part heading="Your account">
        <p style={{ margin: 0 }}>
          You are responsible for what happens under your sign-in, so keep your password to
          yourself. An account is for one person; anyone who has your password has your tasks,
          your lists, your calendar and your money screen, because none of it is separately
          locked once you are through the front door.
        </p>
        <p style={{ margin: 0 }}>
          You must be old enough to enter a contract where you live, and the email address on the
          account has to be one you actually control.
        </p>
      </Part>

      <Part heading="Paying, renewing and cancelling">
        <p style={{ margin: 0 }}>
          Daily is a paid subscription with no free tier. Payment is handled by Stripe; we never
          see or store your card number. Plans renew automatically at the price shown when you
          subscribed until you cancel.
        </p>
        <p style={{ margin: 0 }}>
          You can cancel at any time from Settings, and your access continues to the end of the
          period you have already paid for. We do not pro-rate a partial month. If a payment
          fails, Stripe retries it for a few days and your access carries on meanwhile; if it
          never succeeds, the subscription lapses and the app locks — your data is not deleted,
          and paying again brings it straight back.
        </p>
        <p style={{ margin: 0 }}>
          If we change the price, we will tell you by email before it applies to you, and you can
          cancel before it does.
        </p>
      </Part>

      <Part heading="Market data">
        <p style={{ margin: 0 }}>
          The economic and earnings calendars come from third-party sources. They are provided for
          information only, they are sometimes wrong or late, and nothing in Daily is financial
          advice or a recommendation to trade. Do not make a trading decision on the strength of a
          date in a planner.
        </p>
      </Part>

      <Part heading="What we don't promise">
        <p style={{ margin: 0 }}>
          We work hard to keep Daily up and your data intact, but the service is provided as-is.
          We do not guarantee uninterrupted availability, and we are not liable for indirect or
          consequential loss. Keep your own copy of anything you cannot afford to lose.
        </p>
      </Part>

      <Part heading="Ending things">
        <p style={{ margin: 0 }}>
          You can stop using Daily whenever you like and ask us to delete your data.
          We can suspend an account that is being used to attack the service or to break the law.
          If we ever shut Daily down, we will give you notice and a way to export what is yours.
        </p>
      </Part>

      <Part heading="Contact">
        <p style={{ margin: 0 }}>
          Questions about these terms: <a href="mailto:support@cbedge.net" style={{ color: T.accent }}>support@cbedge.net</a>.
        </p>
      </Part>
    </Doc>
  )
}

export function Privacy() {
  return (
    <Doc title="Privacy">
      <Part heading="The short version">
        <p style={{ margin: 0 }}>
          Daily stores what you type into it so it can show it back to you. We do not sell it, we
          do not advertise against it, and we do not use it to train anything.
        </p>
      </Part>

      <Part heading="What we store">
        <p style={{ margin: 0 }}>
          Your email address, your display name, your timezone, and a hash of your password — never
          the password itself. Everything you create in the app: tasks, notes and journal entries,
          lists and meal plans, habits, projects and time logs, and your money accounts, ledger
          entries and recurring bills. A ZIP code, if you set one, so the Today screen can show
          the weather.
        </p>
        <p style={{ margin: 0 }}>
          If you connect Google Calendar, we store an access token for it, encrypted, on our
          server. Your browser never receives it. We read the calendars you select, and we create
          events only when you explicitly ask us to. You can disconnect at any time from Settings,
          which deletes the token and revokes our access with Google.
        </p>
        <p style={{ margin: 0 }}>
          We keep a short log of sign-in attempts — the email tried, the IP and whether it worked —
          so that repeated failures can be throttled.
        </p>
      </Part>

      <Part heading="What we don't store">
        <p style={{ margin: 0 }}>
          Card numbers. Payment goes to Stripe directly; we hold only the customer and subscription
          identifiers Stripe gives us back, and the status of your subscription.
        </p>
      </Part>

      <Part heading="Who else sees it">
        <p style={{ margin: 0 }}>
          Our hosting provider and database, because the data physically lives there. Stripe, for
          billing. Google, if you connect a calendar. Our email provider, to send you a
          verification link or a password reset. Nobody else, and never for money.
        </p>
      </Part>

      <Part heading="Cookies">
        <p style={{ margin: 0 }}>
          Two, both strictly necessary and neither used for tracking: one holds your sign-in
          session, and one marks this browser as trusted if you set up a quick-sign-in PIN. Both
          are HttpOnly, so no script on the page can read them, and both are scoped to this site
          alone. There are no analytics or advertising cookies.
        </p>
      </Part>

      <Part heading="Getting it back, or getting rid of it">
        <p style={{ margin: 0 }}>
          Email us and we will send you an export of your data, or delete it. Deletion
          is real deletion, not a hidden flag, though backups roll off on their own schedule over
          the following weeks.
        </p>
      </Part>

      <Part heading="Contact">
        <p style={{ margin: 0 }}>
          Privacy questions: <a href="mailto:privacy@cbedge.net" style={{ color: T.accent }}>privacy@cbedge.net</a>.
        </p>
      </Part>
    </Doc>
  )
}
