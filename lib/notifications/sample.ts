/**
 * lib/notifications/sample.ts
 *
 * "Send me this one" — the pure half (marketplace-communications · D5, D6).
 *
 * ── WHY THE RECIPIENT IS A COMPILE-TIME CONSTANT ──────────────────────────────
 * This surface sends real email, from the platform's real domain, on demand, behind
 * a Clerk admin login. A free-text recipient field on it is a spam cannon with an
 * authentication page in front of it — and the blast radius of getting that wrong is
 * the sending domain's reputation, which is the one thing a marketplace's entire
 * notification rail depends on.
 *
 * So the allow-list lives HERE, in code, and a caller-supplied address is REFUSED
 * rather than adopted. Not sanitised, not normalised into the nearest allowed value:
 * refused. Widening it is a deliberate edit to this file, reviewed like any other
 * code change.
 *
 * Pure: no I/O, no `server-only`. The route is the shell that calls the fixture.
 */

/**
 * The only addresses a sample may reach. Named by the product owner on 2026-08-14.
 *
 * `as const` so the type is the union of these three literals — a route cannot pass
 * an arbitrary string without the compiler objecting first, which makes the guard a
 * type error before it is ever a runtime check.
 */
export const SAMPLE_RECIPIENTS = [
  'champion327@gmail.com',
  'danielvp1987@gmail.com',
  'daniel@despachobonsai.com',
] as const

export type SampleRecipient = (typeof SAMPLE_RECIPIENTS)[number]

/**
 * Is this an address a sample may be sent to?
 *
 * Deliberately exact: no trimming, no lowercasing, no punycode folding. Every
 * normalisation is a place where two different strings become one, and this is a
 * predicate about *where mail goes*. A caller that sends ` Daniel@... ` gets a
 * refusal and a clear message, which is a better outcome than a silent coercion
 * that quietly widens what the allow-list means.
 */
export function isAllowedSampleRecipient(value: unknown): value is SampleRecipient {
  return typeof value === 'string' && (SAMPLE_RECIPIENTS as readonly string[]).includes(value)
}

export type SampleRequest = { key: string; to: SampleRecipient }

export type SampleRefusal = {
  ok: false
  status: 400 | 404
  reason: 'unknown_key' | 'recipient_not_allowed' | 'no_fixture'
  message: string
}

export type SampleDecision = { ok: true; request: SampleRequest } | SampleRefusal

/**
 * Validate a sample request against the catalog and the allow-list, BEFORE anything
 * is sent. Pure, so the refusal paths are unit-testable without a mail transport.
 *
 * `knownKeys` and `fixtureKeys` are injected rather than imported so this stays pure
 * and the spec can drive both "key exists but has no fixture" and "key does not
 * exist" without constructing the whole catalog.
 */
export function decideSampleSend(
  body: unknown,
  knownKeys: ReadonlySet<string>,
  fixtureKeys: ReadonlySet<string>,
): SampleDecision {
  const input = (body ?? {}) as { key?: unknown; to?: unknown }

  if (typeof input.key !== 'string' || input.key === '') {
    return { ok: false, status: 400, reason: 'unknown_key', message: 'key is required.' }
  }
  if (!knownKeys.has(input.key)) {
    return { ok: false, status: 404, reason: 'unknown_key', message: `Unknown communication: ${input.key}` }
  }
  // The allow-list check comes BEFORE the fixture lookup on purpose: a caller probing
  // with arbitrary addresses learns nothing about which templates exist.
  if (!isAllowedSampleRecipient(input.to)) {
    return {
      ok: false,
      status: 400,
      reason: 'recipient_not_allowed',
      message: `Recipient must be one of: ${SAMPLE_RECIPIENTS.join(', ')}`,
    }
  }
  if (!fixtureKeys.has(input.key)) {
    return {
      ok: false,
      status: 400,
      reason: 'no_fixture',
      message: `${input.key} has no sample payload yet.`,
    }
  }
  return { ok: true, request: { key: input.key, to: input.to } }
}
