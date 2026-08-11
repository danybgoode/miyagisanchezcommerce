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
