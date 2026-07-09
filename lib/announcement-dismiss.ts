/**
 * lib/announcement-dismiss.ts
 *
 * Client-side, per-campaign dismiss persistence shared by the seller strip
 * (`SellerAnnouncementStrip.tsx`) and the buyer homepage card
 * (`HomeAnnouncementCard.tsx`) — epic 08 · admin-content-and-announcements, Sprint 3.
 * Mirrors `PlatformThemeToggle.tsx`'s `readPreference`/`writePreference` idiom:
 * try/catch-wrapped `localStorage`, degrading to "never dismissed" in private/
 * locked-down contexts rather than throwing. The key is scoped to the campaign
 * `id`, not the audience — a brand-new campaign is never suppressed by a stale
 * dismissal of a prior one for the same audience.
 */

function key(id: string): string {
  return `miyagi:dismissed-announcement:${id}`
}

export function readDismissed(id: string): boolean {
  try {
    return window.localStorage.getItem(key(id)) === '1'
  } catch {
    return false
  }
}

export function writeDismissed(id: string): void {
  try {
    window.localStorage.setItem(key(id), '1')
  } catch {
    // Storage can be unavailable in private/locked-down contexts; the dismiss
    // still works for the current page render.
  }
}
