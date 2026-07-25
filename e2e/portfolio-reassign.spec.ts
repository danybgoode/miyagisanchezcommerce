import { expect, test } from '@playwright/test'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dueAtIsoFromDateOnly } from '../lib/relationship-pipeline'
import {
  ROW_TOUCH_FIELD,
  STEWARDSHIP_UPDATE_FIELDS,
  STEWARD_ID_RE,
  buildStewardshipUpdate,
  parseReassignBody,
} from '../lib/portfolio/reassign'

/**
 * Merchant Partner lifecycle · Sprint 1, Story 1.3 (api project, network-free):
 * the reassignment audit + THE ATTRIBUTION INVARIANT.
 *
 * The story's acceptance is "promoter/cohort/referral/commission records are
 * unchanged". That is an invariant, and an invariant asserted in a comment is not
 * evidence (LEARNINGS: "a confident comment is not evidence"). So it is proved
 * two ways, both mechanical:
 *
 *   1. THE UPDATE PAYLOAD. `buildStewardshipUpdate` is exercised over every input
 *      shape and its keys are checked against a FORBIDDEN SET that is DERIVED —
 *      by parsing `lib/relationship-access.ts`'s own `AUDITED_FIELDS` array out
 *      of its source — rather than typed out here. An audited field added to that
 *      array later is therefore covered without editing this spec. (The array
 *      cannot simply be IMPORTED: `lib/relationship-access.ts` is `server-only`,
 *      and that package throws unconditionally outside a webpack `react-server`
 *      build — the same constraint `lib/scorecard/dictionary.ts`'s header
 *      documents.)
 *   2. THE IMPORT GRAPH. No module under `lib/portfolio/` — the population
 *      re-derived from the filesystem, not listed — references a commission or
 *      transfer table or module at all.
 *
 * RED-OBSERVED (red-green DoD): see the PR body.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const NOW = new Date('2026-07-24T18:00:00.000Z')

// ── The derived forbidden set ────────────────────────────────────────────────

/**
 * Parse `AUDITED_FIELDS` straight out of the shipped module's source. This is
 * the population the invariant is about: every column whose edit the platform
 * considers an attribution/consent event worth an immutable audit row.
 */
function auditedFieldsFromSource(): string[] {
  const src = read('lib/relationship-access.ts')
  const match = src.match(/export const AUDITED_FIELDS = \[([^\]]*)\] as const/)
  if (!match) throw new Error('AUDITED_FIELDS not found in lib/relationship-access.ts — the derivation is broken')
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
}

const AUDITED_FIELDS = auditedFieldsFromSource()

/**
 * The forbidden set: every audited field that is NOT a stewardship field. Derived
 * by subtraction, so a future audited field lands in the forbidden set
 * automatically and a future STEWARDSHIP field is excluded automatically.
 */
const FORBIDDEN_UPDATE_FIELDS = AUDITED_FIELDS.filter(
  (f) => !(STEWARDSHIP_UPDATE_FIELDS as readonly string[]).includes(f),
)

const ALLOWED_UPDATE_KEYS = [...STEWARDSHIP_UPDATE_FIELDS, ROW_TOUCH_FIELD].sort()

test.describe('the derivation itself is sound (a broken derivation would make every guard below vacuous)', () => {
  test('AUDITED_FIELDS parsed from source is non-empty and names the attribution columns', () => {
    expect(AUDITED_FIELDS.length).toBeGreaterThan(0)
    for (const known of ['promoter_id', 'cohort', 'source', 'preview_id', 'shop_id']) {
      expect(AUDITED_FIELDS, known).toContain(known)
    }
  })

  test('the forbidden set is non-empty and disjoint from the stewardship set', () => {
    expect(FORBIDDEN_UPDATE_FIELDS.length).toBeGreaterThan(0)
    for (const f of FORBIDDEN_UPDATE_FIELDS) {
      expect(STEWARDSHIP_UPDATE_FIELDS as readonly string[], f).not.toContain(f)
    }
  })

  test('the stewardship set is exactly the four columns the build contract names', () => {
    expect([...STEWARDSHIP_UPDATE_FIELDS].sort()).toEqual([
      'assigned_at',
      'assignment_reason',
      'escalation_clerk_user_id',
      'steward_clerk_user_id',
    ])
  })
})

// ── 1. The update payload ────────────────────────────────────────────────────

