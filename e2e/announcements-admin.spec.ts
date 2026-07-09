import { expect, test } from '@playwright/test'
import { parseAnnouncementWriteBody, parseAnnouncementDeleteBody } from '../lib/announcements-admin'

/**
 * Pure-seam coverage for the admin announcement write surface (epic 08 ·
 * admin-content-and-announcements, Sprint 3). No browser, no network — proves the
 * validation `POST/DELETE /api/admin/announcements` compose. The authed 200-write
 * path runs anonymous in the `api` project (→ 401), so THIS is where the reject-bad-
 * link / reject-bad-schedule logic is actually asserted; `admin-announcements-api.spec.ts`
 * covers only the 401 gate.
 */

test.describe('announcements-admin · parseAnnouncementWriteBody', () => {
  test('accepts a minimal valid create (no id, no CTA, no schedule)', () => {
    const r = parseAnnouncementWriteBody({ audience: 'seller', text: 'Nueva función disponible.', active: true })
    expect(r).toEqual({
      ok: true,
      id: null,
      audience: 'seller',
      text: 'Nueva función disponible.',
      ctaLabel: null,
      ctaLink: null,
      startsAt: null,
      endsAt: null,
      active: true,
      replaceExisting: false,
    })
  })

  test('accepts a full write with a valid https CTA and schedule', () => {
    const r = parseAnnouncementWriteBody({
      id: 'a1',
      audience: 'buyer',
      text: 'Venta especial este fin de semana',
      ctaLabel: 'Ver ofertas',
      ctaLink: 'https://miyagisanchez.com/l',
      startsAt: '2026-08-01T00:00:00Z',
      endsAt: '2026-08-03T00:00:00Z',
      active: true,
      replaceExisting: true,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.id).toBe('a1')
      expect(r.ctaLink).toBe('https://miyagisanchez.com/l')
      expect(r.replaceExisting).toBe(true)
    }
  })

  test('rejects an invalid audience', () => {
    const r = parseAnnouncementWriteBody({ audience: 'admin', text: 'x', active: true })
    expect(r).toEqual({ ok: false, error: 'Audiencia inválida — debe ser "seller" o "buyer".' })
  })

  test('rejects empty/whitespace-only text', () => {
    const r = parseAnnouncementWriteBody({ audience: 'seller', text: '   ', active: true })
    expect(r.ok).toBe(false)
  })

  test('rejects a non-http(s) CTA link (e.g. javascript:) rather than repairing it', () => {
    const r = parseAnnouncementWriteBody({
      audience: 'seller',
      text: 'x',
      ctaLink: 'javascript:alert(1)',
      active: true,
    })
    expect(r).toEqual({ ok: false, error: 'El link del CTA debe ser una URL http(s) válida.' })
  })

  test('rejects a CTA label with no link — both renderers require both fields or neither', () => {
    const r = parseAnnouncementWriteBody({ audience: 'seller', text: 'x', ctaLabel: 'Ver más', active: true })
    expect(r).toEqual({ ok: false, error: 'El CTA necesita tanto una etiqueta como un link (o ninguno de los dos).' })
  })

  test('rejects a CTA link with no label', () => {
    const r = parseAnnouncementWriteBody({
      audience: 'seller',
      text: 'x',
      ctaLink: 'https://miyagisanchez.com',
      active: true,
    })
    expect(r).toEqual({ ok: false, error: 'El CTA necesita tanto una etiqueta como un link (o ninguno de los dos).' })
  })

  test('rejects an endsAt at or before startsAt', () => {
    const r = parseAnnouncementWriteBody({
      audience: 'seller',
      text: 'x',
      startsAt: '2026-08-03T00:00:00Z',
      endsAt: '2026-08-01T00:00:00Z',
      active: true,
    })
    expect(r).toEqual({ ok: false, error: 'La fecha de fin debe ser posterior a la de inicio.' })
  })

  test('rejects an unparsable schedule date', () => {
    const r = parseAnnouncementWriteBody({ audience: 'seller', text: 'x', startsAt: 'not-a-date', active: true })
    expect(r.ok).toBe(false)
  })

  test('rejects a missing active flag', () => {
    const r = parseAnnouncementWriteBody({ audience: 'seller', text: 'x' })
    expect(r).toEqual({ ok: false, error: 'El estado activo debe ser verdadero o falso.' })
  })
})

test.describe('announcements-admin · parseAnnouncementDeleteBody', () => {
  test('accepts a valid id', () => {
    expect(parseAnnouncementDeleteBody({ id: 'a1' })).toEqual({ ok: true, id: 'a1' })
  })

  test('rejects a missing id', () => {
    const r = parseAnnouncementDeleteBody({})
    expect(r).toEqual({ ok: false, error: 'Id inválido.' })
  })
})
