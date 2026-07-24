import { test, expect } from '@playwright/test'
import {
  validateFundadorasApplicationInput,
  fundadorasApplicationRefusalMessage,
  decideFundadorasGateState,
  buildFundadorasEnrichPatch,
  buildFundadorasInsertPayload,
  buildFundadorasConsentRows,
  buildFundadorasEventPayload,
  isFundadorasEvent,
  isPlausibleOpaqueSubjectId,
  FUNDADORAS_COHORT,
  FUNDADORAS_COHORT_CAPACITY,
  FUNDADORAS_CONSENT_TEXT_VERSION,
  type FundadorasCleanApplication,
  type ExistingRelationshipFacts,
} from '../lib/fundadoras-application'

/**
 * Tiendas Fundadoras acquisition · pure-seam coverage (api project — no browser,
 * no network). Proves the validation / capacity-gate / dedupe-enrich / consent /
 * PII-free-event logic that `app/api/vende/fundadoras/apply/route.ts`,
 * `app/api/growth/fundadoras/track/route.ts` and the page compose.
 *
 * NOT covered here (same discipline as promoter-applications.spec.ts): a genuinely
 * VALID submission against the live route — the Supabase project is shared across
 * dev/preview/prod, so a real submit would leave permanent rows. The end-to-end
 * apply → dedupe → consent → admin-record flow is the sprint's documented smoke
 * walkthrough, run manually against a disposable application.
 */

const VALID = {
  businessName: 'Panadería Don Memo',
  contactName: 'María Sánchez',
  phone: '5512345678',
  email: 'memo@example.com',
  contactConsent: true,
}

function cleanFixture(overrides: Partial<FundadorasCleanApplication> = {}): FundadorasCleanApplication {
  return {
    businessName: 'Panadería Don Memo',
    contactName: 'María Sánchez',
    phone: '+525512345678',
    email: 'memo@example.com',
    estado: 'Jalisco',
    municipio: null,
    category: 'alimentos',
    currentChannel: null,
    preferredChannel: 'whatsapp',
    promoterCode: null,
    utm: { utm_source: 'field-test' },
    contactConsent: true,
    previewPermission: false,
    marketing: false,
    idempotencyKey: 'idem-123',
    ...overrides,
  }
}

// ── Validation ──────────────────────────────────────────────────────────────

