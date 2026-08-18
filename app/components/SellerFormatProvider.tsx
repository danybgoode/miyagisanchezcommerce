'use client'

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import {
  DEFAULT_SELLER_FORMAT_CONTEXT,
  createSellerFormat,
  type SellerFormat,
  type SellerFormatContext,
} from '@/lib/seller-format'

/**
 * Delivers the portal's number/date/money formatting to CLIENT components.
 *
 * WHY A CONTEXT AND NOT A PROP OR A PARAMETER. The ~30 call sites this replaces
 * were module-level pure helpers (`fmtMoney`, `fmtDate`) called from JSX. A hook
 * cannot be called at module scope, and threading a `locale` parameter would
 * have touched every one of ~90 invocations for a fact that is constant for the
 * whole render. A context is the cheapest correct seam: each component that
 * formats calls `useSellerFormat()` once and keeps its helper — now a closure
 * with the same name — so the JSX beneath it is untouched.
 *
 * WHY NOT MODULE-LEVEL STATE. A module-level `let locale` would be shared across
 * concurrent renders on the server, where one Node process serves every merchant
 * at once. One seller's language would leak into another's page, intermittently,
 * with every test green. React context is per-tree and therefore per-request.
 *
 * WHY THIS IS SAFE TO MOUNT FOR SPANISH TOO. A `Context.Provider` renders no DOM
 * node at all, so the Spanish tree stays byte-for-byte the authored markup — the
 * identity guarantee `SellerCopyBoundary` is built around. Both seller layouts
 * therefore mount this unconditionally, ABOVE their `sellerCopyBoundaryNeeded`
 * early-return, rather than only on the English path.
 */
const SellerFormatCtx = createContext<SellerFormatContext>(DEFAULT_SELLER_FORMAT_CONTEXT)

export default function SellerFormatProvider({
  context,
  children,
}: {
  context: SellerFormatContext
  children: ReactNode
}) {
  return <SellerFormatCtx.Provider value={context}>{children}</SellerFormatCtx.Provider>
}

/**
 * The formatter for the current render.
 *
 * Memoized on the three context fields rather than on the object identity, so a
 * layout that rebuilds the context object each request does not rebuild every
 * `Intl` formatter in the tree beneath it.
 */
export function useSellerFormat(): SellerFormat {
  const context = useContext(SellerFormatCtx)
  return useMemo(
    () => createSellerFormat(context),
    [context.locale, context.currency, context.timeZone],
  )
}
