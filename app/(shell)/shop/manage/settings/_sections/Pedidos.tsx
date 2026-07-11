'use client'

/**
 * Gestión de pedidos — processing time, auto-confirm, dispatch + auto-confirm
 * windows. Extracted verbatim from the monolith's `#pedidos` section. Persists
 * only `settings.orders` through useSettingsSave(); behavior-preserving.
 */

import { useState } from 'react'
import { useSettingsSave } from '../_components/useSettingsSave'
import { Toast } from '@/components/feedback/Toast'
import { SectionTitle } from '../_components/SectionTitle'
import { SectionSaveBar } from '../_components/SectionSaveBar'
import { ToggleSwitch } from '../_components/ToggleSwitch'
import type { OrdersSettings } from '@/lib/shop-settings/types'

export default function Pedidos({ initial }: { initial: OrdersSettings | null }) {
  const { save, saving, toast, dismissToast, isDirty, markDirty } = useSettingsSave()
  const mark = markDirty

  const o = initial ?? {}
  const [processingTime, setProcessingTime]         = useState(o.processing_time ?? '1-3d')
  const [autoAccept, setAutoAccept]                 = useState(o.auto_accept ?? true)
  const [dispatchWindowDays, setDispatchWindowDays] = useState(o.dispatch_window_days ?? 3)
  const [autoConfirmDays, setAutoConfirmDays]       = useState(o.auto_confirm_days ?? 7)

  async function handleSave() {
    await save({
      settings: {
        orders: {
          processing_time:      processingTime,
          auto_accept:          autoAccept,
          dispatch_window_days: dispatchWindowDays,
          auto_confirm_days:    autoConfirmDays,
        },
      },
    })
  }

  return (
    <div>
      <section id="pedidos" className="border border-[var(--color-border)] rounded-[var(--r-lg)] p-5 mb-5">
        <SectionTitle>Gestión de pedidos</SectionTitle>
        <p className="text-xs text-[var(--color-muted)] mb-5">
          Estas preferencias se muestran a los compradores en el anuncio y al finalizar su compra.
        </p>

        {/* Processing time */}
        <div className="mb-5">
          <p className="text-sm font-medium mb-1">Tiempo de procesamiento</p>
          <p className="text-xs text-[var(--color-muted)] mb-3">¿Cuánto tardas en preparar y enviar un pedido?</p>
          <div className="grid grid-cols-2 gap-2">
            {[
              { key: '1d',   label: '1 día hábil',      desc: 'Ideal para artículos listos para enviar' },
              { key: '1-3d', label: '1–3 días hábiles', desc: 'Estándar para la mayoría de tiendas' },
              { key: '3-5d', label: '3–5 días hábiles', desc: 'Para artículos hechos a mano o stock bajo' },
              { key: '1-2w', label: '1–2 semanas',      desc: 'Artículos por encargo o personalizados' },
            ].map(opt => (
              <button
                key={opt.key}
                type="button"
                onClick={() => { setProcessingTime(opt.key); mark() }}
                className={`text-left p-3 rounded-[var(--r-md)] border-2 transition-colors ${
                  processingTime === opt.key
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/5'
                    : 'border-[var(--color-border)] hover:border-[var(--color-accent)]/40'
                }`}
              >
                <p className={`text-sm font-semibold ${processingTime === opt.key ? 'text-[var(--color-accent)]' : ''}`}>{opt.label}</p>
                <p className="text-xs text-[var(--color-muted)] mt-0.5 leading-snug">{opt.desc}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Auto-accept */}
        <div className="border-t border-[var(--color-border)] pt-4 mb-4">
          <ToggleSwitch
            checked={autoAccept}
            onChange={v => { setAutoAccept(v); mark() }}
            label="Confirmación automática"
            description="Acepta pedidos al instante sin revisión manual. Desactívalo si necesitas aprobar cada pedido antes de procesar el pago."
          />
        </div>

        {/* Dispatch window */}
        <div className="border-t border-[var(--color-border)] pt-4 mb-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Ventana de despacho</p>
              <p className="text-xs text-[var(--color-muted)] mt-0.5">Días disponibles para preparar el envío tras recibir el pedido</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={() => { setDispatchWindowDays(Math.max(1, dispatchWindowDays - 1)); mark() }}
                className="w-7 h-7 rounded-[var(--r-pill)] border border-[var(--color-border)] flex items-center justify-center text-sm hover:bg-[var(--color-surface-alt)] transition-colors"
              >−</button>
              <span className="w-10 text-center text-sm font-semibold tabular-nums">{dispatchWindowDays}d</span>
              <button
                type="button"
                onClick={() => { setDispatchWindowDays(Math.min(14, dispatchWindowDays + 1)); mark() }}
                className="w-7 h-7 rounded-[var(--r-pill)] border border-[var(--color-border)] flex items-center justify-center text-sm hover:bg-[var(--color-surface-alt)] transition-colors"
              >+</button>
            </div>
          </div>
        </div>

        {/* Auto-confirm delivery */}
        <div className="border-t border-[var(--color-border)] pt-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Confirmación automática de entrega</p>
              <p className="text-xs text-[var(--color-muted)] mt-0.5">Si el comprador no confirma la entrega, el pedido se cierra automáticamente</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={() => { setAutoConfirmDays(Math.max(3, autoConfirmDays - 1)); mark() }}
                className="w-7 h-7 rounded-[var(--r-pill)] border border-[var(--color-border)] flex items-center justify-center text-sm hover:bg-[var(--color-surface-alt)] transition-colors"
              >−</button>
              <span className="w-16 text-center text-sm font-semibold tabular-nums">{autoConfirmDays} días</span>
              <button
                type="button"
                onClick={() => { setAutoConfirmDays(Math.min(30, autoConfirmDays + 1)); mark() }}
                className="w-7 h-7 rounded-[var(--r-pill)] border border-[var(--color-border)] flex items-center justify-center text-sm hover:bg-[var(--color-surface-alt)] transition-colors"
              >+</button>
            </div>
          </div>
        </div>

        {/* Inbox link */}
        <div className="mt-5 pt-4 border-t border-[var(--color-border)] flex items-center justify-between">
          <p className="text-xs text-[var(--color-muted)]">Ver y gestionar tus pedidos activos</p>
          <a href="/shop/manage/orders" className="text-xs font-semibold text-[var(--color-accent)] no-underline hover:underline flex items-center gap-1">
            Ir a pedidos →
          </a>
        </div>
      </section>

      <SectionSaveBar saving={saving} isDirty={isDirty} onSave={handleSave} />

      {toast && <Toast toast={toast} onDismiss={dismissToast} />}
    </div>
  )
}
