import { requireMarket, type MarketCode } from './markets'
import type { Locale } from './dictionary'

export interface MarketPresentation {
  readonly market: MarketCode
  /** BCP-47 language tag for server-rendered HTML and hreflang. */
  readonly htmlLang: string
  /** Dictionary key. Presentation only; never a commerce selector. */
  readonly language: Locale
  /** Display currency copied from the authoritative market record. */
  readonly currency: 'MXN' | 'USD'
  /** IANA timezone copied from the authoritative market record. */
  readonly timezone: string
}

/**
 * Dictionary language is the one presentation decision the registry does not
 * type narrowly itself. Keep it total over MarketCode so adding a market makes
 * the compiler demand an explicit language choice.
 */
const LANGUAGE_BY_MARKET: Readonly<Record<MarketCode, Locale>> = Object.freeze({
  mx: 'es',
  us: 'en',
})

/**
 * Resolve every presentation fact from a MARKET, never from a browser locale.
 * Currency and timezone remain fields of the market record; the language table
 * cannot influence channel, payment, fulfillment, or publication decisions.
 */
export function resolveMarketPresentation(value: unknown): MarketPresentation {
  const market = requireMarket(value)
  return Object.freeze({
    market: market.code,
    htmlLang: market.default_locale,
    language: LANGUAGE_BY_MARKET[market.code],
    currency: market.currency_code.toUpperCase() as MarketPresentation['currency'],
    timezone: market.timezone,
  })
}

export function formatPresentationCurrency(
  presentation: MarketPresentation,
  cents: number,
  currency: string,
  options: Intl.NumberFormatOptions = {},
): string {
  return new Intl.NumberFormat(presentation.htmlLang, {
    style: 'currency',
    currency: currency.toUpperCase(),
    ...options,
  }).format(cents / 100)
}

/**
 * Format an amount for an order, receipt, refund or email, from the amount's OWN
 * currency (us-marketplace S4.3 / D9).
 *
 * Order surfaces have no `MarketPresentation` in hand — they have an order row with a
 * `currency_code`. Before this they passed that currency to a HARDCODED `es-MX`
 * locale, which renders USD as `USD 12` rather than `$12.50`: a Mexican decimal
 * convention, a currency code where a US buyer expects a symbol, and — because those
 * call sites also pass `maximumFractionDigits: 0` — no cents at all. Rounding a
 * $12.50 receipt to `$13` is not a formatting nit; it is a receipt that disagrees with
 * the card statement.
 *
 * So the locale follows the money and cents are preserved for USD. MXN keeps its
 * whole-peso convention, which is what every existing call site asked for and what
 * `/mx` must keep showing.
 */
export function formatOrderCurrency(
  cents: number,
  currency: string | null | undefined,
  options: Intl.NumberFormatOptions = {},
): string {
  const code = (typeof currency === 'string' && currency.trim() ? currency : 'MXN').trim().toUpperCase()
  const presentation = resolveMarketPresentation(code === 'USD' ? 'us' : 'mx')
  return formatPresentationCurrency(presentation, cents, code, {
    // Whole pesos as before; real cents for dollars.
    maximumFractionDigits: code === 'MXN' ? 0 : 2,
    ...options,
  })
}

export function formatPresentationDate(
  presentation: MarketPresentation,
  value: string | number | Date,
  options: Intl.DateTimeFormatOptions = {},
): string {
  return new Intl.DateTimeFormat(presentation.htmlLang, {
    timeZone: presentation.timezone,
    ...options,
  }).format(new Date(value))
}

/** ISO calendar date in the market timezone, suitable for native date inputs. */
export function presentationCalendarDate(
  presentation: MarketPresentation,
  value: string | number | Date,
): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: presentation.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}
