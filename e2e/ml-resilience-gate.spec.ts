import { test, expect } from '@playwright/test'
import { deriveConnectionHealth, connectionNeedsReauth } from '../lib/ml-health'
import { deriveMlSyncEntitlement, readMlSyncGrant, ML_SYNC_GRANT_KEY } from '../lib/ml-sync-entitlement'
import { buildCompGrant, buildOneTimeGrant } from '../lib/domain-entitlement'
import {
  mlEventLabel,
  mlEventTone,
  toMlEventViews,
  fmtMlEventDate,
  type MlSyncEvent,
} from '../lib/ml-events-view'
import { isPromoterSku } from '../lib/promoter-skus'
import { DEFAULT_COMMISSION_RATES } from '../lib/promoter-commission'

/**
 * Mercado Libre sync · Sprint 5 (epic 03 · mercadolibre-sync) — resilience + gate.
 *
 * The token refresh, the activity-log persistence, and the ML writes live in the
 * Medusa backend (unreachable from the `api` runner), so this gate covers what the
 * frontend owns deterministically:
 *   - the `needs_reauth` health state mirror (US-13),
 *   - the activity-log presentation (label / tone / redaction is backend-side),
 *   - the ML-sync entitlement precedence + SKU-key isolation + fail-safe (US-14),
 *   - the `ml_sync` promoter-SKU registration, and
 *   - the sync-settings route auth/flag shape (auth-before-flag, both flag states).
 * The revoke-token re-auth + entitlement browser smokes are owed to Daniel (sprint-5.md).
 */

// ── US-13: needs_reauth health mirror ──────────────────────────────────────────
test.describe('ml-health · needs_reauth (S5)', () => {
  const future = new Date(Date.now() + 60 * 60 * 1000)
  const past = new Date(Date.now() - 60 * 60 * 1000)

  test('needs_reauth outranks a healthy expiry', () => {
    const h = deriveConnectionHealth({ status: 'connected', expires_at: future, metadata: { needs_reauth: true } })
    expect(h.state).toBe('needs_reauth')
    expect(h.label_es).toMatch(/Reconecta/i)
  })

  test('needs_reauth outranks an expired token too', () => {
    expect(
      deriveConnectionHealth({ status: 'connected', expires_at: past, metadata: { needs_reauth: true } }).state,
    ).toBe('needs_reauth')
  })

  test('no flag ⇒ normal time-derived state', () => {
    expect(deriveConnectionHealth({ status: 'connected', expires_at: future }).state).toBe('connected')
    expect(deriveConnectionHealth({ status: 'connected', expires_at: future, metadata: { sync_enabled: true } }).state).toBe('connected')
  })

  test('a disconnected connection ignores the reauth flag', () => {
    expect(
      deriveConnectionHealth({ status: 'disconnected', expires_at: future, metadata: { needs_reauth: true } }).state,
    ).toBe('disconnected')
  })

  test('connectionNeedsReauth is strict on boolean true', () => {
    expect(connectionNeedsReauth({ needs_reauth: true })).toBe(true)
    expect(connectionNeedsReauth({ needs_reauth: 'true' as unknown as boolean })).toBe(false)
    expect(connectionNeedsReauth(null)).toBe(false)
  })
})

