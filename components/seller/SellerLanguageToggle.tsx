'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { SELLER_LOCALE_COOKIE, type SellerLocale } from '@/lib/seller-locale'

const LABELS: Record<SellerLocale, string> = { es: 'ES', en: 'EN' }

/**
 * Each option is described IN THE LANGUAGE IT SWITCHES TO, on purpose — the
 * Wikipedia/Google convention. A merchant who cannot read the language the
 * portal is currently in is exactly the person who needs this control, and
 * translating both tooltips into the current locale would hide their own
 * language behind words they cannot read.
 *
 * These deliberately do NOT go through the seller dictionaries: the boundary
 * translates the portal into ONE language, and the whole point here is that the
 * two options stay in two different ones. They are paired with `lang` on the
 * button below so assistive tech pronounces each with the right voice instead of
 * reading Spanish through an English synthesiser.
 */
const TITLES: Record<SellerLocale, string> = {
  es: 'Cambiar idioma a español',
  en: 'Switch language to English',
}

/**
 * The seller portal's ES/EN switch.
 *
 * The choice is stored in a cookie rather than component state because the
 * decision is made on the SERVER — `shop/manage/layout.tsx` reads it to decide
 * whether to mount the copy boundary at all — so a client-only toggle would
 * either flash the wrong language or force the whole portal to render twice.
 * Writing the cookie and calling `router.refresh()` re-runs the layout with the
 * new preference and swaps the language in place, keeping scroll position.
 *
 * `max-age` is a year and the path is `/` so the preference survives navigation
 * out to a public shop page and back. It carries no personal data, which is why
 * it is a plain cookie and not a profile field: it must work on the very first
 * render, before any authenticated round-trip.
 */
/**
 * Write the preference cookie.
 *
 * A module function rather than an inline statement because
 * `react-hooks/immutability` (React Compiler) rejects assigning to anything
 * declared outside the component from inside it — `document` included. The write
 * is a genuine browser side effect, so moving it out is the honest shape, not a
 * lint dodge.
 *
 * `max-age` is a year and the path is `/` so the preference survives navigating
 * out to a public shop page and back.
 */
function persistSellerLocale(locale: SellerLocale): void {
  document.cookie = `${SELLER_LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`
}

export default function SellerLanguageToggle({ locale }: { locale: SellerLocale }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function choose(next: SellerLocale) {
    if (next === locale) return
    persistSellerLocale(next)
    startTransition(() => router.refresh())
  }

  return (
    <div
      role="group"
      aria-label={locale === 'en' ? 'Portal language' : 'Idioma del portal'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        borderRadius: 'var(--r-pill)',
        border: '1px solid color-mix(in srgb, var(--fg-inverse) 45%, transparent)',
        overflow: 'hidden',
        opacity: pending ? 0.6 : 1,
        flexShrink: 0,
      }}
    >
      {(['es', 'en'] as const).map((option) => {
        const active = option === locale
        return (
          <button
            key={option}
            type="button"
            onClick={() => choose(option)}
            aria-pressed={active}
            lang={option}
            title={TITLES[option]}
            style={{
              // 28px tall inside a 52px bar keeps the whole control inside the
              // 44px thumb target the surrounding row already reserves.
              minHeight: 28,
              padding: '0 10px',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.04em',
              lineHeight: 1,
              cursor: active ? 'default' : 'pointer',
              border: 'none',
              background: active ? 'var(--fg-inverse)' : 'transparent',
              color: active ? 'var(--accent)' : 'var(--fg-inverse)',
            }}
          >
            {LABELS[option]}
          </button>
        )
      })}
    </div>
  )
}
