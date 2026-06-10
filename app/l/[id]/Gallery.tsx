'use client'

import { useState, useRef, useEffect, useCallback, type ReactNode, type CSSProperties } from 'react'
import { wrapIndex, indexFromScroll } from '@/lib/gallery'

type GalleryImage = { url: string; alt?: string | null }

// Shared 4/3 image box — keeps every surface CLS-free (matches the old static markup).
const MAIN_IMG: CSSProperties = { width: '100%', aspectRatio: '4/3', objectFit: 'cover', display: 'block' }

const arrowStyle = (side: 'left' | 'right'): CSSProperties => ({
  position: 'absolute',
  top: '50%',
  transform: 'translateY(-50%)',
  ...(side === 'left' ? { left: 8 } : { right: 8 }),
  width: 36,
  height: 36,
  borderRadius: '50%',
  border: 'none',
  background: 'rgba(0,0,0,0.45)',
  backdropFilter: 'blur(6px)',
  color: 'var(--fg-inverse)',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  zIndex: 5,
})

/**
 * PDP image gallery — the one client island on an otherwise server-rendered PDP.
 * - 0 / 1 image → byte-for-byte the old static look (no controls, no lightbox).
 * - 2+ images  → interactive, via the duplicate-render idiom (`md:hidden` /
 *   `hidden md:block`) sharing one `active` index: mobile = native scroll-snap
 *   track + dots; desktop = single active image + thumbnails + arrows + ←/→ keys.
 * `overlay` is a slot the page fills with its FavoriteButton + views badge so they
 * stay pinned over the image (no channel coupling — the island reads no channel).
 */
