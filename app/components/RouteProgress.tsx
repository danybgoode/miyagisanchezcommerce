'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import {
  NAV_PROGRESS_DELAY_MS,
  NAV_PROGRESS_DONE_MS,
  NAV_PROGRESS_TIMEOUT_MS,
  navProgressWidth,
  shouldStartNavProgress,
} from '@/lib/nav-progress'

/**
 * The global route progress bar — the I/O shell around `lib/nav-progress.ts`.
 * Every decision it makes lives in that pure module; this file only listens,
 * ticks and paints.
 *
 * Mounted once in `PlatformShell`. It is deliberately NOT per-page: the whole
 * point is that it survives the navigation it is reporting on.
 *
 * Pairs with — and does not replace — `LinkPending`. This says "the app is
 * going somewhere"; the inline dot says "the thing YOU clicked is what's
 * going". Users need the second one to know their tap was the one that landed.
 */
export default function RouteProgress() {
  const pathname = usePathname()
  const [width, setWidth] = useState<number | null>(null) // null = not shown
  const startedAt = useRef<number | null>(null)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const frame = useRef<ReturnType<typeof setInterval> | null>(null)

  function clearAll() {
    for (const t of timers.current) clearTimeout(t)
    timers.current = []
    if (frame.current) clearInterval(frame.current)
    frame.current = null
  }

  // ── Start: any click that the router will turn into a navigation ──────────
  useEffect(() => {
    function onClick(event: MouseEvent) {
      const anchor = (event.target as Element | null)?.closest?.('a')
      if (!(anchor instanceof HTMLAnchorElement)) return

      const start = shouldStartNavProgress({
        // `anchor.href` is already resolved to absolute by the DOM.
        href: anchor.getAttribute('href') === null ? null : anchor.href,
        target: anchor.target,
        download: anchor.hasAttribute('download'),
        currentOrigin: window.location.origin,
        currentPath: window.location.pathname,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        button: event.button,
        defaultPrevented: event.defaultPrevented,
      })
      if (!start) return

      clearAll()
      startedAt.current = Date.now()

      // Nothing is painted until the navigation has proven itself slow enough
      // to be worth reporting — see NAV_PROGRESS_DELAY_MS.
      timers.current.push(
        setTimeout(() => {
          setWidth(navProgressWidth(Date.now() - (startedAt.current ?? Date.now())))
          frame.current = setInterval(() => {
            setWidth(navProgressWidth(Date.now() - (startedAt.current ?? Date.now())))
          }, 120)
        }, NAV_PROGRESS_DELAY_MS),
      )

      // A navigation that never resolves must not leave a frozen bar behind.
      timers.current.push(
        setTimeout(() => {
          clearAll()
          startedAt.current = null
          setWidth(null)
        }, NAV_PROGRESS_TIMEOUT_MS),
      )
    }

    // Capture phase: a link's own onClick may `preventDefault()`, and we want to
    // see the event with `defaultPrevented` still false so the pure rule can
    // decide — the router's own handler runs later.
    document.addEventListener('click', onClick, { capture: true })
    return () => {
      document.removeEventListener('click', onClick, { capture: true })
      clearAll()
    }
  }, [])

  // ── Finish: the pathname actually changed ─────────────────────────────────
  useEffect(() => {
    if (startedAt.current === null) return
    clearAll()
    startedAt.current = null
    // Snap to 100 first so the bar is seen COMPLETING rather than vanishing —
    // the completion is the part that says "you arrived", and a bar that just
    // disappears reads as a cancelled action.
    setWidth(100)
    const t = setTimeout(() => setWidth(null), NAV_PROGRESS_DONE_MS)
    timers.current.push(t)
    return () => clearTimeout(t)
  }, [pathname])

  if (width === null) return null

  return (
    <div
      className="route-progress"
      data-testid="route-progress"
      role="presentation"
      aria-hidden
      // Opacity stays at 1 for the whole life of the bar. Fading it out at 100%
      // at the same moment it snaps to 100% would mean the completion is never
      // actually seen, which defeats the point of animating to 100% at all —
      // the element simply unmounts NAV_PROGRESS_DONE_MS later.
      style={{ width: `${width}%` }}
    />
  )
}
