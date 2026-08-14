/**
 * The Golden scenario wire protocol is PINNED (golden-frijoles-integration · D3, S1.4).
 *
 * ── WHY THIS SPEC EXISTS ──────────────────────────────────────────────────────
 * Golden Beans was renamed Golden Frijoles, and the SDK package moved with it. The
 * scenario ownership and security handshake did NOT move: Golden still sends and
 * verifies `x-golden-beans-ownership-request` and still signs
 * `golden-beans-target-request-v1`. Verified on both sides at migration time —
 * `apps/web/lib/scenario-target-proof.ts` and `scenario-security-request.ts` in the
 * golden-beans repo carry these exact literals.
 *
 * These strings are SIGNED MATERIAL. They are concatenated into the payload that
 * both ends HMAC, so renaming one here does not produce a mismatch error — it
 * produces a signature that silently fails to verify, on a path whose whole job is
 * to prove ownership. A repo-wide find-and-replace of "golden-beans" during the SDK
 * migration would have done exactly that, which is why the migration touched only
 * module specifiers.
 *
 * If a future rename is genuinely wanted, it is a coordinated two-repo change with a
 * version bump on the envelope — not an edit to this file to make it pass.
 */
import { test, expect } from '@playwright/test'
import {
  SCENARIO_TARGET_PROOF_HEADER,
  SCENARIO_TARGET_REQUEST_HEADER,
  SCENARIO_SECURITY_REQUEST_HEADER,
} from '../lib/scenario-target-contract'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test.describe('scenario wire protocol — pinned literals', () => {
  test('the ownership + security HEADERS keep their golden-beans names', () => {
    expect(SCENARIO_TARGET_REQUEST_HEADER).toBe('x-golden-beans-ownership-request')
    expect(SCENARIO_TARGET_PROOF_HEADER).toBe('x-golden-beans-ownership-proof')
    expect(SCENARIO_SECURITY_REQUEST_HEADER).toBe('x-golden-beans-scenario-request')
  })

  test('the signing ENVELOPES keep their golden-beans names', () => {
    // Read the source rather than importing the builders: the envelope strings are
    // embedded in template literals inside signing functions, and asserting on the
    // source is what catches a rename regardless of how the function is called.
    const source = readFileSync(join(process.cwd(), 'lib', 'scenario-target-contract.ts'), 'utf8')
    for (const envelope of [
      'golden-beans-target-request-v1',
      'golden-beans-target-response-v1',
      'golden-beans-security-request-v1',
    ]) {
      expect(source, `${envelope} is signed material shared with Golden — renaming it breaks verification silently`).toContain(envelope)
    }
  })

  test('no scenario literal was collaterally renamed to golden-frijoles', () => {
    // The failure this guards is a well-meaning sweep. If someone renames the brand
    // across the file, this catches it even if they also updated the constants above.
    const source = readFileSync(join(process.cwd(), 'lib', 'scenario-target-contract.ts'), 'utf8')
    expect(source).not.toContain('golden-frijoles')
  })
})

test.describe('the SDK import moved, and only the import', () => {
  test('no source file still imports the old package name', () => {
    // A stale specifier would fail to resolve at build time, but this states the
    // migration's completeness as a fact rather than relying on the bundler.
    const files = ['lib/golden-flag-provider.ts', 'lib/golden-scenario-provider.ts', 'lib/growth-engine.ts']
    for (const file of files) {
      const source = readFileSync(join(process.cwd(), file), 'utf8')
      expect(source, `${file} still imports @golden-beans/sdk`).not.toContain('@golden-beans/sdk')
      expect(source).toContain('@golden-frijoles/sdk')
    }
  })
})
