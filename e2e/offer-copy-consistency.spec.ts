import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Trust & Messaging Polish · Sprint 1 (C.3) — offer-expiry copy honesty guard.
 *
 * MakeOfferButton.tsx used to contradict itself: "Tu oferta expira en 48 horas" next
 * to "El vendedor responde en menos de 24 h". The real pending window is 48h
 * (`expires_at`). This is a deterministic source-scan (like the raw-hex token guard)
 * that fails CI if the contradictory "menos de 24 h" copy ever returns and that the
 * honest "48 horas" window is present — cheaper + less brittle than driving the modal.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

test.describe('offer-copy consistency · MakeOfferButton', () => {
  test('no "menos de 24 h" lie; the honest 48h window is stated', async () => {
    const src = await readFile(path.join(repoRoot, 'app/components/MakeOfferButton.tsx'), 'utf8')
    expect(src).not.toContain('menos de 24 h')
    expect(src).toContain('48 horas')
  })
})
