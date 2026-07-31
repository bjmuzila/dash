import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  homeShellStyle,
  homeHeaderStyle,
  classicCardAccentStyle,
  OWNER_THEME,
  LIGHT_BLUE,
  TYPE,
  rgba,
} from "../lib/theme";
import { OWNER_SIDEBAR_GROUPS } from "../lib/nav";
import {
  HUB_LINKS,
  getPinned,
  getRecent,
  recordVisit,
  searchLinks,
  togglePin,
  type HubLink,
} from "../lib/hubPrefs";

/**
 * /owner — command-bar hub.
 *
 * Type to filter every owner route (⌘K / Ctrl-K from anywhere on the page),
 * ↑/↓ to move, Enter to go. With the box empty the full route list is still on
 * screen, grouped exactly as the sidebar groups it, so the hub never becomes a
 * memory test. Pins and recents live in localStorage (lib/hubPrefs).
 *
 * Everything here is sourced from OWNER_SIDEBAR_GROUPS and lib/theme — no
 * hardcoded colors, no second copy of the route list.
 */
export default function Hub() {
  const navigate = useNavigate();
  const [view, setView] = useState<"brain" | "list">("list");
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const [pinned, setPinned] = useState<HubLink[]>([]);
  const [recent, setRecent] = useState<HubLink[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setPinned(getPinned());
    setRecent(getRecent());
  }, []);

  const results = useMemo(() => searchLinks(query), [query]);
  useEffect(() => setSel(0), [query]);

  const pinnedHrefs = useMemo(() => new Set(pinned.map((p) => p.href)), [pinned]);

  const go = (link: HubLink) => {
    recordVisit(link.href);
    navigate(link.href);
  };

  const pin = (href: string) => setPinned(togglePin(href));

  // ⌘K / Ctrl-K focuses the box from anywhere on the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onInputKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => (results.length ? (s + 1) % results.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => (results.length ? (s - 1 + results.length) % results.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = results[sel];
      if (hit) go(hit);
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (query) setQuery("");
      else inputRef.current?.blur();
    }
  };

  // ── shared bits ────────────────────────────────────────────────────────────
  const toggleBtn = (id: "brain" | "list", label: string) => (
    <button
      onClick={() => setView(id)}
      style={{
        padding: "6px 14px",
        borderRadius: 8,
        fontSize: TYPE.body,
        fontWeight: 700,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        cursor: "pointer",
        color: view === id ? OWNER_THEME.bg : OWNER_THEME.text,
        background: view === id ? LIGHT_BLUE : `${LIGHT_BLUE}14`,
        border: `1px solid ${LIGHT_BLUE}${view === id ? "" : "33"}`,
      }}
    >
      {label}
    </button>
  );

  const railLabel: CSSProperties = {
    fontSize: TYPE.label,
    fontWeight: 800,
    letterSpacing: "0.2em",
    textTransform: "uppercase",
    color: rgba(LIGHT_BLUE, 0.55),
    display: "flex",
    alignItems: "center",
    gap: 10,
    margin: "2px 0 10px",
  };

  const starBtn = (href: string, on: boolean) => (
    <button
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        pin(href);
      }}
      title={on ? "Unpin" : "Pin to hub"}
      aria-label={on ? "Unpin" : "Pin to hub"}
      style={{
        background: "none",
        border: "none",
        cursor: "pointer",
        padding: "0 2px",
        lineHeight: 1,
        fontSize: TYPE.label,
        color: on ? OWNER_THEME.gold : OWNER_THEME.text,
        opacity: on ? 1 : 0.28,
        flexShrink: 0,
      }}
    >
      {on ? "★" : "☆"}
    </button>
  );

  /** Compact chip used by the Pinned / Recent rows and the group lists. */
  const chip = (link: HubLink, accent: string, showStar: boolean) => {
    const on = pinnedHrefs.has(link.href);
    return (
      <button
        key={link.href}
        onClick={() => go(link)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "9px 12px",
          borderRadius: 10,
          cursor: "pointer",
          textAlign: "left",
          color: OWNER_THEME.text,
          background: on ? rgba(OWNER_THEME.gold, 0.08) : `${accent}12`,
          border: `1px solid ${on ? rgba(OWNER_THEME.gold, 0.35) : `${accent}33`}`,
        }}
      >
        <span aria-hidden style={{ fontSize: TYPE.body, width: 18, textAlign: "center", color: accent }}>
          {link.glyph}
        </span>
        <span style={{ fontSize: TYPE.body, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>
          {link.label}
        </span>
        {showStar && starBtn(link.href, on)}
      </button>
    );
  };

  const chipRow = (title: string, links: HubLink[], showStar: boolean) =>
    links.length === 0 ? null : (
      <div>
        <div style={railLabel}>
          {title}
          <span style={{ flex: 1, height: 1, background: OWNER_THEME.border }} />
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {links.map((l) => chip(l, l.accent, showStar))}
        </div>
      </div>
    );

  // ── search results ─────────────────────────────────────────────────────────
  const resultList = (
    <div style={{ ...classicCardAccentStyle, padding: 0, overflow: "hidden" }}>
      {results.length === 0 ? (
        <div style={{ padding: "18px 16px", fontSize: TYPE.body, color: OWNER_THEME.text, opacity: 0.6 }}>
          No route matches “{query}”. {HUB_LINKS.length} routes indexed.
        </div>
      ) : (
        results.map((link, i) => {
          const active = i === sel;
          return (
            <div
              key={link.href}
              onClick={() => go(link)}
              onMouseEnter={() => setSel(i)}
              role="button"
              tabIndex={-1}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "11px 15px",
                cursor: "pointer",
                borderBottom: i === results.length - 1 ? "none" : `1px solid ${OWNER_THEME.border}`,
                background: active ? `${link.accent}1a` : "transparent",
                boxShadow: active ? `inset 2px 0 0 ${link.accent}` : "none",
              }}
            >
              <span aria-hidden style={{ fontSize: TYPE.body, width: 18, textAlign: "center", color: link.accent }}>
                {link.glyph}
              </span>
              <span style={{ fontSize: TYPE.body, fontWeight: 700, letterSpacing: "0.03em", color: OWNER_THEME.text }}>
                {link.label}
              </span>
              <span
                style={{
                  fontSize: TYPE.micro,
                  fontWeight: 800,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: link.accent,
                  border: `1px solid ${link.accent}4d`,
                  borderRadius: 999,
                  padding: "2px 8px",
                }}
              >
                {link.group}
              </span>
              <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: TYPE.micro, color: OWNER_THEME.text, opacity: 0.45, fontFamily: "ui-monospace, monospace" }}>
                  {link.href}
                </span>
                {starBtn(link.href, pinnedHrefs.has(link.href))}
                {active && (
                  <span style={{ fontSize: TYPE.micro, fontWeight: 800, letterSpacing: "0.1em", color: link.accent }}>
                    ↵
                  </span>
                )}
              </span>
            </div>
          );
        })
      )}
    </div>
  );

  // ── command bar ────────────────────────────────────────────────────────────
  const commandBar = (
    <div
      style={{
        ...classicCardAccentStyle,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "13px 16px",
        borderRadius: 14,
        border: `1px solid ${query ? rgba(LIGHT_BLUE, 0.45) : OWNER_THEME.border}`,
      }}
    >
      <span aria-hidden style={{ fontSize: TYPE.subhead, color: LIGHT_BLUE }}>
        ⌕
      </span>
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onInputKey}
        placeholder="Jump to a route…"
        aria-label="Search owner routes"
        autoComplete="off"
        spellCheck={false}
        style={{
          flex: 1,
          minWidth: 0,
          background: "transparent",
          border: "none",
          outline: "none",
          color: OWNER_THEME.text,
          fontSize: TYPE.subhead,
          letterSpacing: "0.01em",
        }}
      />
      {query ? (
        <button
          onClick={() => {
            setQuery("");
            inputRef.current?.focus();
          }}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: OWNER_THEME.text,
            opacity: 0.5,
            fontSize: TYPE.body,
            padding: 0,
          }}
          aria-label="Clear search"
        >
          ✕
        </button>
      ) : (
        <span
          style={{
            fontSize: TYPE.micro,
            fontWeight: 700,
            letterSpacing: "0.08em",
            color: OWNER_THEME.text,
            opacity: 0.4,
            border: `1px solid ${OWNER_THEME.border}`,
            borderRadius: 6,
            padding: "3px 7px",
            whiteSpace: "nowrap",
          }}
        >
          ⌘K
        </span>
      )}
    </div>
  );

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div style={homeShellStyle}>
      <div style={homeHeaderStyle}>
        <span style={{ fontSize: TYPE.title, fontWeight: 600, letterSpacing: "0.01em", color: OWNER_THEME.text }}>
          Owner Hub
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          {toggleBtn("brain", "Brain")}
          {toggleBtn("list", "List")}
        </div>
      </div>

      {view === "brain" ? (
        <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: "clamp(14px,2vw,22px)" }}>
          <div style={{ ...classicCardAccentStyle, padding: "22px 26px", maxWidth: 520, textAlign: "center" }}>
            <div style={{ fontSize: TYPE.label, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: LIGHT_BLUE, marginBottom: 8 }}>
              Brain graph — coming in a later pass
            </div>
            <p style={{ fontSize: TYPE.body, color: OWNER_THEME.text, lineHeight: 1.6, margin: 0, opacity: 0.85 }}>
              The force-directed route map (OwnerBrainGraph) will be ported next. Use the List view to navigate for now.
            </p>
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "clamp(14px,2vw,22px)", display: "flex", flexDirection: "column", gap: 18 }}>
          {commandBar}

          {query ? (
            resultList
          ) : (
            <>
              {chipRow("Pinned", pinned, true)}
              {chipRow("Recent", recent, false)}

              {OWNER_SIDEBAR_GROUPS.map((group) => {
                const links = HUB_LINKS.filter((l) => l.group === group.label);
                if (links.length === 0) return null;
                return (
                  <div key={group.label}>
                    <div style={{ ...railLabel, color: group.accent }}>
                      {group.label}
                      <span style={{ fontSize: TYPE.micro, fontWeight: 700, opacity: 0.55, letterSpacing: "0.06em" }}>
                        {links.length}
                      </span>
                      <span style={{ flex: 1, height: 1, background: OWNER_THEME.border }} />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 8 }}>
                      {links.map((l) => chip(l, group.accent, true))}
                    </div>
                  </div>
                );
              })}

              <div style={{ fontSize: TYPE.micro, color: OWNER_THEME.text, opacity: 0.4, letterSpacing: "0.06em", paddingTop: 2 }}>
                {HUB_LINKS.length} routes · ⌘K to search · ↑↓ to move · ↵ to open · ☆ to pin
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
