import { test, expect } from '@playwright/test'
import { validateConfig, type StoreConfigManifest } from '../lib/settings-import'

/**
 * mcp-parity-core S4 — the `support` and `checkout` config blocks in the
 * Storefront-as-Code validator (shared by the settings-import file route and
 * the MCP `patch_store_configuration` tool).
 *
 * These are PURE validateConfig tests (no server, no network) — the named
 * validation matrix is the story's acceptance, so every rule gets its own
 * assertion. The MCP-layer flag gates (mcp.support_config.enabled /
 * mcp.checkout_config.enabled refuse the whole call) and the real
 * provisioning side effect are Daniel's sprint-4.md smoke — same
 * `ms_agent_…` fixture gap every seller-tool spec notes.
 */

const validSupport = {
  enabled: true,
  preset_amount_cents: [5000, 10000, 20000],
  custom_min_cents: 2000,
  custom_max_cents: 500000,
  currency: 'MXN',
}

function supportResult(manifest: StoreConfigManifest) {
  const { blocks, patch } = validateConfig(manifest)
  return { block: blocks.find((b) => b.key === 'support'), support: patch.settings?.support as Record<string, unknown> | undefined }
}

test.describe('support block — the full normalizeSupportSettings matrix', () => {
  test('a valid config applies, normalized', () => {
    const { block, support } = supportResult({ support: validSupport })
    expect(block?.status).toBe('applied')
    expect(support?.enabled).toBe(true)
    expect(support?.preset_amount_cents).toEqual([5000, 10000, 20000])
    expect(support?.currency).toBe('MXN')
  })

  test('exactly 3 presets required — 2 presets rejects the block', () => {
    const { block, support } = supportResult({ support: { ...validSupport, preset_amount_cents: [5000, 10000] } })
    expect(block?.status).toBe('skipped')
    expect(block?.issues.join(' ')).toContain('exactamente tres montos')
    expect(support).toBeUndefined()
  })

  test('min below $1 MXN rejects', () => {
    const { block } = supportResult({ support: { ...validSupport, custom_min_cents: 50 } })
    expect(block?.status).toBe('skipped')
    expect(block?.issues.join(' ')).toContain('al menos $1')
  })

  test('max above $5,000 MXN rejects', () => {
    const { block } = supportResult({ support: { ...validSupport, custom_max_cents: 600000 } })
    expect(block?.status).toBe('skipped')
    expect(block?.issues.join(' ')).toContain('5,000')
  })

  test('min > max rejects', () => {
    const { block } = supportResult({ support: { ...validSupport, custom_min_cents: 400000, custom_max_cents: 300000 } })
    expect(block?.status).toBe('skipped')
    expect(block?.issues.join(' ')).toContain('mayor que el máximo')
  })

  test('a preset outside [min,max] rejects', () => {
    const { block } = supportResult({ support: { ...validSupport, preset_amount_cents: [100, 10000, 20000], custom_min_cents: 2000 } })
    expect(block?.status).toBe('skipped')
    expect(block?.issues.join(' ')).toContain('dentro del rango')
  })

  test('a non-3-letter currency rejects', () => {
    const { block } = supportResult({ support: { ...validSupport, currency: 'PESOS' } })
    expect(block?.status).toBe('skipped')
    expect(block?.issues.join(' ')).toContain('moneda')
  })

  test('support_product_id from the caller is ALWAYS dropped (server-assigned at provisioning)', () => {
    const { block, support } = supportResult({
      support: { ...validSupport, support_product_id: 'prod_attacker_chosen' } as never,
    })
    expect(block?.status).toBe('applied')
    expect(support?.support_product_id).toBeUndefined()
    expect(block?.issues.join(' ')).toContain('support_product_id')
  })
})

function checkoutResult(manifest: StoreConfigManifest) {
  const { blocks, patch } = validateConfig(manifest)
  return { block: blocks.find((b) => b.key === 'checkout'), checkout: patch.settings?.checkout as Record<string, unknown> | undefined }
}

test.describe('checkout block — authored validation (previously ~zero even in the portal)', () => {
  test('escrow_mode accepts exactly the enum', () => {
    for (const mode of ['off', 'optional', 'required'] as const) {
      const { block, checkout } = checkoutResult({ checkout: { escrow_mode: mode } })
      expect(block?.status).toBe('applied')
      expect(checkout?.escrow_mode).toBe(mode)
    }
    const { block, checkout } = checkoutResult({ checkout: { escrow_mode: 'siempre' } as never })
    expect(block?.status).toBe('skipped')
    expect(block?.issues.join(' ')).toContain('escrow_mode')
    expect(checkout).toBeUndefined()
  })

  test('whatsapp_cta / show_phone must be real booleans — strings are rejected, not coerced', () => {
    const ok = checkoutResult({ checkout: { whatsapp_cta: true, show_phone: false } })
    expect(ok.block?.status).toBe('applied')
    expect(ok.checkout).toEqual({ whatsapp_cta: true, show_phone: false })

    const bad = checkoutResult({ checkout: { whatsapp_cta: 'true' } as never })
    expect(bad.block?.status).toBe('skipped')
    expect(bad.block?.issues.join(' ')).toContain('whatsapp_cta')
  })

  test('cash_pickup.enabled validates as a nested boolean', () => {
    const ok = checkoutResult({ checkout: { cash_pickup: { enabled: true } } })
    expect(ok.block?.status).toBe('applied')
    expect(ok.checkout?.cash_pickup).toEqual({ enabled: true })

    const bad = checkoutResult({ checkout: { cash_pickup: 'yes' } as never })
    expect(bad.block?.status).toBe('skipped')
  })

  test('bank_transfer and contact_email are NEVER settable — dropped with an issue, never written', () => {
    const { block, checkout } = checkoutResult({
      checkout: {
        escrow_mode: 'optional',
        bank_transfer: { enabled: true, clabe: '123456789012345678' },
        contact_email: 'attacker@example.com',
        show_email: true,
        phone: '5512345678',
      } as never,
    })
    // The legit field still applies; the forbidden ones are dropped + named.
    expect(block?.status).toBe('applied')
    expect(checkout).toEqual({ escrow_mode: 'optional' })
    const issues = block?.issues.join(' ') ?? ''
    expect(issues).toContain('bank_transfer')
    expect(issues).toContain('contact_email')
    expect(issues).toContain('show_email')
    expect(issues).toContain('phone')
  })
})

test.describe('patch_store_configuration — S4 blocks advertised in the tool schema', () => {
  test('the configuration schema documents support (with the provisioning warning) and checkout (with the never-settable fields)', async ({ request }) => {
    const res = await request.post('/api/ucp/mcp', { data: { jsonrpc: '2.0', id: 1, method: 'tools/list' } })
    const tools: Array<{ name: string; inputSchema?: { properties?: { configuration?: { properties?: Record<string, { description?: string }> } } } }> =
      (await res.json()).result.tools
    const props = tools.find((t) => t.name === 'patch_store_configuration')?.inputSchema?.properties?.configuration?.properties
    expect(props?.support?.description).toContain('PROVISIONS A REAL')
    expect(props?.checkout?.description).toContain('NEVER settable')
  })
})
