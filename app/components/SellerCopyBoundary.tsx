'use client'

import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import population from '@/locales/seller-population.json'
import { createSellerCopyTransform } from '@/lib/seller-copy'
import { sellerCopyBoundaryNeeded, type SellerLocale } from '@/lib/seller-locale'

const COPY_ATTRIBUTES = ['title', 'placeholder', 'aria-label'] as const

function translateTextNode(node: Text, copy: (value: string, locale: SellerLocale) => string) {
  const value = node.nodeValue ?? ''
  const leading = value.match(/^\s*/u)?.[0] ?? ''
  const trailing = value.match(/\s*$/u)?.[0] ?? ''
  const body = value.slice(leading.length, value.length - trailing.length).replace(/\s+/gu, ' ')
  if (!body) return
  const translated = copy(body, 'en')
  if (translated !== body) node.nodeValue = `${leading}${translated}${trailing}`
}

function translateElement(root: HTMLElement, copy: (value: string, locale: SellerLocale) => string) {
  const document = root.ownerDocument
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  while (walker.nextNode()) nodes.push(walker.currentNode as Text)
  for (const node of nodes) {
    const parent = node.parentElement?.tagName
    if (parent !== 'SCRIPT' && parent !== 'STYLE' && parent !== 'NOSCRIPT') translateTextNode(node, copy)
  }

  const elements = [root, ...root.querySelectorAll<HTMLElement>('*')]
  for (const element of elements) {
    for (const attribute of COPY_ATTRIBUTES) {
      const value = element.getAttribute(attribute)
      if (value === null) continue
      const normalized = value.replace(/\s+/gu, ' ').trim()
      const translated = copy(normalized, 'en')
      if (translated !== normalized) element.setAttribute(attribute, translated)
    }
  }
}

/**
 * Locale-owned seller copy boundary. It is an identity wrapper for Spanish (the
 * authored tree). For English it substitutes only text nodes and copy-bearing
 * accessibility attributes; page structure, hrefs, keys, icons, flags, handlers
 * and data stay untouched.
 *
 * The locale comes from `resolveSellerLocale` on the server — the shop's market
 * defaults it, the seller's stored choice overrides it — so this component never
 * infers a language from a market or a browser header of its own.
 */
export default function SellerCopyBoundary({
  locale,
  copy: localized,
  children,
}: {
  locale: SellerLocale
  copy: Readonly<Record<string, string>>
  children: ReactNode
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const copy = useMemo(
    () => createSellerCopyTransform(population.entries, localized),
    [localized],
  )

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root || !sellerCopyBoundaryNeeded(locale)) return
    translateElement(root, copy)

    // Native dialogs live outside the DOM tree, but their authored strings use
    // the same generated population. Keep those six seller confirmations on the
    // same transform without changing their call sites or behavior.
    const originalAlert = window.alert
    const originalConfirm = window.confirm
    window.alert = (message?: unknown) => originalAlert.call(window, typeof message === 'string' ? copy(message, 'en') : message)
    window.confirm = (message?: string) => originalConfirm.call(window, message === undefined ? message : copy(message, 'en'))

    const observer = new MutationObserver(() => translateElement(root, copy))
    observer.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...COPY_ATTRIBUTES],
    })
    return () => {
      observer.disconnect()
      window.alert = originalAlert
      window.confirm = originalConfirm
    }
  }, [copy, locale])

  return <div ref={rootRef} data-seller-copy-boundary style={{ display: 'contents' }}>{children}</div>
}
