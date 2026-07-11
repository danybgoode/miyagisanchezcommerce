'use client'

/**
 * Devoluciones (returns policy) — the first section extracted out of the
 * ShopSettings monolith. Behavior-preserving: the markup is verbatim from the
 * monolith's `#politicas` section, and it persists ONLY the `returns_policy`
 * slice through useSettingsSave() (the PATCH route deep-merges, so siblings are
 * untouched). Renders identically to the focused monolith view.
 */

import { useState } from 'react'
import { useSettingsSave } from '../_components/useSettingsSave'
import { Toast } from '@/components/feedback/Toast'
import { Banner } from '@/components/feedback/Banner'
import { Button } from '@/components/ui/Button'
import { SectionTitle } from '../_components/SectionTitle'
import type { ReturnsPolicySettings } from '@/lib/shop-settings/types'

export default function Devoluciones({ initial }: { initial?: ReturnsPolicySettings | null }) {
  const { save, saving, toast, dismissToast, isDirty, markDirty } = useSettingsSave()

  const [returnsWindow, setReturnsWindow]         = useState(initial?.window ?? '')
  const [returnsConditions, setReturnsConditions] = useState(initial?.conditions ?? 'original')
  const [returnsShippingBy, setReturnsShippingBy] = useState<'buyer' | 'seller'>(initial?.shipping_paid_by ?? 'buyer')
  const [returnsNote, setReturnsNote]             = useState(initial?.custom_note ?? '')

  const mark = markDirty

  async function handleSave() {
    await save({
      settings: {
        returns_policy: returnsWindow ? {
          window:           returnsWindow,
          conditions:       returnsConditions,
          shipping_paid_by: returnsShippingBy,
          custom_note:      returnsNote.trim() || null,
        } : null,
      },
    })
  }

  return (
    <div>
      <section id="politicas" className="border border-[var(--color-border)] rounded-[var(--r-lg)] p-5 mb-8">
        <SectionTitle>Política de devoluciones</SectionTitle>
        <p className="text-xs text-[var(--color-muted)] mb-5">
          Define claramente qué pasa cuando un comprador quiere devolver un artículo. Se mostrará en cada anuncio y durante el checkout.
        </p>

        {/* Return window */}
        <div className="mb-5">
          <p className="text-sm font-medium mb-1">Ventana de devolución</p>
          <p className="text-xs text-[var(--color-muted)] mb-3">
            Las ventanas de 14–30 días generan más confianza y menos disputas.
            {' '}<strong className="font-semibold text-[var(--color-text)]">Independientemente de tu política</strong>, los compradores siempre pueden abrir un caso si el artículo no es como se describió.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {[
              { key: '14d', label: '14 días', desc: 'Recomendado · genera confianza, reduce disputas' },
              { key: '30d', label: '30 días',  desc: 'Política amplia — ideal para artículos nuevos' },
              { key: '7d',  label: '7 días',   desc: 'Mínimo recomendado para artículos de segunda mano' },
              { key: 'none', label: 'Sin devoluciones', desc: 'Solo aceptas casos de artículo no conforme' },
            ].map(opt => (
              <button
                key={opt.key}
                type="button"
                onClick={() => { setReturnsWindow(opt.key); mark() }}
                className={`text-left p-3 rounded-[var(--r-md)] border-2 transition-colors ${
                  returnsWindow === opt.key
                    ? opt.key === 'none'
                      ? 'border-[var(--warning)] bg-[var(--warning-soft)]'
                      : 'border-[var(--color-accent)] bg-[var(--color-accent)]/5'
                    : 'border-[var(--color-border)] hover:border-[var(--color-accent)]/40'
                }`}
              >
                <p className={`text-sm font-semibold ${
                  returnsWindow === opt.key
                    ? opt.key === 'none' ? 'text-[var(--warning)]' : 'text-[var(--color-accent)]'
                    : ''
                }`}>{opt.label}</p>
                <p className="text-xs text-[var(--color-muted)] mt-0.5 leading-snug">{opt.desc}</p>
              </button>
            ))}
          </div>
          {!returnsWindow && (
            <Banner variant="warning" className="text-xs mt-3">
              Sin configurar — los compradores no verán ninguna política en tus anuncios.
            </Banner>
          )}
        </div>

        {/* Conditions + shipping — only when seller has chosen a positive return window */}
        {returnsWindow && returnsWindow !== 'none' && (
          <>
            <div className="border-t border-[var(--color-border)] pt-4 mb-4">
              <p className="text-sm font-medium mb-1">Condición aceptada</p>
              <p className="text-xs text-[var(--color-muted)] mb-3">¿En qué estado debe estar el artículo para aceptar la devolución?</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { key: 'original',  label: 'Estado original', desc: 'Sin uso, sin daños, con empaque original' },
                  { key: 'undamaged', label: 'Sin daños',       desc: 'Puede tener uso normal, pero sin roturas' },
                ].map(opt => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => { setReturnsConditions(opt.key); mark() }}
                    className={`text-left p-3 rounded-[var(--r-md)] border-2 transition-colors ${
                      returnsConditions === opt.key
                        ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/5'
                        : 'border-[var(--color-border)] hover:border-[var(--color-accent)]/40'
                    }`}
                  >
                    <p className={`text-sm font-semibold ${returnsConditions === opt.key ? 'text-[var(--color-accent)]' : ''}`}>{opt.label}</p>
                    <p className="text-xs text-[var(--color-muted)] mt-0.5 leading-snug">{opt.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            <div className="border-t border-[var(--color-border)] pt-4 mb-4">
              <p className="text-sm font-medium mb-1">Flete de devolución</p>
              <p className="text-xs text-[var(--color-muted)] mb-3">¿Quién paga el envío de regreso?</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { key: 'buyer',  label: 'El comprador', desc: 'El comprador paga el envío de regreso' },
                  { key: 'seller', label: 'Yo lo pago',   desc: 'Cubres el costo — genera más confianza' },
                ].map(opt => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => { setReturnsShippingBy(opt.key as 'buyer' | 'seller'); mark() }}
                    className={`text-left p-3 rounded-[var(--r-md)] border-2 transition-colors ${
                      returnsShippingBy === opt.key
                        ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/5'
                        : 'border-[var(--color-border)] hover:border-[var(--color-accent)]/40'
                    }`}
                  >
                    <p className={`text-sm font-semibold ${returnsShippingBy === opt.key ? 'text-[var(--color-accent)]' : ''}`}>{opt.label}</p>
                    <p className="text-xs text-[var(--color-muted)] mt-0.5 leading-snug">{opt.desc}</p>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Custom note */}
        <div className="border-t border-[var(--color-border)] pt-4">
          <p className="text-sm font-medium mb-1">Nota adicional <span className="font-normal text-[var(--color-muted)]">(opcional)</span></p>
          <p className="text-xs text-[var(--color-muted)] mb-2">Texto libre que aparecerá junto a tu política. Máx. 200 caracteres.</p>
          <textarea
            value={returnsNote}
            onChange={e => { if (e.target.value.length <= 200) { setReturnsNote(e.target.value); mark() } }}
            placeholder="Ej. Contáctame por WhatsApp para iniciar una devolución."
            rows={2}
            className="w-full text-sm border border-[var(--color-border)] rounded-[var(--r-sm)] px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/30 bg-[var(--bg-elevated)]"
          />
          <p className="text-xs text-[var(--color-muted)] text-right mt-0.5">{returnsNote.length}/200</p>
        </div>

        {/* Policy preview */}
        <div className="mt-4 p-3 bg-[var(--color-surface-alt)] border border-[var(--color-border)] rounded-[var(--r-md)]">
          <p className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wide mb-1">Vista previa en el anuncio</p>
          <p className="text-xs text-[var(--color-text)] leading-relaxed">
            {!returnsWindow
              ? <span className="text-[var(--color-muted)] italic">Sin configurar — no aparecerá ninguna política.</span>
              : returnsWindow === 'none'
                ? '— Sin política de devoluciones publicada.'
                : <>
                    <span style={{ background: 'var(--success-soft)', color: 'var(--success)', borderRadius: 'var(--r-pill)', padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>
                      ↩ Devoluciones: {returnsWindow === '7d' ? '7 días' : returnsWindow === '14d' ? '14 días' : '30 días'}
                    </span>
                    {' · condición '}
                    {returnsConditions === 'original' ? 'original' : 'sin daños'}
                    {' · flete por '}
                    {returnsShippingBy === 'buyer' ? 'el comprador' : 'el vendedor'}
                    {returnsNote.trim() && `. ${returnsNote.trim()}`}
                  </>
            }
          </p>
        </div>
      </section>

      {/* ── Save button ───────────────────────────────────────────────────── */}
      {/* Back affordance now lives in the top-of-page breadcrumb (<SellerBreadcrumb>). */}
      <div className="flex items-center justify-end mb-24">
        <Button type="button" variant="primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </Button>
      </div>

      {/* ── Sticky unsaved bar ────────────────────────────────────────────────── */}
      {isDirty && (
        <div className="fixed bottom-0 inset-x-0 z-40 bg-[var(--bg-elevated)] border-t border-[var(--color-border)] shadow-lg">
          <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
              <span className="w-2 h-2 rounded-[var(--r-pill)] bg-[var(--warning)] flex-shrink-0" />
              Tienes cambios sin guardar
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => window.location.reload()}>
                Descartar
              </Button>
              <Button type="button" variant="primary" size="sm" onClick={handleSave} disabled={saving}>
                {saving ? 'Guardando…' : 'Guardar'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast toast={toast} onDismiss={dismissToast} />}
    </div>
  )
}
