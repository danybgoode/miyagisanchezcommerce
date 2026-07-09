'use client'

import { useEffect, useState } from 'react'
import { readDismissed, writeDismissed } from '@/lib/announcement-dismiss'

export type SellerAnnouncement = {
  id: string
  text: string
  ctaLabel: string | null
  ctaLink: string | null
}

/**
 * Slim, quiet, dismissable strip atop the seller shell (epic 08 ·
 * admin-content-and-announcements, Sprint 3, Story 3.2). Receives the resolved
 * active-or-null seller campaign as a server-fetched prop (`SellerManageLayout`
 * calls `getActiveAnnouncement('seller')`) — no client-side fetch. Renders nothing
 * server-side/at-first-paint when there's no campaign; when there is one, a
 * post-hydration `localStorage` check collapses it if this campaign id was
 * already dismissed.
 */
export default function SellerAnnouncementStrip({ announcement }: { announcement: SellerAnnouncement | null }) {
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (announcement) setDismissed(readDismissed(announcement.id))
  }, [announcement])

  if (!announcement || dismissed) return null

  return (
    <div
      style={{
        background: 'var(--bg-sunk)',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <div
        className="app-shell"
        style={{
          minHeight: 34,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          padding: '6px 12px',
          fontSize: 13,
          color: 'var(--fg)',
        }}
      >
        <span style={{ textAlign: 'center' }}>{announcement.text}</span>
        {announcement.ctaLabel && announcement.ctaLink && (
          <a
            href={announcement.ctaLink}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--accent)', fontWeight: 600, textDecoration: 'underline', whiteSpace: 'nowrap' }}
          >
            {announcement.ctaLabel}
          </a>
        )}
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
            color: 'var(--fg-muted)',
            cursor: 'pointer',
            fontSize: 16,
            lineHeight: 1,
            padding: 0,
            marginLeft: 4,
          }}
        >
          ×
        </button>
      </div>
    </div>
  )
}
