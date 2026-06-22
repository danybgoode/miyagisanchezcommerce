'use client'

import { useEffect, useState, type RefObject, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { CATEGORIES } from '@/lib/types'
import {
  readRecents, addRecent, clearRecents, searchHref, normalizeTerm,
} from '@/lib/search-recents'

// Copy is threaded from layout's getDictionary() (es by default) so the strings
// live in locales/{es,en}.json (AGENTS rule #5), not hardcoded here.
export type SearchSheetCopy = {
  title: string
  placeholder: string
  recentTitle: string
  suggestedTitle: string
  close: string
  clear: string
}

// Static "suggested" seed — the top product categories as ready-made queries.
// Reuses CATEGORIES (lib/types) so the set tracks the real taxonomy; tapping one
// searches its label via /l?q=. No data source / fetch needed.
const SUGGESTED = CATEGORIES.slice(0, 6).map((c) => c.label)

const SPRING = 'cubic-bezier(0.34, 1.56, 0.64, 1)'

/**
 * The PWA bottom-sheet search (S2.1). The sheet + its input are ALWAYS mounted
 * (hidden via a translate transform when closed) so the trigger in MobileTabBar
 * can call `inputRef.current.focus()` synchronously inside the tap handler —
 * the iOS keyboard only raises from a real, already-present element (WebKit
 * bug 279904, also why the input carries `touch-action: auto`). Rendered as a
 * sibling of the bar so it doesn't ride the bar's keyboard auto-hide transform.
 */
export default function SearchSheet({
  open, onClose, inputRef, copy,
}: {
  open: boolean
  onClose: () => void
  inputRef: RefObject<HTMLInputElement | null>
  copy: SearchSheetCopy
}) {
  const router = useRouter()
  const [recents, setRecents] = useState<string[]>([])

  // On close: blur the field so the iOS keyboard dismisses and focus never stays
  // trapped inside the now-inert offscreen sheet (cross-review: a11y + keyboard).
  useEffect(() => {
    if (!open) inputRef.current?.blur()
  }, [open, inputRef])

  // On each open: refresh recents from storage, lock body scroll, close on Esc.
  useEffect(() => {
    if (!open) return
    setRecents(readRecents())
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onClose])

  function submit(term: string) {
    const q = normalizeTerm(term)
    if (!q) { inputRef.current?.focus(); return }
    setRecents(addRecent(q))
    onClose()
    router.push(searchHref(q))
  }

  function onFormSubmit(e: FormEvent) {
    e.preventDefault()
    submit(inputRef.current?.value ?? '')
  }

  function onClear() {
    setRecents(clearRecents())
    inputRef.current?.focus()
  }

  const chipStyle: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '7px 12px', borderRadius: 'var(--r-pill)',
    background: 'var(--bg-sunk)', border: '1px solid var(--border)',
    color: 'var(--fg)', fontSize: 13, fontFamily: 'var(--font-sans)',
    cursor: 'pointer', maxWidth: '100%',
  }
  const sectionTitleStyle: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
    color: 'var(--fg-subtle)', fontFamily: 'var(--font-sans)',
  }

  return (
    <>
      {/* Scrim — mounted only while open so the always-present sheet never traps
          taps when closed. */}
      {open && (
        <div
          className="pwa-only"
          onClick={onClose}
          aria-hidden="true"
          style={{ position: 'fixed', inset: 0, zIndex: 110, background: 'rgba(0, 0, 0, 0.40)' }}
        />
      )}

      {/* The sheet itself — always mounted (transform toggles visibility). */}
      <div
        className="pwa-only glass-liquid"
        role="dialog"
        aria-modal={open || undefined}
        aria-label={copy.title}
        // While closed the sheet is offscreen but its input stays mounted (for the
        // synchronous focus on open) — `inert` removes it from tab order + the a11y
        // tree and moves focus out, so nothing is trapped behind it (cross-review).
        inert={!open}
        style={{
          position: 'fixed',
          left: '50%',
          bottom: 0,
          width: '100%',
          maxWidth: 520,
          transform: open
            ? 'translateX(-50%) translateY(0)'
            : 'translateX(-50%) translateY(110%)',
          transition: `transform 300ms ${SPRING}`,
          zIndex: 120,
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          padding: '14px 16px',
          paddingBottom: 'max(16px, env(safe-area-inset-bottom))',
          maxHeight: '80vh',
          overflowY: 'auto',
          flexDirection: 'column',
          gap: 14,
          pointerEvents: open ? 'auto' : 'none',
        }}
      >
        {/* Search field + close affordance. */}
        <form onSubmit={onFormSubmit} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
            <i
              className="iconoir-search"
              aria-hidden="true"
              style={{
                position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
                fontSize: 16, color: 'var(--fg-subtle)', pointerEvents: 'none', lineHeight: 1,
              }}
            />
            <input
              ref={inputRef}
              type="search"
              name="q"
              placeholder={copy.placeholder}
              autoComplete="off"
              enterKeyHint="search"
              aria-label={copy.placeholder}
              style={{
                width: '100%',
                height: 46,
                // WebKit bug 279904: `touch-action: auto` keeps the synchronous tap
                // focus reliably raising the keyboard inside the PWA.
                touchAction: 'auto',
                background: 'var(--bg-base)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--r-pill)',
                padding: '0 14px 0 38px',
                fontSize: 16, // 16px avoids iOS focus zoom
                fontFamily: 'var(--font-sans)',
                color: 'var(--fg)',
                outline: 'none',
              }}
            />
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={copy.close}
            className="icon-btn"
            style={{ flexShrink: 0 }}
          >
            <i className="iconoir-xmark" style={{ fontSize: 22 }} />
          </button>
        </form>

        {/* Recent searches. */}
        {recents.length > 0 && (
          <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={sectionTitleStyle}>{copy.recentTitle}</span>
              <button
                type="button"
                onClick={onClear}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                  color: 'var(--fg-muted)', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-sans)',
                }}
              >
                {copy.clear}
              </button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {recents.map((term) => (
                <button key={term} type="button" onClick={() => submit(term)} style={chipStyle}>
                  <i className="iconoir-clock-rotate-right" style={{ fontSize: 14, color: 'var(--fg-subtle)' }} aria-hidden="true" />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{term}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Suggested searches. */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={sectionTitleStyle}>{copy.suggestedTitle}</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {SUGGESTED.map((term) => (
              <button key={term} type="button" onClick={() => submit(term)} style={chipStyle}>
                <i className="iconoir-search" style={{ fontSize: 14, color: 'var(--fg-subtle)' }} aria-hidden="true" />
                <span>{term}</span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </>
  )
}
