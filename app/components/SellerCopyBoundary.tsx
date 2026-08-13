'use client'

import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import population from '@/locales/seller-population.json'
import { createSellerCopyTransform } from '@/lib/seller-copy'
import type { MarketCode } from '@/lib/markets'

const COPY_ATTRIBUTES = ['title', 'placeholder', 'aria-label'] as const

function translateTextNode(node: Text, copy: (value: string, market: MarketCode) => string) {
  const value = node.nodeValue ?? ''
  const leading = value.match(/^\s*/u)?.[0] ?? ''
  const trailing = value.match(/\s*$/u)?.[0] ?? ''
  const body = value.slice(leading.length, value.length - trailing.length).replace(/\s+/gu, ' ')
  if (!body) return
  const translated = copy(body, 'us')
  if (translated !== body) node.nodeValue = `${leading}${translated}${trailing}`
}

function translateElement(root: HTMLElement, copy: (value: string, market: MarketCode) => string) {
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
      const translated = copy(normalized, 'us')
      if (translated !== normalized) element.setAttribute(attribute, translated)
    }
  }
}

/**
 * Market-owned seller copy boundary. It is an identity wrapper for MX. For US,
 * it substitutes only text nodes and copy-bearing accessibility attributes;
 * page structure, hrefs, keys, icons, flags, handlers and data stay untouched.
 */
export default function SellerCopyBoundary({
  market,
  copy: localized,
  children,
}: {
  market: MarketCode
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
    if (!root || market !== 'us') return
    translateElement(root, copy)

    // Native dialogs live outside the DOM tree, but their authored strings use
    // the same generated population. Keep those six seller confirmations on the
    // same transform without changing their call sites or behavior.
    const originalAlert = window.alert
    const originalConfirm = window.confirm
    window.alert = (message?: unknown) => originalAlert.call(window, typeof message === 'string' ? copy(message, 'us') : message)
    window.confirm = (message?: string) => originalConfirm.call(window, message === undefined ? message : copy(message, 'us'))

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
  }, [copy, market])

  return <div ref={rootRef} data-seller-copy-boundary style={{ display: 'contents' }}>{children}</div>
}
