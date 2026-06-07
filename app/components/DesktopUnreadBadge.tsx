'use client'

import { useState, useEffect } from 'react'
import { useUser } from '@clerk/nextjs'

// Renders a small red badge number next to the desktop messages icon.
// Polls /api/conversations/unread every 60s (in-conversation delivery is realtime;
// this is just the global nav badge for users not currently in a chat).
export default function DesktopUnreadBadge() {
  const { isSignedIn } = useUser()
  const [unread, setUnread] = useState(0)

  useEffect(() => {
    if (!isSignedIn) { setUnread(0); return }
    let cancelled = false

    async function check() {
      try {
        const res = await fetch('/api/conversations/unread')
        const data = await res.json() as { unread: number }
        if (!cancelled) setUnread(data.unread)
      } catch { /* silent */ }
    }

    check()
    const id = setInterval(check, 60_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [isSignedIn])

  if (unread <= 0) return null

  return (
    <span
      aria-label={`${unread} sin leer`}
      style={{
        position: 'absolute',
        top: -5,
        right: -7,
        minWidth: 15,
        height: 15,
        borderRadius: 8,
        background: 'var(--danger)',
        color: 'var(--fg-inverse)',
        fontSize: 9,
        fontWeight: 700,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 3px',
        lineHeight: 1,
        pointerEvents: 'none',
      }}
    >
      {unread > 9 ? '9+' : unread}
    </span>
  )
}