test.describe('buildStewardshipUpdate — the payload can only ever touch stewardship columns', () => {
  const inputs = [
    { label: 'promoter path (steward only)', input: { toSteward: 'user_new', now: NOW.toISOString() } },
    { label: 'promoter path clearing the steward', input: { toSteward: null, now: NOW.toISOString() } },
    {
      label: 'admin path, everything set',
      input: {
        toSteward: 'user_new',
        assignmentReason: 'capacidad',
        assignedAt: NOW.toISOString(),
        escalationClerkUserId: 'user_boss',
        now: NOW.toISOString(),
      },
    },
    {
      label: 'admin path, everything cleared',
      input: {
        toSteward: null,
        assignmentReason: null,
        assignedAt: null,
        escalationClerkUserId: null,
        now: NOW.toISOString(),
      },
    },
    { label: 'nothing but the row touch', input: { now: NOW.toISOString() } },
  ]

  for (const { label, input } of inputs) {
    test(`${label}: no forbidden attribution key appears`, () => {
      const payload = buildStewardshipUpdate(input)
      for (const forbidden of FORBIDDEN_UPDATE_FIELDS) {
        expect(Object.keys(payload), forbidden).not.toContain(forbidden)
      }
    })

    test(`${label}: every key is in the allowed set (nothing unexpected sneaks in)`, () => {
      const payload = buildStewardshipUpdate(input)
      for (const key of Object.keys(payload)) {
        expect(ALLOWED_UPDATE_KEYS, key).toContain(key)
      }
    })
  }

  test('a polluted input cannot smuggle a column through (positive-list constructor, never a spread)', () => {
    const polluted = {
      toSteward: 'user_new',
      now: NOW.toISOString(),
      promoter_id: 'PRM-EVIL',
      cohort: 'fundadoras',
      source: 'hijack',
      shop_id: 'shop_evil',
      preview_id: 'prev_evil',
      stage: 'retained_30d',
    } as unknown as Parameters<typeof buildStewardshipUpdate>[0]
    const payload = buildStewardshipUpdate(polluted)
    expect(Object.keys(payload).sort()).toEqual(['steward_clerk_user_id', 'updated_at'])
    expect(JSON.stringify(payload)).not.toContain('PRM-EVIL')
    expect(JSON.stringify(payload)).not.toContain('shop_evil')
  })

  test('an omitted field is ABSENT from the payload, not written as null — this is what keeps the shipped promoter route byte-identical', () => {
    const payload = buildStewardshipUpdate({ toSteward: 'user_new', now: NOW.toISOString() })
    expect(Object.keys(payload).sort()).toEqual(['steward_clerk_user_id', 'updated_at'])
    expect('assignment_reason' in payload).toBe(false)
    expect('assigned_at' in payload).toBe(false)
    expect('escalation_clerk_user_id' in payload).toBe(false)
  })

  test('an EXPLICIT null IS written (clearing a steward is a real, distinct intent)', () => {
    const payload = buildStewardshipUpdate({ toSteward: null, escalationClerkUserId: null, now: NOW.toISOString() })
    expect(payload.steward_clerk_user_id).toBeNull()
    expect(payload.escalation_clerk_user_id).toBeNull()
    expect('steward_clerk_user_id' in payload).toBe(true)
  })

  test('the row-touch timestamp is always written', () => {
    expect(buildStewardshipUpdate({ now: NOW.toISOString() })[ROW_TOUCH_FIELD]).toBe(NOW.toISOString())
  })
})

// ── 2. The import graph ──────────────────────────────────────────────────────

