import type { SellerLocale } from './seller-locale'
import { MARKETS, type MarketCode } from './markets'

/**
 * seller-format.ts — how the seller portal renders a NUMBER, a DATE and a PRICE.
 *
 * The portal's ES/EN switch (`seller-locale.ts`) substitutes text nodes through
 * `SellerCopyBoundary`, and a formatted number has no letters to substitute — it
 * is excluded from the generated population by design. So ~30 call sites went on
 * hardcoding `es-MX` and an English portal still said "15 ago 2026" and
 * "USD 1,234". This module is the seam those call sites move onto.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ONE RULE: three separate facts, never collapsed into each other.
 *
 *   locale    — the LANGUAGE the merchant chose to read. Decides word order,
 *               month names, grouping and decimal marks. Nothing else.
 *   currency  — the CODE the money is denominated in. A fact of the shop's
 *               MARKET (and of the row being rendered), never of the language.
 *               An MX merchant reading English still prices in MXN.
 *   timeZone  — the wall clock an operator schedules against. Also a fact of the
 *               market (`MARKETS[code].timezone`), never of the language.
 *
 * Collapsing locale into currency is how you silently redenominate a shop: the
 * amount would keep its digits and change its meaning. That is why `money()`
 * takes the currency as an ARGUMENT and the locale only from the context — the
 * two can never be read off one variable.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * PURE ON PURPOSE. No React, no `next`, no env reads, no module-level mutable
 * state — so every branch is reachable from the `api` Playwright project with no
 * browser and no network, and the same factory serves a client component (via
 * `useSellerFormat`) and a server component (called directly).
 */

/** The money a shop can be denominated in. Uppercase ISO-4217, as `Intl` wants it. */
export type SellerCurrency = 'MXN' | 'USD'

/**
 * Language → the BCP-47 tag actually handed to `Intl`.
 *
 * `es` maps to `es-MX` and not bare `es` because es-MX IS the tag every call site
 * hardcoded before this module existed, and Spanish is the portal's authored
 * identity case: the Spanish render must come out byte for byte unchanged. A bare
 * `es` would quietly move month abbreviations and grouping to Spain's conventions.
 *
 * This table is deliberately NOT derived from `MARKETS[…].default_locale`. That
 * field is a fact about a MARKET, and reading it here would reintroduce exactly
 * the market→language coupling `resolveSellerLocale` exists to break — a US shop
 * set to Spanish would come back `en-US`.
 */
const BCP47_BY_LOCALE: Readonly<Record<SellerLocale, string>> = Object.freeze({
  es: 'es-MX',
  en: 'en-US',
})

export interface SellerFormatContext {
  /** The merchant's chosen language. Presentation only. */
  readonly locale: SellerLocale
  /** The shop's own currency — the DEFAULT for `money()`, never an override. */
  readonly currency: SellerCurrency
  /** IANA zone the shop operates in, for operator-facing clock times. */
  readonly timeZone: string
}

/**
 * The context a render falls back to when nothing supplied one.
 *
 * Spanish + MXN + Mexico City is the authored identity, not a guess: it is what
 * every call site in this portal literally hardcoded before, so a component that
 * somehow renders outside the provider degrades to today's exact output rather
 * than to a different-looking wrong answer. Both seller layouts mount the
 * provider unconditionally, so this is a floor, not a path anything relies on.
 */
export const DEFAULT_SELLER_FORMAT_CONTEXT: SellerFormatContext = Object.freeze({
  locale: 'es',
  currency: 'MXN',
  timeZone: MARKETS.mx.timezone,
})

/** Presentation facts that follow the shop's MARKET — currency and clock, never language. */
export function sellerFormatContextForMarket(
  locale: SellerLocale,
  market: MarketCode,
): SellerFormatContext {
  return Object.freeze({
    locale,
    currency: MARKETS[market].currency_code.toUpperCase() as SellerCurrency,
    timeZone: MARKETS[market].timezone,
  })
}

export interface SellerFormat {
  /** The language in force. Exposed so a call site can pick between two authored strings. */
  readonly locale: SellerLocale
  /** The shop's currency code — for a label, or an explicit pass-through. */
  readonly currency: SellerCurrency
  /** The shop's IANA zone — pass into `date()` for operator-facing clock times. */
  readonly timeZone: string
  /**
   * Centavos/cents → a currency string.
   *
   * `currency` is the code the AMOUNT is in. Pass it whenever the row carries one
   * (an order, a listing, a subscription); omit it only when the amount is the
   * shop's own money. Passing a literal is correct and expected for a product
   * that is priced in one country's money regardless of who is looking at it.
   */
  money(cents: number, currency?: string | null, options?: Intl.NumberFormatOptions): string
  /** A plain number: grouping and decimal marks only. */
  number(value: number, options?: Intl.NumberFormatOptions): string
  /**
   * A terse "how long ago", e.g. "Hace 3m" / "3m ago".
   *
   * Not `Intl.RelativeTimeFormat`: that renders "hace 3 minutos", and the orders
   * inbox is a dense list authored around the short form. Both languages are
   * spelled out here because this string is BUILT AT RENDER TIME from a number,
   * so the seller-copy population scan never collected it and the copy boundary
   * has nothing to substitute — it stayed Spanish in an English portal.
   *
   * Beyond `dayCutoff` days there is no useful relative phrasing, so it falls
   * through to an absolute short date. `now` is a parameter, not a `Date.now()`
   * read, so this stays pure and the caller owns the impurity.
   */
  relativeShort(value: string | number | Date, now: number, dayCutoff?: number): string
  /**
   * A date and/or a time. Always pass explicit component options.
   *
   * Implemented on `Date.prototype.toLocaleString` rather than
   * `Intl.DateTimeFormat.format` so an unparseable input yields "Invalid Date"
   * instead of throwing a `RangeError` mid-render — matching what the
   * `toLocaleDateString` call sites this replaces already did.
   */
  date(value: string | number | Date, options: Intl.DateTimeFormatOptions): string
}

function currencyCode(value: string | null | undefined, fallback: SellerCurrency): string {
  return typeof value === 'string' && value.trim() ? value.trim().toUpperCase() : fallback
}

export function createSellerFormat(
  context: SellerFormatContext = DEFAULT_SELLER_FORMAT_CONTEXT,
): SellerFormat {
  const tag = BCP47_BY_LOCALE[context.locale]
  const format: SellerFormat = {
    locale: context.locale,
    currency: context.currency,
    timeZone: context.timeZone,
    money(cents, currency, options) {
      return new Intl.NumberFormat(tag, {
        style: 'currency',
        currency: currencyCode(currency, context.currency),
        ...options,
      }).format(cents / 100)
    },
    number(value, options) {
      return new Intl.NumberFormat(tag, options).format(value)
    },
    date(value, options) {
      return new Date(value).toLocaleString(tag, options)
    },
    relativeShort(value, now, dayCutoff = 30) {
      const then = new Date(value)
      const mins  = Math.floor((now - then.getTime()) / 60_000)
      const hours = Math.floor(mins / 60)
      const days  = Math.floor(hours / 24)
      if (days >= dayCutoff) return this.date(then, { day: 'numeric', month: 'short' })
      if (context.locale === 'en') {
        if (mins  < 60) return `${mins}m ago`
        if (hours < 24) return `${hours}h ago`
        return `${days} day${days > 1 ? 's' : ''} ago`
      }
      if (mins  < 60) return `Hace ${mins}m`
      if (hours < 24) return `Hace ${hours}h`
      return `Hace ${days} día${days > 1 ? 's' : ''}`
    },
  }
  return Object.freeze(format)
}
