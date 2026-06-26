import { test, expect } from '@playwright/test'
import { buildAgentPrompt, resolveAgentContext } from '../lib/agent-prompt'

test.describe('buildAgentPrompt · generic es-MX hand-off (S1.2)', () => {
  const prompt = buildAgentPrompt({ kind: 'generic' })

  test('is fully es-MX (no leftover English body line)', () => {
    expect(prompt).toContain('Eres mi asistente de compras')
    // The old prompt carried these English lines + a bilingual close; they must be gone.
    expect(prompt).not.toContain('You are my personal shopping assistant')
    expect(prompt).not.toContain('What are you looking for today')
    expect(prompt).not.toContain('Before helping me')
  })

  test('keeps the cold-agent preamble pointing at /agent + ucp.dev', () => {
    expect(prompt).toContain('https://miyagisanchez.com/agent')
    expect(prompt).toContain('https://ucp.dev')
  })

  test('ends with the generic ask (never empty)', () => {
    expect(prompt.trim().length).toBeGreaterThan(0)
    expect(prompt).toContain('¿Qué estás buscando hoy?')
  })
})

test.describe('resolveAgentContext · URL → context (S1.3)', () => {
  test('PDP: /l/<id>', () => {
    expect(resolveAgentContext('/l/prod_123', null)).toEqual({ kind: 'pdp', listingId: 'prod_123' })
  })

  test('catalog: /l with a search query', () => {
    expect(resolveAgentContext('/l', new URLSearchParams('q=tenis'))).toEqual({
      kind: 'catalog', search: 'tenis', queryString: 'q=tenis',
    })
  })

  test('catalog: /l with no params (no search)', () => {
    expect(resolveAgentContext('/l', null)).toEqual({ kind: 'catalog', search: undefined, queryString: undefined })
  })

  test('catalog: /l falls back to category when there is no q', () => {
    const ctx = resolveAgentContext('/l', new URLSearchParams('category=autos'))
    expect(ctx).toMatchObject({ kind: 'catalog', search: 'autos' })
  })

  test('shop: /s/<slug>', () => {
    expect(resolveAgentContext('/s/zapatos-mx', null)).toEqual({ kind: 'shop', slug: 'zapatos-mx' })
  })

  test('account with an order ref: /account/orders/<id>', () => {
    expect(resolveAgentContext('/account/orders/order_9', null)).toEqual({ kind: 'account', orderRef: 'order_9' })
  })

  test('account without a ref: /account', () => {
    expect(resolveAgentContext('/account', null)).toEqual({ kind: 'account', orderRef: undefined })
  })

  test('homepage + unknown routes fall back to generic', () => {
    expect(resolveAgentContext('/', null)).toEqual({ kind: 'generic' })
    expect(resolveAgentContext('/quien-sabe/que', null)).toEqual({ kind: 'generic' })
    expect(resolveAgentContext('', null)).toEqual({ kind: 'generic' })
    expect(resolveAgentContext(null, null)).toEqual({ kind: 'generic' })
  })
})

test.describe('buildAgentPrompt · route templates carry the canonical URL (S1.3)', () => {
  test('PDP prompt contains the canonical product URL + a product ask', () => {
    const p = buildAgentPrompt({ kind: 'pdp', listingId: 'prod_123' })
    expect(p).toContain('https://miyagisanchez.com/l/prod_123')
    expect(p).toContain('producto')
  })

  test('catalog prompt mentions the search + the catalog URL', () => {
    const p = buildAgentPrompt({ kind: 'catalog', search: 'tenis', queryString: 'q=tenis' })
    expect(p).toContain('tenis')
    expect(p).toContain('https://miyagisanchez.com/l?q=tenis')
  })

  test('shop prompt contains the canonical shop URL', () => {
    const p = buildAgentPrompt({ kind: 'shop', slug: 'zapatos-mx' })
    expect(p).toContain('https://miyagisanchez.com/s/zapatos-mx')
    expect(p).toContain('tienda')
  })

  test('account prompt surfaces the order ref when present', () => {
    expect(buildAgentPrompt({ kind: 'account', orderRef: 'order_9' })).toContain('order_9')
    expect(buildAgentPrompt({ kind: 'account' })).toContain('pedidos')
  })

  test('every template keeps the cold-agent preamble', () => {
    for (const p of [
      buildAgentPrompt({ kind: 'pdp', listingId: 'x' }),
      buildAgentPrompt({ kind: 'catalog' }),
      buildAgentPrompt({ kind: 'shop', slug: 'y' }),
      buildAgentPrompt({ kind: 'account' }),
    ]) {
      expect(p).toContain('https://miyagisanchez.com/agent')
      expect(p).toContain('https://ucp.dev')
    }
  })
})