test.describe('population guard · nothing in lib/portfolio/ can reach a commission or transfer record', () => {
  /** Re-derived from the filesystem so a module added later is covered. */
  function portfolioFiles(): string[] {
    return readdirSync(join(ROOT, 'lib', 'portfolio'))
      .filter((e) => extname(e) === '.ts')
      .map((e) => `lib/portfolio/${e}`)
  }

  /** Every compensation-bearing table and module name in this repo. Tables are
   *  matched as `.from('<table>')` and by bare name, so a raw SQL string or an
   *  RPC argument is caught too. */
  const FORBIDDEN_REFERENCES = [
    'promoter_transfers',
    'promoter_commission',
    'promoter_commissions',
    'promoter_payouts',
    'marketplace_promoters',
    'promoter-commission',
    'promoter-transfer',
    'promoter-payout',
  ]

  test('sanity — the file population is non-empty and includes the reassignment modules', () => {
    const files = portfolioFiles()
    expect(files.length).toBeGreaterThan(0)
    expect(files).toContain('lib/portfolio/reassign.ts')
    expect(files).toContain('lib/portfolio/reassign-server.ts')
  })

  test('sanity — the forbidden references DO exist somewhere in the repo (the guard is not checking for nothing)', () => {
    // If none of these names appeared anywhere, the guard below would pass
    // vacuously forever. Proved against a module that legitimately reads them.
    const promoterLib = read('lib/promoter.ts')
    expect(promoterLib).toContain('marketplace_promoters')
  })

  for (const forbidden of FORBIDDEN_REFERENCES) {
    test(`no lib/portfolio module references "${forbidden}"`, () => {
      const offenders: string[] = []
      for (const file of portfolioFiles()) {
        if (read(file).includes(forbidden)) offenders.push(file)
      }
      expect(offenders).toEqual([])
    })
  }

  test('the reassignment writer builds NO update object of its own — every write goes through the builder', () => {
    const writer = read('lib/portfolio/reassign-server.ts')
    expect(writer).toContain('buildStewardshipUpdate(')
    // The ONE `.update(` on `merchant_relationships` must be fed the builder's
    // output, never an inline literal.
    expect(writer).toMatch(/\.from\('merchant_relationships'\)\s*\n\s*\.update\(update\)/)
    // No inline object literal is ever passed to a merchant_relationships update.
    expect(writer).not.toMatch(/\.update\(\s*\{[^}]*promoter_id/)
  })

  test('the writer touches exactly three tables: relationships, owner history, tasks', () => {
    const writer = read('lib/portfolio/reassign-server.ts')
    const tables = [...writer.matchAll(/\.from\('([^']+)'\)/g)].map((m) => m[1])
    expect([...new Set(tables)].sort()).toEqual([
      'merchant_relationship_owner_history',
      'merchant_relationship_tasks',
      'merchant_relationships',
    ])
  })
})

// ── 3. Audit ordering (D3a preserved) ────────────────────────────────────────

test.describe('source · the audit row is written BEFORE the access-changing field (D3a preserved)', () => {
  const writer = read('lib/portfolio/reassign-server.ts')

  test('the owner-history insert precedes the merchant_relationships update', () => {
    const historyAt = writer.indexOf("from('merchant_relationship_owner_history')")
    const updateAt = writer.indexOf("from('merchant_relationships')")
    expect(historyAt).toBeGreaterThan(-1)
    expect(updateAt).toBeGreaterThan(-1)
    expect(historyAt).toBeLessThan(updateAt)
  })

  test('a failed history write REFUSES the reassignment (500), never reports partial success', () => {
    const slice = writer.slice(writer.indexOf("from('merchant_relationship_owner_history')"))
    expect(slice).toContain('la reasignación no se aplicó')
    expect(slice).toMatch(/status:\s*500/)
  })

  test('the task read and transfer precede the audit row, so the audit records the TRUE count', () => {
    const taskAt = writer.indexOf("from('merchant_relationship_tasks')")
    const historyAt = writer.indexOf("from('merchant_relationship_owner_history')")
    expect(taskAt).toBeGreaterThan(-1)
    expect(taskAt).toBeLessThan(historyAt)
  })

  test('a failed task read or transfer refuses the reassignment before anything is audited or moved', () => {
    const between = writer.slice(
      writer.indexOf("from('merchant_relationship_tasks')"),
      writer.indexOf("from('merchant_relationship_owner_history')"),
    )
    expect((between.match(/status:\s*500/g) ?? []).length).toBeGreaterThanOrEqual(2)
  })
})

test.describe('source · the shipped promoter owner route is shared, not loosened', () => {
  const owner = read('app/api/promoter/relationship/[id]/owner/route.ts')

  test('it still gates on its OWN flag (activation_crm), never the new portfolio flag', () => {
    expect(owner).toContain('authorizeRelationshipRequest(req)')
    expect(owner).not.toContain('authorizePortfolioRequest')
    expect(owner).not.toContain('partner_portfolio_enabled')
  })

  test('it is still NOT admin-only — a manager/owner may still reassign, as it ships today', () => {
    expect(owner).toContain('canWriteRelationship(access.role)')
    expect(owner).not.toMatch(/access\.role !== 'admin'/)
  })

  test('it calls the shared writer and passes NO reason / effectiveAt / transferOpenTasks', () => {
    expect(owner).toContain('reassignSteward({')
    const call = owner.slice(owner.indexOf('reassignSteward({'), owner.indexOf('reassignSteward({') + 400)
    for (const privileged of ['reason:', 'effectiveAt:', 'transferOpenTasks:', 'escalationClerkUserId:']) {
      expect(call, privileged).not.toContain(privileged)
    }
  })

  test('it no longer declares its own steward-id regex — one definition, imported', () => {
    expect(owner).not.toMatch(/const STEWARD_ID_RE\s*=/)
    expect(owner).toMatch(/import\s*\{\s*STEWARD_ID_RE\s*\}\s*from\s*'@\/lib\/portfolio\/reassign'/)
    // …and it still validates with it.
    expect(owner).toContain('STEWARD_ID_RE.test(toSteward)')
  })

  test('the admin route validates the steward id with the SAME regex (never laxer)', () => {
    const parser = read('lib/portfolio/reassign.ts')
    expect(parser).toContain('STEWARD_ID_RE.test(toSteward)')
    expect(STEWARD_ID_RE.test('user_2abcDEF-123')).toBe(true)
    for (const bad of ['', 'user id', 'user;drop', 'a'.repeat(65), "user'--"]) {
      expect(STEWARD_ID_RE.test(bad), bad).toBe(false)
    }
  })
})

// ── 4. parseReassignBody ─────────────────────────────────────────────────────

const validBody = { toSteward: 'user_new', reason: 'cambio de capacidad', transferOpenTasks: true }

test.describe('parseReassignBody — reason and the task decision are BOTH required', () => {
  test('a valid body parses', () => {
    const r = parseReassignBody(validBody, NOW)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.toSteward).toBe('user_new')
      expect(r.value.reason).toBe('cambio de capacidad')
      expect(r.value.transferOpenTasks).toBe(true)
      expect(r.value.effectiveAt).toBe(NOW.toISOString())
      expect(r.value.escalationClerkUserId).toBeUndefined()
    }
  })

  test('a MISSING reason is 422 (an omission), a NON-STRING reason is 400 (a type error)', () => {
    for (const body of [{ ...validBody, reason: undefined }, { ...validBody, reason: '' }, { ...validBody, reason: '   ' }]) {
      const r = parseReassignBody(body, NOW)
      expect(r.ok, JSON.stringify(body)).toBe(false)
      if (!r.ok) expect(r.status).toBe(422)
    }
    const typed = parseReassignBody({ ...validBody, reason: 123 }, NOW)
    expect(typed.ok).toBe(false)
    if (!typed.ok) expect(typed.status).toBe(400)
  })

  test('a MISSING transferOpenTasks is 422 — silence is not an option', () => {
    for (const value of [undefined, null, 'true', 1, 0]) {
      const r = parseReassignBody({ ...validBody, transferOpenTasks: value }, NOW)
      expect(r.ok, String(value)).toBe(false)
      if (!r.ok) expect(r.status, String(value)).toBe(422)
    }
  })

  test('transferOpenTasks: false is a VALID, explicit decision (not the same as absent)', () => {
    const r = parseReassignBody({ ...validBody, transferOpenTasks: false }, NOW)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.transferOpenTasks).toBe(false)
  })

  test('toSteward: null / absent / blank all mean "clear the steward"', () => {
    for (const value of [null, undefined, '', '   ']) {
      const r = parseReassignBody({ ...validBody, toSteward: value }, NOW)
      expect(r.ok, String(value)).toBe(true)
      if (r.ok) expect(r.value.toSteward, String(value)).toBeNull()
    }
  })

  test('a garbage toSteward is 400, never silently dropped into a null clear', () => {
    for (const value of ['user id', 'a'.repeat(65), "x';--", 123, {}] as const) {
      const r = parseReassignBody({ ...validBody, toSteward: value }, NOW)
      expect(r.ok, String(value)).toBe(false)
      if (!r.ok) expect(r.status, String(value)).toBe(400)
    }
  })

  test('a non-object body is 400', () => {
    for (const body of [null, undefined, 42, 'x', []]) {
      const r = parseReassignBody(body, NOW)
      expect(r.ok, JSON.stringify(body)).toBe(false)
      if (!r.ok) expect(r.status).toBe(400)
    }
  })
})

