'use client'

import { useEffect, useState } from 'react'
import { readDismissed, writeDismissed } from '@/lib/announcement-dismiss'

export type BuyerAnnouncement = {
  id: string
  text: string
  ctaLabel: string | null
  ctaLink: string | null
}

/**
 * Understated, dismissable buyer announcement card inside the homepage flow (epic 08 ·
 * admin-content-and-announcements, Sprint 3, Story 3.3). Receives the resolved
 * active-or-null buyer campaign as a server-fetched prop from `HomePage`'s existing
 * `Promise.all` (via the ISR-safe `getActiveAnnouncement('buyer')`), so it's real
 * static/ISR-rendered HTML — not a client-side fetch. Renders nothing when there's no
 * campaign (the flag-off / no-campaign case, matching the rest of the page unchanged,
 * zero shift). When there IS one, a post-hydration `localStorage` check collapses it
 * if this campaign id was already dismissed — the same accepted mount-time-visibility
 * convention `HomeRetomaOffers`/`HomeSellerModule` already use in this file, just in
 * the opposite direction (pop-out instead of pop-in).
 */
export default function HomeAnnouncementCard({ announcement }: { announcement: BuyerAnnouncement | null }) {
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (announcement) setDismissed(readDismissed(announcement.id))
  }, [announcement])

  if (!announcement || dismissed) return null

  return (
    <div
      data-testid="home-announcement-card"
      className="card-panel mb-6"
      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14 }}
    >
      <i className="iconoir-megaphone" style={{ fontSize: 18, color: 'var(--accent)', flexShrink: 0 }} aria-hidden />
      <div style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--fg)' }}>
        {announcement.text}
        {announcement.ctaLabel && announcement.ctaLink && (
          <a
            href={announcement.ctaLink}
            target="_blank"
            rel="noopener noreferrer"
            style={{ marginLeft: 8, color: 'var(--accent)', fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}
          >
            {announcement.ctaLabel} →
          </a>
        )}
      </div>
      <button
        type="button"
        aria-label="Descartar"
        onClick={() => {
          writeDismissed(announcement.id)
          setDismissed(true)
        }}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--fg-subtle)',
          cursor: 'pointer',
          fontSize: 18,
          lineHeight: 1,
          padding: 0,
          flexShrink: 0,
        }}
      >
        ×
      </button>
    </div>
  )
}
