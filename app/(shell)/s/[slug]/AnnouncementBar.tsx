import { httpUrl } from '@/lib/settings-import'
import type { AnnouncementSettings } from '@/lib/shop-settings/types'

/**
 * Own-shop premium presentation (epic 07, Sprint 1, Story 1.1) — a short bar
 * above the shop header. Absent `announcement` renders nothing (today's
 * storefront, unchanged). Colors via CSS variables + `textColor` (computed by
 * the caller via `readableTextOn`, `lib/platform-theme.ts`) only.
 *
 * `link` is re-validated at render time (not just at write time) — a defense-
 * in-depth check against a non-http(s) scheme (e.g. `javascript:`) ever
 * reaching a public `href`, regardless of which write path stored it.
 */
export default function AnnouncementBar({
  announcement,
  textColor,
}: {
  announcement: AnnouncementSettings | null | undefined
  textColor: string
}) {
  if (!announcement?.text) return null

  const link = announcement.link ? httpUrl(announcement.link) : null

  const content = (
    <span className="text-sm font-medium">{announcement.text}</span>
  )

  return (
    <div
      className="w-full text-center py-2 px-4"
      style={{ backgroundColor: 'var(--shop-accent)', color: textColor }}
    >
      {link ? (
        <a href={link} target="_blank" rel="noopener noreferrer" className="no-underline hover:underline" style={{ color: textColor }}>
          {content}
        </a>
      ) : content}
    </div>
  )
}
