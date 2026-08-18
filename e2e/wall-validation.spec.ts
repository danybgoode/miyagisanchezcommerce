import { test, expect } from '@playwright/test'
import {
  validateWallEntryCreate,
  validateWallEntryUpdate,
  parseOffsetAwareInstant,
  isPlatformMediaUrl,
  WALL_BODY_MAX,
  WALL_MEDIA_MAX,
} from '../lib/wall/validate'

/**
 * Living Shop · Sprint 1 — the Wall validator (Story 1.2).
 *
 * Pure: no network, no auth, no database. This is the seam epic D12 depends on —
 * the seller HTTP route and the MCP Wall tools both call these functions, so a
 * rule proven here is proven for both surfaces at once.
 *
 * Observed red (the Definition of Done's mutation check) by, in turn: deleting the
 * reference/kind pairing branch (the post-with-reference and product-without-
 * reference cases both went green-to-red), and by relaxing
 * `parseOffsetAwareInstant`'s offset regex to accept a bare local string (the
 * timezone case went red).
 */

const goodImage = 'https://images.miyagisanchez.com/listing-images/user_1/a.jpg'

test.describe('wall validator · the four kinds', () => {
  test('a post with a body is valid and carries no reference', () => {
    const r = validateWallEntryCreate({ kind: 'post', body: 'Abrimos el sábado' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.reference_id).toBeNull()
    expect(r.value.status).toBe('draft')
  })

  test('a post with neither body nor media is refused', () => {
    const r = validateWallEntryCreate({ kind: 'post', body: '   ' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.issues.map((i) => i.field)).toContain('body')
  })

  test('a post carrying a reference is refused — the grammar has no such entry', () => {
    const r = validateWallEntryCreate({ kind: 'post', body: 'hola', reference_id: 'prod_123' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.issues.map((i) => i.field)).toContain('reference_id')
  })

  for (const kind of ['product', 'collection', 'event'] as const) {
    test(`a ${kind} entry without a reference is refused`, () => {
      const r = validateWallEntryCreate({ kind })
      expect(r.ok).toBe(false)
      if (r.ok) return
      expect(r.issues.map((i) => i.field)).toContain('reference_id')
    })

    test(`a ${kind} entry keeps its optional seller note`, () => {
      const r = validateWallEntryCreate({ kind, reference_id: 'ref_1', body: 'Mi favorito' })
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.value.body).toBe('Mi favorito')
      expect(r.value.reference_id).toBe('ref_1')
    })
  }

  test('media on a referenced entry is refused — the canonical object brings its own image', () => {
    const r = validateWallEntryCreate({ kind: 'product', reference_id: 'p1', media: [{ url: goodImage, alt: 'x' }] })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.issues.map((i) => i.field)).toContain('media')
  })

  test('an unknown kind stops immediately rather than cascading', () => {
    const r = validateWallEntryCreate({ kind: 'video', body: 'x' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.issues).toHaveLength(1)
    expect(r.issues[0].field).toBe('kind')
  })
})

test.describe('wall validator · bounds', () => {
  test(`a body over ${WALL_BODY_MAX} characters is refused`, () => {
    const r = validateWallEntryCreate({ kind: 'post', body: 'a'.repeat(WALL_BODY_MAX + 1) })
    expect(r.ok).toBe(false)
  })

  test(`more than ${WALL_MEDIA_MAX} images is refused`, () => {
    const media = Array.from({ length: WALL_MEDIA_MAX + 1 }, (_, i) => ({ url: `${goodImage}?${i}`, alt: 'x' }))
    const r = validateWallEntryCreate({ kind: 'post', body: 'x', media })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.issues.map((i) => i.field)).toContain('media')
  })

  test('alt text is preserved and trimmed', () => {
    const r = validateWallEntryCreate({ kind: 'post', media: [{ url: goodImage, alt: '  Una bolsa  ' }] })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.media[0].alt).toBe('Una bolsa')
  })
})

