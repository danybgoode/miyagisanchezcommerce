import { expect, test } from '@playwright/test'
import { validateConfig } from '../lib/settings-import'

/**
 * Own-shop premium presentation (epic 07, Sprint 3) — Story 3.1/3.2 field
 * validation for the `content` block (Acerca + FAQ), exercised through
 * `validateConfig()` (the same seam Storefront-as-Code + the MCP
 * `patch_store_configuration` tool both call — mirrors
 * `announcement-hero-config.spec.ts`'s pattern for Sprint 1's block).
 */
test.describe('own-shop premium presentation — content (Acerca + FAQ) validation (Sprint 3)', () => {
  test('a valid about body is applied', () => {
    const { patch, blocks } = validateConfig({ content: { about: { body: 'Somos una tienda familiar.' } } })
    expect(patch.settings?.about).toEqual({ body: 'Somos una tienda familiar.' })
    expect(blocks[0].appliedFields).toContain('about')
  })

  test('an empty about body is rejected — not applied, issue reported', () => {
    const { patch, blocks } = validateConfig({ content: { about: { body: '' } } })
    expect(patch.settings?.about).toBeUndefined()
    expect(blocks[0].issues.some(i => i.includes('content.about.body'))).toBe(true)
  })

  test('an about body over 600 characters is rejected with an issue', () => {
    const { patch, blocks } = validateConfig({ content: { about: { body: 'x'.repeat(601) } } })
    expect(patch.settings?.about).toBeUndefined()
    expect(blocks[0].issues.some(i => i.includes('content.about.body'))).toBe(true)
  })

  test('valid faq items are applied', () => {
    const { patch } = validateConfig({
      content: { faq: { items: [{ question: '¿Cuánto tarda el envío?', answer: '3-5 días hábiles.' }] } },
    })
    expect(patch.settings?.faq).toEqual({ items: [{ question: '¿Cuánto tarda el envío?', answer: '3-5 días hábiles.' }] })
  })

  test('faq items are capped at 12; malformed entries are dropped with an issue', () => {
    const items = Array.from({ length: 14 }, (_, i) => ({ question: `Pregunta ${i}`, answer: `Respuesta ${i}` }))
    const { patch, blocks } = validateConfig({ content: { faq: { items } } })
    const faq = patch.settings?.faq as { items: unknown[] } | undefined
    expect(faq?.items).toHaveLength(12)
    expect(blocks[0].issues.some(i => i.includes('faq'))).toBe(true)
  })

  test('a faq entry missing a question or answer is dropped, valid ones still applied', () => {
    const { patch, blocks } = validateConfig({
      content: { faq: { items: [{ question: 'Válida', answer: 'Sí' }, { question: '', answer: 'Sin pregunta' }] } },
    })
    expect(patch.settings?.faq).toEqual({ items: [{ question: 'Válida', answer: 'Sí' }] })
    expect(blocks[0].issues.some(i => i.includes('faq'))).toBe(true)
  })

  test('absent content keys leave the storefront unchanged (no keys in the patch)', () => {
    const { patch } = validateConfig({ profile: { name: 'Mi tienda' } })
    expect(patch.settings?.about).toBeUndefined()
    expect(patch.settings?.faq).toBeUndefined()
  })

  // An explicit `null` clears each field via MCP — an agent must be able to
  // turn a feature back off, not just set it (same discipline as S1's
  // announcement/hero — found in that sprint's cross-agent review).
  test('an explicit null clears about/faq (agent can turn a feature back off)', () => {
    const { patch, blocks } = validateConfig({ content: { about: null, faq: null } })
    expect(patch.settings?.about).toBeNull()
    expect(patch.settings?.faq).toBeNull()
    expect(blocks[0].appliedFields).toEqual(expect.arrayContaining(['about (cleared)', 'faq (cleared)']))
  })

  test('políticas has no field in the content block — only about/faq are settable here', () => {
    const { patch } = validateConfig({ content: { about: { body: 'Hola' } } } as never)
    expect(patch.settings).not.toHaveProperty('politicas')
    expect(patch.settings?.returns_policy).toBeUndefined()
  })
})
