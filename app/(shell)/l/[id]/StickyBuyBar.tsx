'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * StickyBuyBar — PDP redesign (epic 01) Sprint 1, S1.1.
 *
 * The mobile-only fixed action bar + a matching in-flow spacer. The previous PDP
 * reserved space for the bar with a hard-coded `pb-[120px]` on the page wrapper —
 * but the bar is `position: fixed` with *variable* height (offer banners, one vs
 * two actions), so the fixed padding never matched it and content (description,
 * tags) got clipped behind the bar (the reported bug).
 *
 * Here a `ResizeObserver` measures the bar's REAL rendered height and reserves
 * exactly that much trailing space, so nothing is ever covered regardless of which
 * state the bar shows. Desktop renders the CTAs inline, so both the bar and the
 * spacer are `md:hidden` — show/hide is driven purely from the class (no inline
 * `display`), per the duplicate-render inline-style trap in LEARNINGS.
 */
export default function StickyBuyBar({ children }: { children: ReactNode }) {
  const barRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)

  useEffect(() => {
    const el = barRef.current
    if (!el) return
    const measure = () => setHeight(el.offsetHeight)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <>
      {/* In-flow spacer (mobile only) — reserves the bar's measured height so the
          fixed bar never covers page content. Replaces the old fixed pb-[120px]. */}
      <div className="md:hidden" data-testid="pdp-bar-spacer" aria-hidden style={{ height }} />

      <div
        ref={barRef}
        data-testid="pdp-sticky-bar"
        className="md:hidden"
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 80,
          background: 'var(--bg-elevated)',
          borderTop: '1px solid var(--border)',
          padding: '12px 16px',
          paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
          backdropFilter: 'blur(20px)',
        }}
      >
        {children}
      </div>
    </>
  )
}