test.describe('validateFundadorasApplicationInput (pure)', () => {
  test('a well-formed application with contact consent passes', () => {
    const r = validateFundadorasApplicationInput(VALID)
    expect(r.ok).toBe(true)
  })

  test('honeypot (website filled) is refused — the trap, never surfaced', () => {
    const r = validateFundadorasApplicationInput({ ...VALID, website: 'http://spam' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('honeypot')
    // The honeypot message never reveals it exists.
    expect(fundadorasApplicationRefusalMessage('honeypot')).not.toContain('honeypot')
  })

  test('missing business or contact name → missing_fields', () => {
    expect(validateFundadorasApplicationInput({ ...VALID, businessName: '' }).ok).toBe(false)
    const r = validateFundadorasApplicationInput({ ...VALID, contactName: '  ' })
    if (!r.ok) expect(r.reason).toBe('missing_fields')
  })

  test('no phone AND no email → missing_contact', () => {
    const r = validateFundadorasApplicationInput({ ...VALID, phone: '', email: '' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('missing_contact')
  })

  test('either phone alone or email alone is enough', () => {
    expect(validateFundadorasApplicationInput({ ...VALID, email: '' }).ok).toBe(true)
    expect(validateFundadorasApplicationInput({ ...VALID, phone: '' }).ok).toBe(true)
  })

  test('invalid email → invalid_email', () => {
    const r = validateFundadorasApplicationInput({ ...VALID, phone: '', email: 'not-an-email' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('invalid_email')
  })

  test('contact consent is REQUIRED and must be literal true (fail-closed)', () => {
    expect(validateFundadorasApplicationInput({ ...VALID, contactConsent: false }).ok).toBe(false)
    const r = validateFundadorasApplicationInput({ ...VALID, contactConsent: undefined })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('consent_required')
    // A truthy non-boolean must NOT satisfy consent.
    const r2 = validateFundadorasApplicationInput({ ...VALID, contactConsent: 'yes' as unknown as boolean })
    expect(r2.ok).toBe(false)
  })

  test('over-length business name → too_long', () => {
    const r = validateFundadorasApplicationInput({ ...VALID, businessName: 'x'.repeat(200) })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('too_long')
  })

  test('optional preview/marketing default to false, never fabricated', () => {
    const r = validateFundadorasApplicationInput(VALID)
    if (r.ok) {
      expect(r.clean.previewPermission).toBe(false)
      expect(r.clean.marketing).toBe(false)
      expect(r.clean.contactConsent).toBe(true)
    }
  })

  test('refusal copy never leaks whether a contact already exists', () => {
    for (const reason of ['missing_fields', 'missing_contact', 'invalid_phone', 'invalid_email', 'consent_required', 'too_long'] as const) {
      const msg = fundadorasApplicationRefusalMessage(reason)
      expect(msg.toLowerCase()).not.toContain('ya existe')
      expect(msg.toLowerCase()).not.toContain('duplic')
    }
  })
})

// ── Capacity gate ─────────────────────────────────────────────────────────────

test.describe('decideFundadorasGateState (pure)', () => {
  test('flag OFF is always closed, even with room', () => {
    expect(decideFundadorasGateState(false, 0)).toBe('closed')
    expect(decideFundadorasGateState(false, 999)).toBe('closed')
  })

  test('flag ON + under capacity → open', () => {
    expect(decideFundadorasGateState(true, 0)).toBe('open')
    expect(decideFundadorasGateState(true, FUNDADORAS_COHORT_CAPACITY - 1)).toBe('open')
  })

  test('flag ON + at/over capacity → full', () => {
    expect(decideFundadorasGateState(true, FUNDADORAS_COHORT_CAPACITY)).toBe('full')
    expect(decideFundadorasGateState(true, FUNDADORAS_COHORT_CAPACITY + 5)).toBe('full')
  })

  test('capacity default is 25', () => {
    expect(FUNDADORAS_COHORT_CAPACITY).toBe(25)
  })
})

// ── Dedupe / enrich (never overwrite a deliberately-set value) ─────────────────

test.describe('buildFundadorasEnrichPatch (pure)', () => {
  const existing: ExistingRelationshipFacts = {
    business_name: 'Existing Name',
    contact_name: null,
    phone_e164: '+525599999999',
    email_normalized: null,
    estado: null,
    municipio: null,
    category: null,
    current_channels: null,
    preferred_channel: null,
    promoter_id: 'promoter-existing',
    cohort: null,
    utm: null,
    applied_at: null,
  }

  test('fills only missing fields; never overwrites a set value', () => {
    const patch = buildFundadorasEnrichPatch(existing, cleanFixture(), 'promoter-new', '2026-07-24T00:00:00Z')
    // business_name + phone_e164 + promoter_id already set → NOT in patch.
    expect(patch.business_name).toBeUndefined()
    expect(patch.phone_e164).toBeUndefined()
    expect(patch.promoter_id).toBeUndefined()
    // contact_name + email + estado were missing → filled.
    expect(patch.contact_name).toBe('María Sánchez')
    expect(patch.email_normalized).toBe('memo@example.com')
    expect(patch.estado).toBe('Jalisco')
  })

  test('cohort is always ASSERTED to fundadoras when it differs', () => {
    const patch = buildFundadorasEnrichPatch(existing, cleanFixture(), null, '2026-07-24T00:00:00Z')
    expect(patch.cohort).toBe(FUNDADORAS_COHORT)
  })

  test('cohort already fundadoras → not re-written', () => {
    const patch = buildFundadorasEnrichPatch({ ...existing, cohort: FUNDADORAS_COHORT }, cleanFixture(), null, 'now')
    expect(patch.cohort).toBeUndefined()
  })
})

test.describe('buildFundadorasInsertPayload (pure)', () => {
  test('a new row is cohort-tagged and carries attribution', () => {
    const payload = buildFundadorasInsertPayload(cleanFixture(), 'promoter-x', '2026-07-24T00:00:00Z')
    expect(payload.cohort).toBe(FUNDADORAS_COHORT)
    expect(payload.promoter_id).toBe('promoter-x')
    expect(payload.source).toBe('field-test') // utm_source wins
    expect(payload.application_idempotency_key).toBe('idem-123')
  })

  test('no utm_source → default source, no Medusa fields', () => {
    const payload = buildFundadorasInsertPayload(cleanFixture({ utm: {} }), null, 'now')
    expect(payload.source).toBe('public_application')
    expect(payload).not.toHaveProperty('shop_id')
  })
})

// ── Consent ledger (omission fabricates no permission) ────────────────────────

test.describe('buildFundadorasConsentRows (pure)', () => {
  test('always one row per kind; contact granted, others reflect the choice', () => {
    const rows = buildFundadorasConsentRows(cleanFixture({ previewPermission: true, marketing: false }))
    const byKind = Object.fromEntries(rows.map((r) => [r.kind, r]))
    expect(byKind.contact.granted).toBe(true)
    expect(byKind.preview_permission.granted).toBe(true)
    expect(byKind.marketing.granted).toBe(false)
    expect(rows.every((r) => r.text_version === FUNDADORAS_CONSENT_TEXT_VERSION)).toBe(true)
  })

  test('unchecked preview/marketing NEVER produce granted:true', () => {
    const rows = buildFundadorasConsentRows(cleanFixture({ previewPermission: false, marketing: false }))
    const granted = rows.filter((r) => r.granted).map((r) => r.kind)
    expect(granted).toEqual(['contact'])
  })
})

// ── PII-free events ───────────────────────────────────────────────────────────

test.describe('fundadoras funnel events (pure)', () => {
  test('event allowlist accepts only the five campaign events', () => {
    expect(isFundadorasEvent('fundadoras_view')).toBe(true)
    expect(isFundadorasEvent('fundadoras_application_accepted')).toBe(true)
    expect(isFundadorasEvent('setup_guide_viewed')).toBe(false)
    expect(isFundadorasEvent('arbitrary')).toBe(false)
  })

  test('payload carries ONLY the opaque subject + allowlisted tags — form values dropped', () => {
    const payload = buildFundadorasEventPayload('fundadoras_application_accepted', 'rel-opaque-id', {
      utm_source: 'field-test',
      cohort_state: 'open',
      businessName: 'LEAK',
      phone: '5512345678',
      email: 'leak@example.com',
    } as Record<string, unknown>)
    expect(payload.userId).toBe('rel-opaque-id')
    expect(payload.event).toBe('fundadoras_application_accepted')
    expect(payload.tags).toEqual({ utm_source: 'field-test', cohort_state: 'open' })
    // The whole serialized payload contains no smuggled PII.
    const serialized = JSON.stringify(payload)
    expect(serialized).not.toContain('LEAK')
    expect(serialized).not.toContain('5512345678')
    expect(serialized).not.toContain('leak@example.com')
  })

  test('opaque subject id rejects obviously PII-shaped values', () => {
    expect(isPlausibleOpaqueSubjectId('fnd_9c1e5b7a-1234-4a2b-9def-000000000000')).toBe(true)
    expect(isPlausibleOpaqueSubjectId('memo@example.com')).toBe(false) // email
    expect(isPlausibleOpaqueSubjectId('María Sánchez')).toBe(false) // name w/ space
    expect(isPlausibleOpaqueSubjectId('5512345678')).toBe(false) // phone
    expect(isPlausibleOpaqueSubjectId('short')).toBe(false) // too short
  })
})
