'use client'

/**
 * Diseño y marca — the canonical `diseno` slug bundles the monolith's two
 * `#apariencia` + `#tipo` sections (logo, banner, slogan, brand color, social
 * links, and the store-type preset picker). Extracted verbatim, behavior-preserving.
 *
 * Persists the slice it owns through useSettingsSave():
 *   - top-level `logo_url` (the logo lives in the Apariencia block)
 *   - `settings.theme` (banner / accent / tagline / social)
 *   - `settings.preset` + the checkout/shipping fields a preset implies
 *     (escrow_mode / show_phone / whatsapp_cta / local_pickup). The PATCH route
 *     deep-merges, so writing those checkout/shipping keys preserves all the
 *     sibling money/shipping config the other sections own.
 */

import { useState, useRef } from 'react'
import { useSettingsSave } from '../_components/useSettingsSave'
import { Toast } from '@/components/feedback/Toast'
import { SectionTitle } from '../_components/SectionTitle'
import { SectionSaveBar } from '../_components/SectionSaveBar'
import { CopyPromptButton } from '../_components/CopyPromptButton'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { PRESETS } from '@/lib/shop-settings/helpers'
import { THEME_PRESETS, DEFAULT_THEME_PRESET_KEY } from '@/lib/shop-settings/theme-presets'
import { httpUrl } from '@/lib/settings-import'
import type { ThemeSettings, AnnouncementSettings, HeroSettings } from '@/lib/shop-settings/types'

export interface DisenoInitial {
  /** Read-only — used only to personalize the slogan AI prompt (name is edited in Perfil). */
  name: string
  logo_url: string | null
  theme: ThemeSettings | null
  preset: string | null
  escrow_mode: 'off' | 'optional' | 'required' | null
  show_phone: boolean | null
  phone: string | null
  whatsapp_cta: boolean | null
  local_pickup: boolean | null
  /** Own-shop premium presentation (epic 07, Sprint 1). */
  announcement: AnnouncementSettings | null
  hero: HeroSettings | null
  theme_preset: string | null
  /** The shop's own active listings — the hero "pinned listings" picker (Diseño-only for Sprint 1). */
  listings: Array<{ id: string; title: string; imageUrl: string | null }>
}

const ESCROW_LABEL = { off: 'Desactivada', optional: 'Opcional', required: 'Obligatoria' }

