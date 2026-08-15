/**
 * The tenant mutation decisions (tenant-lifecycle-admin · D3, D7).
 *
 * Every assertion here is a REFUSAL or the absence of one, because that is what these
 * functions are for: they run before anything is written, so a rejected request
 * cannot persist half of itself. The owned-shop epic shipped exactly that defect —
 * validation after the writes, returning the right status code over a partial apply —
 * and a pure decision makes the shape impossible rather than merely unlikely.
 */
import { test, expect } from '@playwright/test'
import {
  TENANT_NON_EDITABLE_FIELDS,
  decideStatusChange,
  decideTenantEdit,
  statusChangeConfirmation,
} from '../lib/admin/tenant-actions'

test.describe('decideTenantEdit', () => {
  test('accepts a name change and trims it', () => {
    const decision = decideTenantEdit({ name: '  Bazar Ejemplo  ' })
    expect(decision.ok).toBe(true)
    if (decision.ok) expect(decision.patch.name).toBe('Bazar Ejemplo')
  })

  test('REFUSES a blank name rather than clearing it', () => {
    // A shop with no name is unusable in every surface that lists it.
    for (const name of ['', '   ']) {
      const decision = decideTenantEdit({ name })
      expect(decision.ok).toBe(false)
      if (!decision.ok) expect(decision.field).toBe('name')
    }
  })

  test('REFUSES a non-string field rather than coercing it', () => {
    // Coerce a purchase, reject a mutation: an admin who sent the wrong type must be
    // told, not quietly given String(42).
    expect(decideTenantEdit({ name: 42 }).ok).toBe(false)
    expect(decideTenantEdit({ description: [] }).ok).toBe(false)
  })

  test('distinguishes "leave alone" from "clear"', () => {
    // Absent means untouched; explicit null means clear. Conflating them would make
    // it impossible to ever remove a description.
    const untouched = decideTenantEdit({ name: 'X' })
    expect(untouched.ok && 'description' in untouched.patch).toBe(false)

    const cleared = decideTenantEdit({ description: null })
    expect(cleared.ok).toBe(true)
    if (cleared.ok) expect(cleared.patch.description).toBeNull()
  })

  test('an empty string clears a nullable field rather than storing ""', () => {
    const decision = decideTenantEdit({ location: '   ' })
    expect(decision.ok).toBe(true)
    if (decision.ok) expect(decision.patch.location).toBeNull()
  })

  test('REFUSES slug and custom_domain, naming why', () => {
    // Both are real operations with their own consequences — a slug change breaks
    // every shared link and the shop's subdomain. Silently ignoring them would be
    // worse than refusing: the operator would think the change landed.
    for (const field of TENANT_NON_EDITABLE_FIELDS) {
      const decision = decideTenantEdit({ [field]: 'algo' })
      expect(decision.ok).toBe(false)
      if (!decision.ok) {
        expect(decision.field).toBe(field)
        expect(decision.message.length).toBeGreaterThan(20)
      }
    }
  })

  test('REFUSES an over-long value at the boundary', () => {
    expect(decideTenantEdit({ name: 'a'.repeat(121) }).ok).toBe(false)
    expect(decideTenantEdit({ name: 'a'.repeat(120) }).ok).toBe(true)
  })

  test('REFUSES a no-op edit rather than auditing a change that changed nothing', () => {
    for (const body of [{}, null, [], 'nope']) {
      expect(decideTenantEdit(body).ok).toBe(false)
    }
  })

  test('is total — it never throws, whatever it is handed', () => {
    for (const body of [undefined, 0, false, { name: { nested: true } }, [1, 2]]) {
      expect(() => decideTenantEdit(body)).not.toThrow()
    }
  })
})

test.describe('decideStatusChange', () => {
  test('accepts a valid status with a reason', () => {
    const decision = decideStatusChange({ status: 'paused', reason: '  Fraude reportado  ' })
    expect(decision.ok).toBe(true)
    if (decision.ok) {
      expect(decision.status).toBe('paused')
      expect(decision.reason).toBe('Fraude reportado')
    }
  })

  test('REQUIRES a reason — the audit row is the only record of why a shop went dark', () => {
    for (const reason of [undefined, '', '   ', 42]) {
      const decision = decideStatusChange({ status: 'paused', reason })
      expect(decision.ok).toBe(false)
      if (!decision.ok) expect(decision.field).toBe('reason')
    }
  })

  test('REFUSES an unknown status, naming the allowed set', () => {
    const decision = decideStatusChange({ status: 'suspended', reason: 'x' })
    expect(decision.ok).toBe(false)
    if (!decision.ok) expect(decision.message).toContain('active, paused, deleted')
  })

  test('does NOT restate the backend transition rules', () => {
    // `deleted → active` is refused by the BACKEND as terminal. This layer accepts it
    // as well-formed on purpose: two copies of one rule is the paraphrased contract
    // that drifts permissive, and the backend is the authority.
    expect(decideStatusChange({ status: 'active', reason: 'restaurar' }).ok).toBe(true)
  })

  test('is total', () => {
    for (const body of [null, undefined, 'x', [], 0]) {
      expect(() => decideStatusChange(body)).not.toThrow()
      expect(decideStatusChange(body).ok).toBe(false)
    }
  })
})

test.describe('statusChangeConfirmation', () => {
  test('says what each transition will actually do, differently', () => {
    // "¿Seguro?" tells nobody what is about to happen. Pausing and deleting have
    // genuinely different consequences and the dialog must name which one it is.
    const paused = statusChangeConfirmation('Bazar', 'paused')
    const deleted = statusChangeConfirmation('Bazar', 'deleted')
    const active = statusChangeConfirmation('Bazar', 'active')

    expect(new Set([paused, deleted, active]).size).toBe(3)
    for (const copy of [paused, deleted, active]) expect(copy).toContain('Bazar')
    expect(deleted).toContain('no se revierte')
    expect(active).toContain('exactamente')
  })
})

test.describe('unknown-key rejection (review round 3)', () => {
  test('REFUSES an unrecognised key instead of writing the rest', () => {
    // `{ name: 'Nuevo', customDomain: 'x' }` previously wrote the name, dropped the
    // domain and reported full success — a response claiming more than it did. Note
    // `customDomain` is camelCase and so was not caught by the snake_case
    // non-editable list; an allow-list is the only form that stays correct.
    const decision = decideTenantEdit({ name: 'Nuevo', customDomain: 'example.com' })
    expect(decision.ok).toBe(false)
    if (!decision.ok) expect(decision.field).toBe('customDomain')
  })

  test('still accepts every legitimately editable field together', () => {
    const decision = decideTenantEdit({ name: 'N', description: 'D', location: 'L' })
    expect(decision.ok).toBe(true)
  })
})
