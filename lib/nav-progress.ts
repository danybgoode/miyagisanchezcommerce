/**
 * lib/nav-progress.ts
 *
 * The pure half of the route progress bar: "is this click going to start an
 * in-app navigation?" All of it is decided from a plain description of the
 * click, with no DOM, no router and no window — so the whole decision is unit
 * testable and the component around it stays a ~30-line I/O shell.
 *
 * Why a document-level click listener at all, when Next 16 ships
 * `useLinkStatus()`: that hook reports the status of ONE `<Link>` to its own
 * descendants, which is exactly right for the inline dot next to the thing you
 * clicked, and structurally cannot drive a single global bar — there is no
 * "any link is pending" signal to subscribe to. So the two coexist on purpose:
 * `useLinkStatus` for the local mark, this for the global one.
 *
 * The cost of a global listener is false positives, and every rule below exists
 * to kill one. A bar that appears on a download link, an external link or a
 * cmd-click that opened a background tab is worse than no bar: it says "this
 * page is loading" about a page that is never going to load, and then has to be
 * dismissed by a timeout, which teaches people the bar means nothing.
 */

export interface NavClickDescriptor {
  /** The resolved absolute href of the anchor, or `null` when the click hit no anchor. */
  href: string | null
  /** The anchor's `target` attribute. */
  target?: string | null
  /** Whether the anchor carries a `download` attribute. */
  download?: boolean
  /** The page's own origin, for the same-origin test. */
  currentOrigin: string
  /** The path the browser is on right now — a link to it navigates nowhere. */
  currentPath: string
  /** Modifier keys — any of these means the browser, not the router, handles the click. */
  metaKey?: boolean
  ctrlKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
  /** `0` is the primary button. Middle-click opens a tab; right-click opens a menu. */
  button?: number
  /** Whether something already called `preventDefault()` on this event. */
  defaultPrevented?: boolean
}

/**
 * Only a click that Next's router will actually handle as a same-tab, same-app
 * navigation to a DIFFERENT path starts the bar.
 */
export function shouldStartNavProgress(click: NavClickDescriptor): boolean {
  if (!click.href) return false
  if (click.defaultPrevented) return false
  if (click.button != null && click.button !== 0) return false
  if (click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return false
  if (click.download) return false
  // `_self` and an absent target both mean this tab; anything else leaves it.
  if (click.target && click.target !== '_self') return false

  let url: URL
  try {
    // The base is the CURRENT PAGE, not the bare origin. Resolving against the
    // origin alone silently relocates every relative href: a plain `#seccion`
    // on `/mx` resolves to `/#seccion`, whose pathname is `/`, which then looks
    // like a navigation away from `/mx` and starts a bar for a scroll. Same
    // class of bug for any `./sibling` link. Caught by spec, not by review.
    url = new URL(click.href, `${click.currentOrigin}${click.currentPath}`)
  } catch {
    return false
  }

  // `mailto:`, `tel:`, `javascript:`, `blob:` … — never a router navigation.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  if (url.origin !== click.currentOrigin) return false

  // A pure `#anchor` jump, or a link to the page you are already on: nothing
  // loads, so a progress bar would hang until its own timeout.
  if (url.pathname === click.currentPath && !url.search) return false

  return true
}

/**
 * The bar's width over time. Creeps toward — but never reaches — `CEILING`,
 * because the real duration is unknown and a bar that fills before the page
 * arrives is a lie people learn to distrust.
 *
 * Deliberately deterministic (no randomness, unlike the nprogress convention):
 * a random trickle cannot be asserted, and a progress indicator that cannot be
 * tested is one nobody will notice has broken.
 */
export const NAV_PROGRESS_CEILING = 90

export function navProgressWidth(elapsedMs: number): number {
  if (elapsedMs <= 0) return 0
  // Exponential approach: fast at first (most navigations are fast, and the bar
  // has to be visibly moving before it is worth showing), then asymptotic.
  const approach = 1 - Math.exp(-elapsedMs / 700)
  return Math.min(NAV_PROGRESS_CEILING, Math.round(NAV_PROGRESS_CEILING * approach))
}

/**
 * How long to wait before painting the bar at all.
 *
 * A prefetched route can render in under 100ms. Flashing a progress bar for
 * 80ms on every single click is visual noise that makes a fast site feel busy,
 * so nothing is shown until a navigation has proven itself slow enough to be
 * worth telling the user about.
 */
export const NAV_PROGRESS_DELAY_MS = 140

/** How long the finished bar stays at 100% before fading out. */
export const NAV_PROGRESS_DONE_MS = 180

/**
 * The hard stop. A navigation that never resolves (a server error swallowed by
 * the router, a route that redirects back to itself) must not leave a bar
 * frozen at 90% forever — an indicator that lies about a stuck state is worse
 * than none, so it gives up and says so by disappearing.
 */
export const NAV_PROGRESS_TIMEOUT_MS = 20_000