export default function Diseno({ initial }: { initial: DisenoInitial }) {
  const { save, saving, toast, showToast, dismissToast, isDirty, markDirty } = useSettingsSave()
  const mark = markDirty

  const t = initial.theme ?? {}
  const [logoUrl, setLogoUrl]         = useState<string | null>(initial.logo_url ?? null)
  const [bannerUrl, setBannerUrl]     = useState<string | null>(t.banner_url ?? null)
  const [accentColor, setAccentColor] = useState(t.accent_color ?? '#1d6f42')
  const [tagline, setTagline]         = useState(t.tagline ?? '')
  const [instagram, setInstagram]     = useState(t.social?.instagram ?? '')
  const [facebook, setFacebook]       = useState(t.social?.facebook ?? '')
  const [whatsappHandle, setWhatsappHandle] = useState(t.social?.whatsapp ?? '')
  const [tiktok, setTiktok]           = useState(t.social?.tiktok ?? '')
  const [logoUploading, setLogoUploading]     = useState(false)
  const [bannerUploading, setBannerUploading] = useState(false)
  const logoInputRef   = useRef<HTMLInputElement>(null)
  const bannerInputRef = useRef<HTMLInputElement>(null)

  // Store-type preset + the checkout/shipping fields it drives (shown in the
  // "Configuración aplicada" summary; mutated only via applyPreset).
  const [preset, setPreset]       = useState(initial.preset ?? 'basico')
  const [escrowMode, setEscrowMode] = useState<'off' | 'optional' | 'required'>(initial.escrow_mode ?? 'off')
  const [showPhone, setShowPhone] = useState(initial.show_phone === true && !!initial.phone)
  const [whatsappCta, setWhatsappCta] = useState(initial.whatsapp_cta === true && !!(t.social?.whatsapp))
  const [localPickup, setLocalPickup] = useState(initial.local_pickup ?? true)

  // Own-shop premium presentation (epic 07, Sprint 1) ────────────────────────
  const [announcementText, setAnnouncementText] = useState(initial.announcement?.text ?? '')
  const [announcementLink, setAnnouncementLink] = useState(initial.announcement?.link ?? '')

  const [heroMode, setHeroMode] = useState<'listings' | 'promo'>(initial.hero?.mode ?? 'listings')
  // Drop any pinned id that's no longer an active listing (unpublished/deleted
  // since it was pinned) — otherwise it silently occupies one of the 4 slots
  // with no way to see or free it, since the picker only renders `initial.listings`.
  const availableListingIds = new Set(initial.listings.map(l => l.id))
  const [heroPinnedIds, setHeroPinnedIds] = useState<string[]>(
    (initial.hero?.pinned_listing_ids ?? []).filter(id => availableListingIds.has(id)),
  )
  const [heroPromoImage, setHeroPromoImage] = useState(initial.hero?.promo_image_url ?? '')
  const [heroPromoCtaText, setHeroPromoCtaText] = useState(initial.hero?.promo_cta_text ?? '')
  const [heroPromoCtaLink, setHeroPromoCtaLink] = useState(initial.hero?.promo_cta_link ?? '')
  const [heroPromoUploading, setHeroPromoUploading] = useState(false)
  const heroPromoInputRef = useRef<HTMLInputElement>(null)

  const [themePreset, setThemePreset] = useState(initial.theme_preset ?? DEFAULT_THEME_PRESET_KEY)

  function togglePinnedListing(id: string) {
    setHeroPinnedIds(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id)
      if (prev.length >= 4) return prev
      return [...prev, id]
    })
    mark()
  }

  const activePreset = PRESETS.find(p => p.key === preset)

  async function uploadImage(file: File, onDone: (url: string) => void, setUploading: (v: boolean) => void) {
    if (file.size > 8 * 1024 * 1024) { showToast('La imagen es demasiado grande (máx. 8 MB).', 'error'); return }
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res  = await fetch('/api/sell/upload', { method: 'POST', body: fd })
      const data = await res.json() as { url?: string; error?: string }
      if (!res.ok || !data.url) { showToast(data.error ?? 'Error al subir imagen.', 'error'); return }
      onDone(data.url)
      mark()
    } catch {
      showToast('Sin conexión al subir imagen.', 'error')
    } finally {
      setUploading(false)
    }
  }

  function applyPreset(key: string) {
    const p = PRESETS.find(x => x.key === key)
    if (!p) return
    setPreset(key)
    const c  = p.settings.checkout ?? {}
    const sh = p.settings.shipping ?? {}
    if (c.escrow_mode)              setEscrowMode(c.escrow_mode)
    if (c.show_phone !== undefined) setShowPhone(c.show_phone)
    if (c.whatsapp_cta !== undefined) setWhatsappCta(c.whatsapp_cta)
    if (sh.local_pickup  !== undefined) setLocalPickup(sh.local_pickup)
    mark()
  }

  async function handleSave() {
    const hero: HeroSettings | null = heroMode === 'listings'
      ? (heroPinnedIds.length ? { mode: 'listings', pinned_listing_ids: heroPinnedIds } : null)
      : (heroPromoImage
        ? { mode: 'promo', promo_image_url: heroPromoImage, promo_cta_text: heroPromoCtaText.trim() || null, promo_cta_link: heroPromoCtaLink.trim() || null }
        : null)

    await save({
      logo_url: logoUrl,
      settings: {
        preset,
        checkout: {
          escrow_mode:  escrowMode,
          show_phone:   showPhone,
          whatsapp_cta: whatsappCta,
        },
        shipping: { local_pickup: localPickup },
        theme: {
          banner_url:   bannerUrl,
          accent_color: accentColor,
          tagline:      tagline.trim() || null,
          social: {
            instagram: instagram.trim().replace(/^@/, '') || null,
            facebook:  facebook.trim() || null,
            whatsapp:  whatsappHandle.trim().replace(/\D/g, '') || null,
            tiktok:    tiktok.trim().replace(/^@/, '') || null,
          },
        },
        announcement: announcementText.trim() ? { text: announcementText.trim(), link: announcementLink.trim() || null } : null,
        hero,
        theme_preset: themePreset === DEFAULT_THEME_PRESET_KEY ? null : themePreset,
      },
    })
  }

  return (
    <div>
      {/* ════════════════════════════════════════════════════════════════════
          Apariencia
      ════════════════════════════════════════════════════════════════════ */}
      <section id="apariencia" className="border border-[var(--color-border)] rounded-[var(--r-lg)] p-5 mb-5">
        <SectionTitle>Apariencia</SectionTitle>
        <p className="text-xs text-[var(--color-muted)] mb-5">
          Personaliza el aspecto de tu tienda pública: banner, logo, color y redes sociales.
        </p>

        {/* Banner */}
        <div className="mb-5">
          <label className="block text-sm font-medium mb-2">Banner de tienda</label>
          <div
            className="relative w-full h-28 rounded-[var(--r-md)] overflow-hidden border-2 border-dashed border-[var(--color-border)] bg-[var(--color-surface-alt)] flex items-center justify-center cursor-pointer hover:border-[var(--color-accent)] transition-colors"
            onClick={() => bannerInputRef.current?.click()}
            style={bannerUrl ? { backgroundImage: `url(${bannerUrl})`, backgroundSize: 'cover', backgroundPosition: 'center', borderStyle: 'solid' } : {}}
          >
            {bannerUploading ? (
              <span className="text-sm text-[var(--color-muted)] animate-pulse">Subiendo…</span>
            ) : bannerUrl ? (
              <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                <span className="text-white text-xs font-medium bg-black/50 px-3 py-1.5 rounded-[var(--r-sm)]">Cambiar banner</span>
              </div>
            ) : (
              <div className="text-center">
                <div className="text-2xl mb-1">🖼️</div>
                <div className="text-xs text-[var(--color-muted)]">Haz clic para subir banner</div>
                <div className="text-xs text-[var(--color-muted)]">Recomendado: 1200 × 300 px · máx. 8 MB</div>
              </div>
            )}
          </div>
          {bannerUrl && (
            <button type="button" onClick={() => { setBannerUrl(null); mark() }} className="text-xs text-[var(--danger)] hover:underline mt-1">
              Eliminar banner
            </button>
          )}
          <input ref={bannerInputRef} type="file" accept="image/*" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) uploadImage(f, setBannerUrl, setBannerUploading); e.target.value = '' }} />
        </div>

        {/* Logo */}
        <div className="mb-5">
          <label className="block text-sm font-medium mb-2">Logo de tienda</label>
          <div className="flex items-center gap-4">
            <div
              className="w-16 h-16 rounded-[var(--r-pill)] overflow-hidden border-2 border-dashed border-[var(--color-border)] bg-[var(--color-surface-alt)] flex items-center justify-center cursor-pointer hover:border-[var(--color-accent)] transition-colors flex-shrink-0"
              onClick={() => logoInputRef.current?.click()}
              style={logoUrl ? { backgroundImage: `url(${logoUrl})`, backgroundSize: 'cover', backgroundPosition: 'center', borderStyle: 'solid' } : {}}
            >
              {logoUploading ? (
                <span className="text-[10px] text-[var(--color-muted)] animate-pulse text-center px-1">…</span>
              ) : !logoUrl && (
                <span className="text-2xl">🏪</span>
              )}
            </div>
            <div>
              <button type="button" onClick={() => logoInputRef.current?.click()}
                className="text-sm text-[var(--color-accent)] hover:underline block">
                {logoUrl ? 'Cambiar logo' : 'Subir logo'}
              </button>
              {logoUrl && (
                <button type="button" onClick={() => { setLogoUrl(null); mark() }} className="text-xs text-[var(--danger)] hover:underline mt-1 block">
                  Eliminar logo
                </button>
              )}
              <p className="text-xs text-[var(--color-muted)] mt-1">Cuadrado · máx. 8 MB</p>
            </div>
          </div>
          <input ref={logoInputRef} type="file" accept="image/*" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) uploadImage(f, setLogoUrl, setLogoUploading); e.target.value = '' }} />
        </div>

        {/* Slogan */}
        <div className="mb-5">
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm font-medium">
              Slogan
              <span className={`ml-2 text-xs font-normal ${tagline.length > 85 ? 'text-[var(--warning)]' : 'text-[var(--color-muted)]'}`}>
                {tagline.length}/100
              </span>
            </label>
            <CopyPromptButton prompt={`Dame 5 opciones de slogan corto (máx. 100 caracteres cada uno) para mi tienda "${initial.name || 'mi tienda'}" en México. El slogan debe ser en español, memorable y reflejar lo que vendo. ${tagline ? `El slogan actual es: "${tagline}"` : ''}`} />
          </div>
          <input
            value={tagline}
            onChange={e => { setTagline(e.target.value); mark() }}
            maxLength={100}
            placeholder="El mejor lugar para encontrar piezas de colección"
            className="w-full border border-[var(--color-border)] rounded-[var(--r-sm)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
          />
        </div>

        {/* Color de marca */}
        <div className="mb-5">
          <label className="block text-sm font-medium mb-2">Color de marca</label>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={accentColor}
              onChange={e => { setAccentColor(e.target.value); mark() }}
              className="w-10 h-10 rounded-[var(--r-sm)] cursor-pointer border border-[var(--color-border)] p-0.5 bg-[var(--bg-elevated)]"
            />
            <div>
              <div className="text-sm font-mono">{accentColor}</div>
              <div className="text-xs text-[var(--color-muted)]">Se aplica en tu tienda pública</div>
            </div>
            <div
              className="ml-auto px-4 py-1.5 rounded-[var(--r-sm)] text-white text-xs font-medium"
              style={{ backgroundColor: accentColor }}
            >
              Vista previa
            </div>
          </div>
        </div>

        {/* Redes sociales */}
        <div>
          <label className="block text-sm font-medium mb-3">Redes sociales</label>
          <div className="space-y-2">
            {[
              { icon: '📸', label: 'Instagram', value: instagram,      set: setInstagram,      placeholder: '@tutienda' },
              { icon: '👥', label: 'Facebook',  value: facebook,       set: setFacebook,       placeholder: 'https://facebook.com/tutienda' },
              { icon: '💬', label: 'WhatsApp',  value: whatsappHandle, set: setWhatsappHandle, placeholder: '52 55 1234 5678' },
              { icon: '🎵', label: 'TikTok',    value: tiktok,         set: setTiktok,         placeholder: '@tutienda' },
            ].map(net => (
              <div key={net.label} className="flex items-center gap-2">
                <span className="text-lg w-7 flex-shrink-0 text-center">{net.icon}</span>
                <span className="text-xs text-[var(--color-muted)] w-20 flex-shrink-0">{net.label}</span>
                <input
                  value={net.value}
                  onChange={e => { net.set(e.target.value); mark() }}
                  placeholder={net.placeholder}
                  className="flex-1 border border-[var(--color-border)] rounded-[var(--r-sm)] px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          Anuncio — announcement bar (own-shop premium presentation, Sprint 1)
      ════════════════════════════════════════════════════════════════════ */}
      <section id="anuncio" className="border border-[var(--color-border)] rounded-[var(--r-lg)] p-5 mb-5">
        <SectionTitle>Anuncio</SectionTitle>
        <p className="text-xs text-[var(--color-muted)] mb-4">
          Una barra corta arriba de tu tienda, con un enlace opcional. Déjala vacía para no mostrar nada.
        </p>
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm font-medium">
              Texto
              <span className={`ml-2 text-xs font-normal ${announcementText.length > 120 ? 'text-[var(--warning)]' : 'text-[var(--color-muted)]'}`}>
                {announcementText.length}/140
              </span>
            </label>
          </div>
          <input
            value={announcementText}
            onChange={e => { setAnnouncementText(e.target.value.slice(0, 140)); mark() }}
            maxLength={140}
            placeholder="Envío gratis desde $500 · Entrega urgente disponible"
            className="w-full border border-[var(--color-border)] rounded-[var(--r-sm)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Enlace (opcional)</label>
          <input
            value={announcementLink}
            onChange={e => { setAnnouncementLink(e.target.value); mark() }}
            placeholder="https://…"
            className="w-full border border-[var(--color-border)] rounded-[var(--r-sm)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
          />
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          Destacados — hero/featured section (own-shop premium presentation, Sprint 1)
      ════════════════════════════════════════════════════════════════════ */}
      <section id="destacados" className="border border-[var(--color-border)] rounded-[var(--r-lg)] p-5 mb-5">
        <SectionTitle>Destacados</SectionTitle>
        <p className="text-xs text-[var(--color-muted)] mb-4">
          Muestra tus mejores anuncios o una imagen promocional arriba de la cuadrícula de tu tienda.
        </p>
        <div className="flex gap-2 mb-4">
          <button
            type="button"
            onClick={() => { setHeroMode('listings'); mark() }}
            className={`flex-1 text-sm font-medium py-2 rounded-[var(--r-md)] border-2 ${heroMode === 'listings' ? 'border-[var(--color-accent)] text-[var(--color-accent)]' : 'border-[var(--color-border)] text-[var(--color-muted)]'}`}
          >
            Anuncios fijados
          </button>
          <button
            type="button"
            onClick={() => { setHeroMode('promo'); mark() }}
            className={`flex-1 text-sm font-medium py-2 rounded-[var(--r-md)] border-2 ${heroMode === 'promo' ? 'border-[var(--color-accent)] text-[var(--color-accent)]' : 'border-[var(--color-border)] text-[var(--color-muted)]'}`}
          >
            Imagen promocional
          </button>
        </div>

        {heroMode === 'listings' ? (
          initial.listings.length === 0 ? (
            <p className="text-xs text-[var(--color-muted)]">Aún no tienes anuncios activos para fijar.</p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {initial.listings.map(l => {
                const selected = heroPinnedIds.includes(l.id)
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => togglePinnedListing(l.id)}
                    className={`relative text-left rounded-[var(--r-md)] overflow-hidden border-2 ${selected ? 'border-[var(--color-accent)]' : 'border-transparent'}`}
                  >
                    {l.imageUrl ? (
                      <img src={l.imageUrl} alt={l.title} className="w-full h-16 object-cover" />
                    ) : (
                      <div className="w-full h-16 bg-[var(--color-surface-alt)] flex items-center justify-center text-lg">📦</div>
                    )}
                    <p className="text-[10px] px-1 py-0.5 line-clamp-1">{l.title}</p>
                    {selected && (
                      <span className="absolute top-1 right-1 w-4 h-4 rounded-[var(--r-pill)] bg-[var(--color-accent)] text-white text-[10px] flex items-center justify-center">✓</span>
                    )}
                  </button>
                )
              })}
            </div>
          )
        ) : (
          <div className="space-y-3">
            <div
              className="relative w-full h-28 rounded-[var(--r-md)] overflow-hidden border-2 border-dashed border-[var(--color-border)] bg-[var(--color-surface-alt)] flex items-center justify-center cursor-pointer hover:border-[var(--color-accent)] transition-colors"
              onClick={() => heroPromoInputRef.current?.click()}
              style={httpUrl(heroPromoImage) ? { backgroundImage: `url(${httpUrl(heroPromoImage)})`, backgroundSize: 'cover', backgroundPosition: 'center', borderStyle: 'solid' } : {}}
            >
              {heroPromoUploading ? (
                <span className="text-sm text-[var(--color-muted)] animate-pulse">Subiendo…</span>
              ) : !heroPromoImage && (
                <div className="text-center">
                  <div className="text-2xl mb-1">🖼️</div>
                  <div className="text-xs text-[var(--color-muted)]">Haz clic para subir imagen</div>
                </div>
              )}
            </div>
            <input ref={heroPromoInputRef} type="file" accept="image/*" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) uploadImage(f, setHeroPromoImage, setHeroPromoUploading); e.target.value = '' }} />
            <input
              value={heroPromoCtaText}
              onChange={e => { setHeroPromoCtaText(e.target.value); mark() }}
              placeholder="Texto del botón (ej. Ver colección)"
              className="w-full border border-[var(--color-border)] rounded-[var(--r-sm)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            />
            <input
              value={heroPromoCtaLink}
              onChange={e => { setHeroPromoCtaLink(e.target.value); mark() }}
              placeholder="Enlace del botón (https://…)"
              className="w-full border border-[var(--color-border)] rounded-[var(--r-sm)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            />
          </div>
        )}
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          Tema — curated visual preset (own-shop premium presentation, Sprint 1)
      ════════════════════════════════════════════════════════════════════ */}
      <section id="tema" className="border border-[var(--color-border)] rounded-[var(--r-lg)] p-5 mb-5">
        <SectionTitle>Tema</SectionTitle>
        <p className="text-xs text-[var(--color-muted)] mb-4">
          Un preset de tipografía y tono de superficie sobre tu color de marca y banner (que no cambian).
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {THEME_PRESETS.map(p => (
            <button
              key={p.key}
              type="button"
              onClick={() => { setThemePreset(p.key); mark() }}
              title={p.description}
              className={`text-left p-3 rounded-[var(--r-md)] border-2 transition-all ${
                themePreset === p.key
                  ? 'border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent)_8%,white)]'
                  : 'border-[var(--color-border)] hover:border-[var(--color-accent)] hover:bg-gray-50'
              }`}
            >
              <div className="text-sm font-semibold">{p.label}</div>
              <div className="text-xs text-[var(--color-muted)] mt-0.5 leading-snug line-clamp-2">{p.description}</div>
            </button>
          ))}
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          Tipo de tienda
      ════════════════════════════════════════════════════════════════════ */}
      <section id="tipo" className="border border-[var(--color-border)] rounded-[var(--r-lg)] p-5 mb-5">
        <SectionTitle>Tipo de tienda</SectionTitle>
        <p className="text-xs text-[var(--color-muted)] mb-4">
          Pre-configura el comportamiento de checkout y envíos según lo que vendes. Puedes ajustar cada opción individualmente más adelante.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {PRESETS.map(p => (
            <button
              key={p.key}
              type="button"
              onClick={() => applyPreset(p.key)}
              title={p.description}
              className={`text-left p-3 rounded-[var(--r-md)] border-2 transition-all ${
                preset === p.key
                  ? 'border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent)_8%,white)]'
                  : 'border-[var(--color-border)] hover:border-[var(--color-accent)] hover:bg-gray-50'
              }`}
            >
              <div className="text-xl mb-1">{p.icon}</div>
              <div className="text-sm font-semibold">{p.label}</div>
              <div className="text-xs text-[var(--color-muted)] mt-0.5 leading-snug line-clamp-2">{p.description}</div>
              {preset === p.key && (
                <div className="text-[10px] text-[var(--color-accent)] font-semibold mt-1 uppercase tracking-wide">Activo</div>
              )}
            </button>
          ))}
        </div>

        {/* Active preset summary */}
        {activePreset && (
          <div className="mt-3 pt-3 border-t border-[var(--color-border)]">
            <p className="text-xs text-[var(--color-muted)] mb-2 font-medium">Configuración aplicada:</p>
            <div className="flex flex-wrap gap-1.5">
              <StatusBadge token={escrowMode === 'off' ? 'neutral' : escrowMode === 'optional' ? 'warning' : 'success'}>
                Compra Protegida: {ESCROW_LABEL[escrowMode]}
              </StatusBadge>
              <StatusBadge token={localPickup ? 'info' : 'neutral'}>
                Entrega en mano: {localPickup ? 'Sí' : 'No'}
              </StatusBadge>
              <StatusBadge token={showPhone ? 'info' : 'neutral'}>
                Teléfono visible: {showPhone ? 'Sí' : 'No'}
              </StatusBadge>
            </div>
          </div>
        )}
      </section>

      <SectionSaveBar saving={saving} isDirty={isDirty} onSave={handleSave} />

      {toast && <Toast toast={toast} onDismiss={dismissToast} />}
    </div>
  )
}
