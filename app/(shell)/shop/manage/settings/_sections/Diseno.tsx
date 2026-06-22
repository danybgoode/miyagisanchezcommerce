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
import { Toast } from '../_components/Toast'
import { SectionTitle } from '../_components/SectionTitle'
import { SectionSaveBar } from '../_components/SectionSaveBar'
import { CopyPromptButton } from '../_components/CopyPromptButton'
import { PRESETS } from '@/lib/shop-settings/helpers'
import type { ThemeSettings } from '@/lib/shop-settings/types'

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
      },
    })
  }

  return (
    <div>
      {/* ════════════════════════════════════════════════════════════════════
          Apariencia
      ════════════════════════════════════════════════════════════════════ */}
      <section id="apariencia" className="border border-[var(--color-border)] rounded-xl p-5 mb-5">
        <SectionTitle>Apariencia</SectionTitle>
        <p className="text-xs text-[var(--color-muted)] mb-5">
          Personaliza el aspecto de tu tienda pública: banner, logo, color y redes sociales.
        </p>

        {/* Banner */}
        <div className="mb-5">
          <label className="block text-sm font-medium mb-2">Banner de tienda</label>
          <div
            className="relative w-full h-28 rounded-lg overflow-hidden border-2 border-dashed border-[var(--color-border)] bg-[var(--color-surface-alt)] flex items-center justify-center cursor-pointer hover:border-[var(--color-accent)] transition-colors"
            onClick={() => bannerInputRef.current?.click()}
            style={bannerUrl ? { backgroundImage: `url(${bannerUrl})`, backgroundSize: 'cover', backgroundPosition: 'center', borderStyle: 'solid' } : {}}
          >
            {bannerUploading ? (
              <span className="text-sm text-[var(--color-muted)] animate-pulse">Subiendo…</span>
            ) : bannerUrl ? (
              <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                <span className="text-white text-xs font-medium bg-black/50 px-3 py-1.5 rounded">Cambiar banner</span>
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
            <button type="button" onClick={() => { setBannerUrl(null); mark() }} className="text-xs text-red-600 hover:underline mt-1">
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
              className="w-16 h-16 rounded-full overflow-hidden border-2 border-dashed border-[var(--color-border)] bg-[var(--color-surface-alt)] flex items-center justify-center cursor-pointer hover:border-[var(--color-accent)] transition-colors flex-shrink-0"
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
                <button type="button" onClick={() => { setLogoUrl(null); mark() }} className="text-xs text-red-600 hover:underline mt-1 block">
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
              <span className={`ml-2 text-xs font-normal ${tagline.length > 85 ? 'text-amber-600' : 'text-[var(--color-muted)]'}`}>
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
            className="w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
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
              className="w-10 h-10 rounded cursor-pointer border border-[var(--color-border)] p-0.5 bg-white"
            />
            <div>
              <div className="text-sm font-mono">{accentColor}</div>
              <div className="text-xs text-[var(--color-muted)]">Se aplica en tu tienda pública</div>
            </div>
            <div
              className="ml-auto px-4 py-1.5 rounded text-white text-xs font-medium"
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
                  className="flex-1 border border-[var(--color-border)] rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          Tipo de tienda
      ════════════════════════════════════════════════════════════════════ */}
      <section id="tipo" className="border border-[var(--color-border)] rounded-xl p-5 mb-5">
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
              className={`text-left p-3 rounded-lg border-2 transition-all ${
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
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                escrowMode === 'off' ? 'bg-gray-100 text-gray-600' :
                escrowMode === 'optional' ? 'bg-amber-100 text-amber-700' :
                'bg-green-100 text-green-700'
              }`}>
                Compra Protegida: {ESCROW_LABEL[escrowMode]}
              </span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${localPickup ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                Entrega en mano: {localPickup ? 'Sí' : 'No'}
              </span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${showPhone ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                Teléfono visible: {showPhone ? 'Sí' : 'No'}
              </span>
            </div>
          </div>
        )}
      </section>

      <SectionSaveBar saving={saving} isDirty={isDirty} onSave={handleSave} />

      {toast && <Toast toast={toast} onDismiss={dismissToast} />}
    </div>
  )
}
