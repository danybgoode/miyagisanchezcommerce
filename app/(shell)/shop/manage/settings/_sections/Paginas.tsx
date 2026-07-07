'use client'

/**
 * Acerca y preguntas frecuentes (own-shop premium presentation, epic 07,
 * Sprint 3) — the shop's public Acerca (about) body and FAQ pairs. Persists
 * `settings.about` / `settings.faq` through useSettingsSave(); Políticas is
 * DELIBERATELY not editable here — the public Políticas page merchandises the
 * existing Devoluciones (`returns_policy`) setting instead, so this section
 * only links to it (never a second, driftable editor).
 */

import { useState } from 'react'
import { useSettingsSave } from '../_components/useSettingsSave'
import { Toast } from '../_components/Toast'
import { SectionTitle } from '../_components/SectionTitle'
import { SectionSaveBar } from '../_components/SectionSaveBar'
import type { AboutSettings, FaqSettings } from '@/lib/shop-settings/types'

const ABOUT_MAX = 600
const FAQ_MAX_ITEMS = 12
const FAQ_QUESTION_MAX = 140
const FAQ_ANSWER_MAX = 600

type FaqRow = { question: string; answer: string }

export default function Paginas({
  initial,
  returnsConfigured,
}: {
  initial?: { about: AboutSettings | null; faq: FaqSettings | null }
  /** Whether Devoluciones already has a window set — for the Políticas preview note. */
  returnsConfigured: boolean
}) {
  const { save, saving, toast, dismissToast, isDirty, markDirty } = useSettingsSave()
  const mark = markDirty

  const [aboutBody, setAboutBody] = useState(initial?.about?.body ?? '')
  const [faqItems, setFaqItems] = useState<FaqRow[]>(initial?.faq?.items ?? [])

  function addFaqRow() {
    if (faqItems.length >= FAQ_MAX_ITEMS) return
    setFaqItems([...faqItems, { question: '', answer: '' }])
    mark()
  }

  function removeFaqRow(index: number) {
    setFaqItems(faqItems.filter((_, i) => i !== index))
    mark()
  }

  function updateFaqRow(index: number, field: keyof FaqRow, value: string) {
    setFaqItems(faqItems.map((row, i) => (i === index ? { ...row, [field]: value } : row)))
    mark()
  }

  async function handleSave() {
    const trimmedBody = aboutBody.trim()
    const cleanFaq = faqItems
      .map((row) => ({ question: row.question.trim(), answer: row.answer.trim() }))
      .filter((row) => row.question && row.answer)

    await save({
      settings: {
        about: trimmedBody ? { body: trimmedBody } : null,
        faq: cleanFaq.length ? { items: cleanFaq } : null,
      },
    })
  }

  return (
    <div>
      <section id="acerca" className="border border-[var(--color-border)] rounded-xl p-5 mb-5">
        <SectionTitle>Acerca de tu tienda</SectionTitle>
        <p className="text-xs text-[var(--color-muted)] mb-3">
          Cuenta tu historia — quién eres, qué vendes y por qué. Se muestra en tu página pública de Acerca.
        </p>
        <textarea
          value={aboutBody}
          onChange={(e) => { if (e.target.value.length <= ABOUT_MAX) { setAboutBody(e.target.value); mark() } }}
          placeholder="Ej. Somos una tienda familiar en Monterrey especializada en calcomanías y stickers desde 2019…"
          rows={5}
          className="w-full text-sm border border-[var(--color-border)] rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/30 bg-white"
        />
        <p className="text-xs text-[var(--color-muted)] text-right mt-0.5">{aboutBody.length}/{ABOUT_MAX}</p>
        {!aboutBody.trim() && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2">
            Sin configurar — el enlace "Acerca" no aparecerá en tu tienda.
          </p>
        )}
      </section>

      <section className="border border-[var(--color-border)] rounded-xl p-5 mb-5">
        <SectionTitle>Preguntas frecuentes</SectionTitle>
        <p className="text-xs text-[var(--color-muted)] mb-4">
          Responde las dudas que más te repiten los compradores. Se muestran en tu página pública de FAQ.
        </p>

        {faqItems.map((row, i) => (
          <div key={i} className="border border-[var(--color-border)] rounded-lg p-3 mb-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-[var(--color-muted)]">Pregunta {i + 1}</p>
              <button
                type="button"
                onClick={() => removeFaqRow(i)}
                className="text-xs text-red-600 hover:underline"
              >
                Eliminar
              </button>
            </div>
            <input
              type="text"
              value={row.question}
              onChange={(e) => { if (e.target.value.length <= FAQ_QUESTION_MAX) updateFaqRow(i, 'question', e.target.value) }}
              placeholder="¿Cuánto tarda el envío?"
              className="w-full text-sm border border-[var(--color-border)] rounded-lg px-3 py-2 mb-2 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/30 bg-white"
            />
            <textarea
              value={row.answer}
              onChange={(e) => { if (e.target.value.length <= FAQ_ANSWER_MAX) updateFaqRow(i, 'answer', e.target.value) }}
              placeholder="Entre 3 y 5 días hábiles dentro de la República."
              rows={2}
              className="w-full text-sm border border-[var(--color-border)] rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/30 bg-white"
            />
          </div>
        ))}

        {faqItems.length === 0 && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
            Sin preguntas todavía — el enlace "Preguntas frecuentes" no aparecerá en tu tienda.
          </p>
        )}

        <button
          type="button"
          onClick={addFaqRow}
          disabled={faqItems.length >= FAQ_MAX_ITEMS}
          className="text-sm font-semibold text-[var(--color-accent)] hover:underline disabled:opacity-50 disabled:no-underline"
        >
          + Agregar pregunta {faqItems.length >= FAQ_MAX_ITEMS ? `(máx. ${FAQ_MAX_ITEMS})` : ''}
        </button>
      </section>

      {/* Políticas — read-only preview, no second editor. */}
      <section className="border border-[var(--color-border)] rounded-xl p-5 mb-5 bg-[var(--color-surface-alt)]">
        <SectionTitle>Políticas</SectionTitle>
        <p className="text-xs text-[var(--color-muted)]">
          Tu página pública de Políticas se muestra automáticamente desde tu{' '}
          <a href="/shop/manage/settings/politicas" className="font-semibold text-[var(--color-accent)] no-underline hover:underline">
            Política de devoluciones
          </a>
          {returnsConfigured
            ? ' — ya está configurada.'
            : ' — aún no está configurada, así que el enlace "Políticas" no aparecerá en tu tienda.'}
        </p>
      </section>

      <SectionSaveBar saving={saving} isDirty={isDirty} onSave={handleSave} />

      {toast && <Toast toast={toast} onDismiss={dismissToast} />}
    </div>
  )
}