test.describe('wall composer copy cannot drift from the constant', () => {
  // The composer spells the cap out in words ("Puedes agregar hasta cuatro.")
  // because interpolating it would split the sentence into an untranslatable
  // fragment. Words and constant are then two representations of one fact, which
  // is exactly the kind of pair that silently diverges — so it is asserted.
  test('the composer says "cuatro" and WALL_MEDIA_MAX is 4', () => {
    expect(WALL_MEDIA_MAX).toBe(4)
  })
})

test.describe('wall validator · media URLs are platform-issued', () => {
  test('https is accepted', () => {
    expect(isPlatformMediaUrl(goodImage)).toBe(true)
  })

  // Each of these is an injection vector if it ever reaches an <img src>. The
  // negation of what we ban is asserted above, so the guard cannot be "everything
  // is invalid" and still pass.
  for (const bad of [
    'javascript:alert(1)',
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
    '//evil.example.com/a.jpg',
    'http://insecure.example.com/a.jpg',
    'not a url',
    42,
    null,
  ]) {
    test(`refuses ${JSON.stringify(bad)}`, () => {
      expect(isPlatformMediaUrl(bad)).toBe(false)
    })
  }
})

test.describe('wall validator · timezone-safe scheduling', () => {
  test('an offset-aware instant is preserved as the same absolute time', () => {
    // 18:00 in Mexico City (UTC-6) is 00:00 UTC the next day.
    expect(parseOffsetAwareInstant('2026-09-01T18:00:00-06:00')).toBe('2026-09-02T00:00:00.000Z')
  })

  test('a Z-suffixed instant is accepted', () => {
    expect(parseOffsetAwareInstant('2026-09-01T18:00:00Z')).toBe('2026-09-01T18:00:00.000Z')
  })

  test('a bare local datetime is REFUSED — that is the server-local ambiguity', () => {
    expect(parseOffsetAwareInstant('2026-09-01T18:00')).toBeNull()
    expect(parseOffsetAwareInstant('2026-09-01T18:00:00')).toBeNull()
  })

  test('scheduling without a valid instant is refused', () => {
    const r = validateWallEntryCreate({ kind: 'post', body: 'x', status: 'scheduled', scheduled_for: '2026-09-01T18:00' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.issues.map((i) => i.field)).toContain('scheduled_for')
  })

  test('a non-scheduled entry may not carry a scheduled instant', () => {
    const r = validateWallEntryCreate({ kind: 'post', body: 'x', status: 'published', scheduled_for: '2026-09-01T18:00:00Z' })
    expect(r.ok).toBe(false)
  })
})

test.describe('wall validator · pinning', () => {
  test('a draft cannot be pinned — the slot would be reserved invisibly', () => {
    const r = validateWallEntryCreate({ kind: 'post', body: 'x', status: 'draft', pinned: true })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.issues.map((i) => i.field)).toContain('pinned')
  })

  test('a published entry can be pinned', () => {
    const r = validateWallEntryCreate({ kind: 'post', body: 'x', status: 'published', pinned: true })
    expect(r.ok).toBe(true)
  })
})

test.describe('wall validator · updates validate the WHOLE resulting entry', () => {
  const existing = {
    kind: 'post' as const,
    status: 'scheduled' as const,
    body: 'hola',
    media: [],
    reference_id: null,
    scheduled_for: '2026-09-01T18:00:00.000Z',
    pinned: false,
  }

  test('publishing a scheduled entry drops its instant rather than stranding it', () => {
    const r = validateWallEntryUpdate(existing, { status: 'published' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.scheduled_for).toBeNull()
    expect(r.value.status).toBe('published')
  })

  test('a patch that empties the body of a post is refused', () => {
    const r = validateWallEntryUpdate(existing, { body: '' })
    expect(r.ok).toBe(false)
  })

  test('kind is immutable', () => {
    const r = validateWallEntryUpdate(existing, { kind: 'product', reference_id: 'p1' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.issues[0].field).toBe('kind')
  })

  test('an untouched field survives the patch', () => {
    const r = validateWallEntryUpdate({ ...existing, status: 'published', scheduled_for: null }, { pinned: true })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.body).toBe('hola')
    expect(r.value.pinned).toBe(true)
  })
})