export default function Gallery({
  images,
  title,
  overlay,
}: {
  images: GalleryImage[]
  title: string
  overlay?: ReactNode
}) {
  const count = images.length
  const [active, setActive] = useState(0)
  const [lightbox, setLightbox] = useState(false)
  const trackRef = useRef<HTMLDivElement>(null)

  const go = useCallback((i: number) => setActive(wrapIndex(i, count)), [count])

  // Scroll the mobile track to a slide (dot taps + lightbox-close sync).
  const scrollToSlide = useCallback((i: number) => {
    const el = trackRef.current
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' })
  }, [])

  // ── 0 images → placeholder (unchanged) ──────────────────────────────────────
  if (count === 0) {
    return (
      <div style={{ position: 'relative' }} data-testid="pdp-gallery">
        <div style={{ ...MAIN_IMG, background: 'var(--bg-sunk)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <i className="iconoir-package" style={{ fontSize: 64, color: 'var(--fg-subtle)' }} />
        </div>
        {overlay}
      </div>
    )
  }

  // ── 1 image → single, no controls (unchanged) ──────────────────────────────
  if (count === 1) {
    return (
      <div style={{ position: 'relative' }} data-testid="pdp-gallery">
        <img
          src={images[0].url}
          alt={title}
          fetchPriority="high"
          style={{ ...MAIN_IMG, borderRadius: 'var(--r-lg)' }}
          className="md:rounded-xl"
        />
        {overlay}
      </div>
    )
  }

  // ── 2+ images → interactive ─────────────────────────────────────────────────
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      go(active - 1)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      go(active + 1)
    }
  }

  return (
    <div
      data-testid="pdp-gallery"
      role="group"
      aria-label="Galería de imágenes"
      tabIndex={0}
      onKeyDown={onKeyDown}
      style={{ outline: 'none' }}
    >
      <div style={{ position: 'relative' }}>
        {/* MOBILE — native scroll-snap track (swipe) */}
        <div
          ref={trackRef}
          className="hide-scrollbar md:hidden"
          style={{ display: 'flex', overflowX: 'auto', scrollSnapType: 'x mandatory' }}
          onScroll={(e) => {
            const el = e.currentTarget
            setActive(indexFromScroll(el.scrollLeft, el.clientWidth, count))
          }}
        >
          {images.map((img, i) => (
            <img
              key={i}
              src={img.url}
              alt={img.alt ?? `${title} — imagen ${i + 1} de ${count}`}
              onClick={() => {
                setActive(i)
                setLightbox(true)
              }}
              loading={i === 0 ? 'eager' : 'lazy'}
              fetchPriority={i === 0 ? 'high' : undefined}
              decoding={i === 0 ? undefined : 'async'}
              style={{ ...MAIN_IMG, scrollSnapAlign: 'start', flexShrink: 0, cursor: 'zoom-in' }}
            />
          ))}
        </div>

        {/* DESKTOP — single active image */}
        <img
          src={images[active].url}
          alt={images[active].alt ?? `${title} — imagen ${active + 1} de ${count}`}
          onClick={() => setLightbox(true)}
          fetchPriority={active === 0 ? 'high' : undefined}
          decoding={active === 0 ? undefined : 'async'}
          data-testid="gallery-main-desktop"
          className="hidden md:block md:rounded-xl"
          style={{ ...MAIN_IMG, cursor: 'zoom-in' }}
        />

        {/* DESKTOP — prev / next arrows */}
        <button type="button" aria-label="Imagen anterior" onClick={() => go(active - 1)} className="hidden md:flex" style={arrowStyle('left')}>
          <i className="iconoir-nav-arrow-left" style={{ fontSize: 22 }} />
        </button>
        <button type="button" aria-label="Imagen siguiente" onClick={() => go(active + 1)} className="hidden md:flex" style={arrowStyle('right')}>
          <i className="iconoir-nav-arrow-right" style={{ fontSize: 22 }} />
        </button>

        {/* MOBILE — dots */}
        <div
          className="md:hidden"
          style={{ position: 'absolute', bottom: 6, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 2, pointerEvents: 'none' }}
        >
          {images.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Ir a la imagen ${i + 1} de ${count}`}
              aria-current={i === active}
              onClick={() => scrollToSlide(i)}
              style={{ padding: 4, background: 'none', border: 'none', cursor: 'pointer', pointerEvents: 'auto', lineHeight: 0 }}
            >
              <span
                style={{
                  display: 'block',
                  width: i === active ? 8 : 6,
                  height: i === active ? 8 : 6,
                  borderRadius: '50%',
                  background: i === active ? 'var(--fg-inverse)' : 'rgba(255,255,255,0.55)',
                  boxShadow: '0 0 2px rgba(0,0,0,0.4)',
                  transition: 'width .15s, height .15s',
                }}
              />
            </button>
          ))}
        </div>

        {overlay}
      </div>

      {/* DESKTOP — clickable thumbnail rail */}
      <div className="hidden md:flex hide-scrollbar md:rounded-b-xl" style={{ gap: 4, padding: '4px 4px 0', overflowX: 'auto', background: 'var(--bg-sunk)' }}>
        {images.map((img, i) => (
          <button
            key={i}
            type="button"
            aria-label={`Ver imagen ${i + 1} de ${count}`}
            aria-current={i === active}
            onClick={() => setActive(i)}
            data-testid="gallery-thumb"
            style={{
              padding: 0,
              border: i === active ? '2px solid var(--fg)' : '2px solid transparent',
              borderRadius: 6,
              lineHeight: 0,
              flexShrink: 0,
              cursor: 'pointer',
              background: 'none',
            }}
          >
            <img
              src={img.url}
              alt=""
              loading="lazy"
              decoding="async"
              style={{ height: 64, width: 64, objectFit: 'cover', borderRadius: 4, display: 'block', opacity: i === active ? 1 : 0.85 }}
            />
          </button>
        ))}
      </div>

      {/* Lightbox — lazy-mounted only when opened (zero cost until used). */}
      {lightbox && (
        <Lightbox
          images={images}
          title={title}
          index={active}
          setIndex={go}
          onClose={() => {
            setLightbox(false)
            scrollToSlide(active)
          }}
        />
      )}
    </div>
  )
}

const lbArrow = (side: 'left' | 'right'): CSSProperties => ({
  position: 'absolute',
  top: '50%',
  transform: 'translateY(-50%)',
  ...(side === 'left' ? { left: 12 } : { right: 12 }),
  width: 44,
  height: 44,
  borderRadius: '50%',
  border: 'none',
  background: 'rgba(255,255,255,0.12)',
  color: 'var(--fg-inverse)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  zIndex: 2,
})

function Lightbox({
  images,
  title,
  index,
  setIndex,
  onClose,
}: {
  images: GalleryImage[]
  title: string
  index: number
  setIndex: (i: number) => void
  onClose: () => void
}) {
  const count = images.length
  const touchX = useRef<number | null>(null)

  // Lock background scroll while open; restore the previous value on close (the
  // scroll position is preserved — overflow:hidden doesn't move it).
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  // Modal keyboard: Esc closes; ←/→ navigate.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') setIndex(index - 1)
      else if (e.key === 'ArrowRight') setIndex(index + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, setIndex, onClose])

  return (
    <div
      data-testid="gallery-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={`Imagen ${index + 1} de ${count}`}
      onClick={onClose}
      onTouchStart={(e) => {
        touchX.current = e.touches[0].clientX
      }}
      onTouchEnd={(e) => {
        if (touchX.current == null) return
        const dx = e.changedTouches[0].clientX - touchX.current
        if (Math.abs(dx) > 40) setIndex(dx < 0 ? index + 1 : index - 1)
        touchX.current = null
      }}
      style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <button type="button" aria-label="Cerrar" onClick={onClose} style={{ position: 'absolute', top: 16, right: 16, width: 40, height: 40, borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,0.12)', color: 'var(--fg-inverse)', cursor: 'pointer', zIndex: 2 }}>
        <i className="iconoir-xmark" style={{ fontSize: 24 }} />
      </button>

      <img
        src={images[index].url}
        alt={images[index].alt ?? `${title} — imagen ${index + 1} de ${count}`}
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '92vw', maxHeight: '88vh', objectFit: 'contain', display: 'block' }}
      />

      {count > 1 && (
        <>
          <button
            type="button"
            aria-label="Imagen anterior"
            onClick={(e) => {
              e.stopPropagation()
              setIndex(index - 1)
            }}
            style={lbArrow('left')}
          >
            <i className="iconoir-nav-arrow-left" style={{ fontSize: 28 }} />
          </button>
          <button
            type="button"
            aria-label="Imagen siguiente"
            onClick={(e) => {
              e.stopPropagation()
              setIndex(index + 1)
            }}
            style={lbArrow('right')}
          >
            <i className="iconoir-nav-arrow-right" style={{ fontSize: 28 }} />
          </button>
          <div style={{ position: 'absolute', bottom: 20, left: 0, right: 0, textAlign: 'center', color: 'rgba(255,255,255,0.8)', fontSize: 13 }}>
            {index + 1} / {count}
          </div>
        </>
      )}
    </div>
  )
}
