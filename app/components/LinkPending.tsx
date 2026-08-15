'use client'

import Link from 'next/link'
import { useLinkStatus } from 'next/link'
import { useEffect, useRef, type ComponentProps, type ReactNode } from 'react'

/**
 * Local, per-link navigation feedback — the answer to "is the thing *I* clicked
 * the thing that's loading?".
 *
 * Next 16's `useLinkStatus()` reports the pending state of the nearest
 * enclosing `<Link>` to its descendants. That scope is the whole value: it is
 * the only signal that can distinguish the clicked item from its fifteen
 * siblings, which is exactly what a nav needs and what the global
 * `RouteProgress` bar structurally cannot provide. The two are complements,
 * not alternatives — the bar says "the app is going somewhere", this says
 * "the thing you pressed is what's going".
 *
 * ── One implementation of the ancestor flag, on purpose ──────────────────────
 * `data-pending` has to land on the `<a>` itself so the WHOLE control dims as
 * one thing and a spec can assert it with one selector — but the status can
 * only be read by a descendant, and React cannot pass a value upward. The DOM
 * write below is the bridge. It is written ONCE, here, and every call site uses
 * `PendingMark`: a second hand-rolled copy at a call site is how the cleanup
 * gets forgotten, and a forgotten cleanup leaves a link permanently dimmed and
 * stuck on `cursor: progress` — a "still loading" claim about a navigation that
 * finished, which is exactly the lie this feature exists to prevent.
 */

/** Render-prop access to the enclosing `<Link>`'s pending state, for callers wanting full control. */
export function LinkPending({ children }: { children: (pending: boolean) => ReactNode }) {
  const { pending } = useLinkStatus()
  return <>{children(pending)}</>
}

/**
 * Drop this inside any `<Link>` to give it the standard treatment: the whole
 * anchor dims while pending, and a small dot appears at the point of the click.
 *
 * Outside a `<Link>`, `useLinkStatus()` reports `pending: false` forever — it
 * fails silently rather than loudly, so keep the call sites inside links.
 */
export function PendingMark({ showDot = true }: { showDot?: boolean }) {
  const { pending } = useLinkStatus()
  const anchorRef = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    // `closest` from a hidden marker span is how the descendant reaches its
    // ancestor `<a>` — the `<a>` outlives this subtree across a client-side
    // navigation, so the cleanup below is what stops a stale flag surviving.
    const anchor = anchorRef.current?.closest('a')
    if (!anchor) return
    if (pending) anchor.setAttribute('data-pending', 'true')
    else anchor.removeAttribute('data-pending')
    return () => anchor.removeAttribute('data-pending')
  }, [pending])

  return (
    <>
      <span hidden ref={anchorRef} />
      {pending && showDot ? <PendingDot /> : null}
    </>
  )
}

/** The small mark that appears next to what you clicked. Styling lives in `globals.css`. */
export function PendingDot() {
  return <span className="pending-dot" data-testid="pending-dot" aria-hidden />
}

/** A `<Link>` that shows it was pressed and that it is working. The batteries-included form. */
export function PendingNavLink({
  children,
  showDot = true,
  className = '',
  ...linkProps
}: ComponentProps<typeof Link> & { showDot?: boolean }) {
  return (
    <Link {...linkProps} className={`pressable ${className}`.trim()}>
      {children}
      <PendingMark showDot={showDot} />
    </Link>
  )
}
