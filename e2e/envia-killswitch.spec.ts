import { test, expect } from '@playwright/test'
import {
  enviaKillGate,
  ENVIA_ARRANGED_DELIVERY_MESSAGE,
  ENVIA_LABEL_DISABLED_MESSAGE,
} from '../lib/envia-killswitch'

/**
 * Envía kill-switch · Sprint 1 — pure decision seam (frontend mirror).
 * `shipping.envia_enabled` (enablement polarity / default OFF). The flag *value* is
 * resolved by lib/flags.ts (fail-open); this proves the gate + es-MX fallback copy
 * used by the legacy FE ship/re-quote routes and the settings banner.
 */

test.describe('envía kill-switch · shipping.envia_enabled', () => {
  test('flag ON → passthrough (Envía calls allowed)', () => {
    expect(enviaKillGate({ enviaEnabled: true })).toEqual({ blocked: false })
  })

  test('flag OFF → blocked (the fail-open default)', () => {
    expect(enviaKillGate({ enviaEnabled: false })).toEqual({
      blocked: true,
      reason: 'platform_envia_disabled',
    })
  })

  test('fallback copy is es-MX (quote → arranged delivery, label → manual carrier)', () => {
    expect(ENVIA_ARRANGED_DELIVERY_MESSAGE).toContain('coordinar la entrega directamente')
    expect(ENVIA_LABEL_DISABLED_MESSAGE).toContain('paquetería manual')
    // No stray English in either user-facing string.
    for (const msg of [ENVIA_ARRANGED_DELIVERY_MESSAGE, ENVIA_LABEL_DISABLED_MESSAGE]) {
      expect(msg).not.toMatch(/\b(shipping|carrier|disabled|available|please)\b/i)
    }
  })
})
