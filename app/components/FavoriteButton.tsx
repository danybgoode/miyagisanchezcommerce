'use client'

import { useState, useCallback } from 'react'
import { usePathname, useRouter } from 'next/navigation'

interface FavoriteButtonProps {
  listingId: string
  initialFavorited?: boolean
  isSignedIn: boolean
  size?: 'sm' | 'md'
  className?: string
}

export default function FavoriteButton({
  listingId,
  initialFavorited = false,
  isSignedIn,
  size = 'md',
  className = '',
}: FavoriteButtonProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [favorited, setFavorited] = useState(initialFavorited)
  const [loading, setLoading] = useState(false)

  const iconSize = size === 'sm' ? 18 : 22
  const btnSize  = size === 'sm' ? 32 : 40

  const toggle = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    if (!isSignedIn) {
      router.push(`/sign-in?redirect_url=${encodeURIComponent(pathname)}`)
      return
    }

    setLoading(true)
    const optimistic = !favorited
    setFavorited(optimistic)

    try {
      const res = await fetch('/api/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId }),
      })
      const data = await res.json() as { favorited?: boolean }
      if (!res.ok) setFavorited(!optimistic) // revert
      else setFavorited(data.favorited ?? optimistic)
    } catch {
      setFavorited(!optimistic)
    } finally {
      setLoading(false)
    }
  }, [favorited, isSignedIn, listingId, pathname, router])

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={loading}
      aria-label={favorited ? 'Quitar de favoritos' : 'Guardar en favoritos'}
      aria-pressed={favorited}
      className={`flex items-center justify-center rounded-full transition-all disabled:opacity-60 ${className}`}
      style={{
        width: btnSize,
        height: btnSize,
        background: favorited ? 'var(--danger-soft)' : 'rgba(255,255,255,0.9)',
        border: 'none',
        cursor: 'pointer',
        backdropFilter: 'blur(8px)',
        boxShadow: 'var(--shadow-2)',
        transform: loading ? 'scale(0.9)' : 'scale(1)',
      }}
    >
      <i
        className={favorited ? 'iconoir-heart-solid' : 'iconoir-heart'}
        style={{
          fontSize: iconSize,
          color: favorited ? 'var(--danger)' : 'var(--fg-muted)',
          transition: 'color 150ms, transform 200ms',
          transform: favorited ? 'scale(1.15)' : 'scale(1)',
          display: 'block',
          lineHeight: 1,
        }}
      />
    </button>
  )
}