// ── US-13: activity-log presentation ────────────────────────────────────────────
test.describe('ml-events-view (S5)', () => {
  test('labels every known kind in es-MX', () => {
    for (const kind of ['token_refresh', 'publish', 'close', 'stock_push', 'sale_applied', 'reconcile', 'import']) {
      expect(mlEventLabel(kind)).toBeTruthy()
    }
    expect(mlEventLabel('token_refresh')).toMatch(/Reautoriza/i)
  })

  test('tone is fail only for a failed outcome', () => {
    expect(mlEventTone('fail')).toBe('fail')
    expect(mlEventTone('ok')).toBe('ok')
    expect(mlEventTone('anything')).toBe('ok')
  })

  test('fmtMlEventDate degrades to em-dash on bad input', () => {
    expect(fmtMlEventDate(null)).toBe('—')
    expect(fmtMlEventDate('not-a-date')).toBe('—')
    expect(fmtMlEventDate(new Date().toISOString())).not.toBe('—')
  })

  test('toMlEventViews maps rows to view models', () => {
    const rows: MlSyncEvent[] = [
      { id: 'mlse_1', kind: 'stock_push', outcome: 'ok', code: null, message: 'Existencia: 5', product_id: 'p1', ml_item_id: 'MLM1', metadata: null, created_at: new Date().toISOString() },
      { id: 'mlse_2', kind: 'token_refresh', outcome: 'fail', code: 'ML_REAUTH_REQUIRED', message: 'reconnect', product_id: null, ml_item_id: null, metadata: null, created_at: null },
    ]
    const views = toMlEventViews(rows)
    expect(views).toHaveLength(2)
    expect(views[0]).toMatchObject({ id: 'mlse_1', tone: 'ok' })
    expect(views[1]).toMatchObject({ id: 'mlse_2', tone: 'fail', when: '—' })
  })

  test('handles an empty / undefined list', () => {
    expect(toMlEventViews([])).toEqual([])
    expect(toMlEventViews(undefined as unknown as MlSyncEvent[])).toEqual([])
  })
})

// ── US-14: ML-sync entitlement precedence + fail-safe ───────────────────────────
test.describe('ml-sync entitlement (S5)', () => {
  test('paywall OFF ⇒ entitled (fail-safe: enabled testers keep working)', () => {
    expect(deriveMlSyncEntitlement({ paywallEnabled: false, grant: null }).entitled).toBe(true)
  })

  test('paywall ON + no grant ⇒ NOT entitled (upsell)', () => {
    const e = deriveMlSyncEntitlement({ paywallEnabled: true, grant: null })
    expect(e.entitled).toBe(false)
    expect(e.reason).toBe('none')
  })

  test('a comp grant entitles under the paywall (tester path)', () => {
    const grant = readMlSyncGrant({ [ML_SYNC_GRANT_KEY]: buildCompGrant({ note: 'tester' }) })
    expect(deriveMlSyncEntitlement({ paywallEnabled: true, grant }).entitled).toBe(true)
  })

  test('a live one-time grant entitles; a lapsed one does not', () => {
    const now = new Date('2026-07-01T00:00:00Z')
    const live = readMlSyncGrant({ [ML_SYNC_GRANT_KEY]: buildOneTimeGrant({ now, note: 'paid' }) })
    expect(deriveMlSyncEntitlement({ paywallEnabled: true, grant: live, now }).entitled).toBe(true)
    const later = new Date('2027-08-01T00:00:00Z') // past the 12-month term
    expect(deriveMlSyncEntitlement({ paywallEnabled: true, grant: live, now: later }).entitled).toBe(false)
  })

  test('SKU-key isolation: a subdomain/domain grant never entitles ML sync', () => {
    // A grant written under a DIFFERENT SKU key is invisible to the ML-sync reader.
    expect(readMlSyncGrant({ subdomain_grant: buildCompGrant() })).toBeNull()
    expect(readMlSyncGrant({ custom_domain_grant: buildCompGrant() })).toBeNull()
  })
})

// ── US-14: ml_sync promoter-SKU registration ────────────────────────────────────
test.describe('ml_sync promoter SKU (S5)', () => {
  test('ml_sync is a recognized promoter SKU', () => {
    expect(isPromoterSku('ml_sync')).toBe(true)
  })

  test('ml_sync has a default commission rate entry', () => {
    expect(DEFAULT_COMMISSION_RATES.ml_sync).toBe(0)
  })
})

// ── US-14: sync-settings route auth/flag shape (auth-before-flag, both states) ───
test.describe('ml sync-settings route · anonymous is rejected (S5)', () => {
  test('GET /api/sell/ml/sync-settings → 401 (no Clerk session)', async ({ request }) => {
    const res = await request.get('/api/sell/ml/sync-settings')
    // Auth is checked BEFORE the flag, so anonymous is always 401 regardless of the
    // live flag value (never 404/200) — the guard holds in both flag states.
    expect(res.status()).toBe(401)
  })

  test('POST /api/sell/ml/sync-settings → 401 (no Clerk session)', async ({ request }) => {
    const res = await request.post('/api/sell/ml/sync-settings', { data: { enabled: true } })
    expect(res.status()).toBe(401)
  })
})