test.describe('parseReassignBody · effectiveAt uses the SHIPPED date-only rule, never a second one', () => {
  test('a date-only value resolves through dueAtIsoFromDateOnly (Mexico-City day end)', () => {
    const r = parseReassignBody({ ...validBody, effectiveAt: '2026-07-30' }, NOW)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.effectiveAt).toBe(dueAtIsoFromDateOnly('2026-07-30'))
  })

  test('a CALENDAR-INVALID date-only value is 400, never rolled over into a plausible wrong date', () => {
    for (const bad of ['2026-02-31', '2026-13-01', '2026-02-30']) {
      const r = parseReassignBody({ ...validBody, effectiveAt: bad }, NOW)
      expect(r.ok, bad).toBe(false)
      if (!r.ok) expect(r.status, bad).toBe(400)
      // …and the shipped helper agrees, which is the point of importing it.
      expect(dueAtIsoFromDateOnly(bad), bad).toBeNull()
    }
  })

  test('a full ISO datetime is normalized and accepted', () => {
    const r = parseReassignBody({ ...validBody, effectiveAt: '2026-07-30T12:34:56.000Z' }, NOW)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.effectiveAt).toBe('2026-07-30T12:34:56.000Z')
  })

  test('absent or null defaults to now; garbage is 400', () => {
    for (const value of [undefined, null]) {
      const r = parseReassignBody({ ...validBody, effectiveAt: value }, NOW)
      expect(r.ok, String(value)).toBe(true)
      if (r.ok) expect(r.value.effectiveAt).toBe(NOW.toISOString())
    }
    for (const bad of ['', '  ', 'mañana', 42, {}] as const) {
      const r = parseReassignBody({ ...validBody, effectiveAt: bad }, NOW)
      expect(r.ok, String(bad)).toBe(false)
      if (!r.ok) expect(r.status, String(bad)).toBe(400)
    }
  })
})

