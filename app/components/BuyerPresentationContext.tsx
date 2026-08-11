'use client'

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { Dictionary } from '@/lib/dictionary'
import type { MarketPresentation } from '@/lib/market-presentation'
import { formatPresentationCurrency, formatPresentationDate } from '@/lib/market-presentation'

type BuyerCopy = Dictionary['buyerCopy']
export type BuyerCopyKey = keyof BuyerCopy

interface BuyerPresentationContextValue {
  readonly presentation: MarketPresentation
  readonly copy: BuyerCopy
}

const BuyerPresentationContext = createContext<BuyerPresentationContextValue | null>(null)

/**
 * Route-owned presentation boundary. The market root supplies this value on the
 * server; no consumer is allowed to infer language from browser preferences.
 */
export function BuyerPresentationProvider({
  presentation,
  copy,
  children,
}: BuyerPresentationContextValue & { children: ReactNode }) {
  const value = useMemo(() => ({ presentation, copy }), [presentation, copy])
  return (
    <BuyerPresentationContext.Provider value={value}>
      {children}
    </BuyerPresentationContext.Provider>
  )
}

export function useBuyerPresentation(): MarketPresentation {
  const context = useContext(BuyerPresentationContext)
  if (!context) {
    throw new Error('Buyer presentation is unavailable: render inside a market-owned root layout.')
  }
  return context.presentation
}

export function useBuyerFormatters() {
  const presentation = useBuyerPresentation()
  return useMemo(() => ({
    currency(cents: number, currency: string, options: Intl.NumberFormatOptions = {}) {
      return formatPresentationCurrency(presentation, cents, currency, options)
    },
    date(value: string | number | Date, options: Intl.DateTimeFormatOptions = {}) {
      return formatPresentationDate(presentation, value, options)
    },
    presentation,
  }), [presentation])
}

function interpolateCopy(value: string, replacements: readonly (string | number)[] = []): string {
  return value.replace(/\{(\d+)\}/g, (_placeholder, index: string) => String(replacements[Number(index)] ?? ''))
}

export function useBuyerCopy(): (key: BuyerCopyKey, values?: readonly (string | number)[]) => string {
  const context = useContext(BuyerPresentationContext)
  if (!context) {
    throw new Error('Buyer copy is unavailable: render inside a market-owned root layout.')
  }
  return (key, values) => values ? interpolateCopy(context.copy[key], values) : context.copy[key]
}

/** A zero-markup bridge that lets Server Components consume route-owned copy. */
export function BuyerCopyText({
  copyKey,
  values,
}: {
  copyKey: BuyerCopyKey
  values?: readonly (string | number)[]
}) {
  const copy = useBuyerCopy()
  return <>{copy(copyKey, values)}</>
}
