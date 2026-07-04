import type { AnnouncementSettings } from '@/lib/shop-settings/types'

/**
 * Own-shop premium presentation (epic 07, Sprint 1, Story 1.1) — a short bar
 * above the shop header. Absent `announcement` renders nothing (today's
 * storefront, unchanged). Colors via CSS variables only (`--shop-accent` is
 * already set by the caller's wrapper style, `page.tsx`).
 */
export default function AnnouncementBar({ announcement }: { announcement: AnnouncementSettings | null | undefined }) {
  if (!announcement?.text) return null

  const content = (
    <span className="text-sm font-medium">{announcement.text}</span>
  )

  return (
    <div
      className="w-full text-center py-2 px-4 text-white"
      style={{ backgroundColor: 'var(--shop-accent)' }}
    >
      {announcement.link ? (
        <a href={announcement.link} target="_blank" rel="noopener noreferrer" className="no-underline text-white hover:underline">
          {content}
        </a>
      ) : content}
    </div>
  )
}