test.describe('parseReassignBody · escalationClerkUserId', () => {
  test('absent leaves the column alone (undefined), null and blank clear it', () => {
    const absent = parseReassignBody(validBody, NOW)
    if (absent.ok) expect(absent.value.escalationClerkUserId).toBeUndefined()
    for (const value of [null, '', '   ']) {
      const r = parseReassignBody({ ...validBody, escalationClerkUserId: value }, NOW)
      expect(r.ok, String(value)).toBe(true)
      if (r.ok) expect(r.value.escalationClerkUserId, String(value)).toBeNull()
    }
  })

  test('a valid id is kept; garbage is 400', () => {
    const good = parseReassignBody({ ...validBody, escalationClerkUserId: 'user_boss' }, NOW)
    if (good.ok) expect(good.value.escalationClerkUserId).toBe('user_boss')
    for (const bad of ['user boss', 'a'.repeat(65), 7] as const) {
      const r = parseReassignBody({ ...validBody, escalationClerkUserId: bad }, NOW)
      expect(r.ok, String(bad)).toBe(false)
      if (!r.ok) expect(r.status).toBe(400)
    }
  })
})

// ── 5. The admin route's own gate ────────────────────────────────────────────

const REASSIGN_ROUTE = 'app/api/admin/relationship/[id]/reassign/route.ts'
const FAKE_ID = '00000000-0000-0000-0000-000000000000'

test.describe('source · the admin reassign route is gated flag-first, then scope, then admin', () => {
  const route = read(REASSIGN_ROUTE)

  test('the portfolio flag gate is the FIRST await in the handler', () => {
    const body = route.slice(route.indexOf('export async function POST('))
    expect(body.indexOf('await ')).toBe(body.indexOf('await authorizePortfolioRequest(req)'))
  })

  test('the scope check is the ONE shared helper, then narrowed to admin', () => {
    expect(route).toContain('resolveRelationshipAccess(id, auth.actor)')
    expect(route).toMatch(/access\.role !== 'admin'/)
    expect(route).toContain('auth.actor.isAdmin')
    // The 403 for an out-of-scope id carries no record fields.
    expect(route).toMatch(/NextResponse\.json\(\{ ok: false \}, \{ status: access\.status \}\)/)
  })

  test('the scope check precedes any body read', () => {
    const scopeAt = route.indexOf('resolveRelationshipAccess(')
    const bodyAt = route.indexOf('await req.json()')
    expect(scopeAt).toBeGreaterThan(-1)
    expect(bodyAt).toBeGreaterThan(scopeAt)
  })

  test('the route builds no update payload itself — it only calls the shared writer', () => {
    expect(route).toContain('reassignSteward({')
    expect(route).not.toContain(".from('merchant_relationships')")
    expect(route).not.toContain('.update(')
  })

  test('the response always reports the task counts, so "nothing was said" is impossible', () => {
    expect(route).toContain('openTaskCount:')
    expect(route).toContain('tasksTransferred:')
  })
})

test.describe('live · the admin reassign route never serves an anonymous caller', () => {
  test('never 200, never 5xx, never a relationship body', async ({ request }) => {
    const res = await request.post(`/api/admin/relationship/${FAKE_ID}/reassign`, {
      data: { toSteward: 'user_x', reason: 'prueba', transferOpenTasks: true },
    })
    expect(res.status()).not.toBe(200)
    expect(res.status()).toBeLessThan(500)
    expect(await res.text()).not.toContain('"businessName"')
  })

  test('a body missing reason / transferOpenTasks still never 500s (the gate fires first)', async ({ request }) => {
    const res = await request.post(`/api/admin/relationship/${FAKE_ID}/reassign`, { data: {} })
    expect(res.status()).toBeLessThan(500)
  })
})
