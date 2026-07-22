/**
 * e2e/_fixtures/merchant-lifecycle.ts
 *
 * Loader for the shared lifecycle fixtures (Golden Beans event-destination-router
 * Story 3.1, Sprint 3 QA: "identical lifecycle fixtures run in both repos' suites").
 *
 * Read from disk with `fs` rather than `import`ed, so the fixture file stays plain
 * JSON that either repo can hold a byte-identical copy of — and so `fixturesDigest()`
 * can prove they are identical instead of asserting it in a comment.
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The package is `"type": "module"`, so `__dirname` does not exist here.
const FIXTURES_PATH = join(dirname(fileURLToPath(import.meta.url)), 'merchant-lifecycle.fixtures.json')

export interface LifecycleFixture {
  name: string
  expect: { kind: string; reason?: string; merchantId?: string }
  envelope: Record<string, unknown>
}

interface FixtureFile {
  lifecycle: LifecycleFixture[]
  shaping: LifecycleFixture[]
}

const parsed = JSON.parse(readFileSync(FIXTURES_PATH, 'utf8')) as FixtureFile

/** The six lifecycle events, in funnel order. */
export const lifecycleFixtures: LifecycleFixture[] = parsed.lifecycle

/** Envelope-shaping edge cases: omitted fields, half-populated subjects, test sends. */
export const shapingFixtures: LifecycleFixture[] = parsed.shaping

export const allFixtures: LifecycleFixture[] = [...parsed.lifecycle, ...parsed.shaping]

/**
 * sha256 of the fixture file's exact bytes. The golden-beans suite asserts the SAME
 * digest against its own copy; a drift on either side turns into a failing test rather
 * than a cross-repo contract that quietly stopped being shared.
 */
export function fixturesDigest(): string {
  return createHash('sha256').update(readFileSync(FIXTURES_PATH)).digest('hex')
}

/**
 * Serialize an envelope the way golden-beans' `serializeEnvelope` does — a FIXED key
 * order (id, type, occurredAt, [test], data), because the output is what gets signed.
 * Handing an arbitrary object to JSON.stringify would produce a different byte string
 * for the same logical envelope, and the signature would not match.
 *
 * Copied from golden-beans `apps/web/lib/delivery-payload.ts`. Lives in the test
 * fixtures rather than in `lib/` on purpose: Miyagi RECEIVES envelopes, it never
 * produces them, so shipping a serializer in production code would invite someone to
 * verify against a re-serialized object — the one mistake this endpoint must not make.
 */
export function serializeEnvelope(envelope: Record<string, unknown>): string {
  const ordered: Record<string, unknown> = {
    id: envelope.id,
    type: envelope.type,
    occurredAt: envelope.occurredAt,
  }
  if (envelope.test) ordered.test = true
  ordered.data = envelope.data
  return JSON.stringify(ordered)
}
