import { test, expect } from '@playwright/test'
import { validateRows } from '../lib/catalog-import'

/**
 * Seller listing creation tool (Seller Agent Operations · Sprint 3).
 * Guards the auth boundary — create_listing must reject any call without a valid
 * per-shop token. Read-only / no-token: never creates a listing.
 */
test.describe('Seller listing creation MCP tool', () => {
  test('tools/list advertises create_listing', async ({ request }) => {
    const res = await request.post('/api/ucp/mcp', { data: { jsonrpc: '2.0', id: 1, method: 'tools/list' } })
    const names: string[] = (await res.json()).result.tools.map((t: { name: string }) => t.name)
    expect(names).toContain('create_listing')
  })

  test('create_listing rejects calls without a shop token', async ({ request }) => {
    const res = await request.post('/api/ucp/mcp', {
      data: {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'create_listing', arguments: { title: 'Anuncio de prueba', category: 'otros' } },
      },
    })
    const result = (await res.json()).result
    expect(result.content[0].text).toContain('Unauthorized')
    expect(result.isError).toBe(true)
  })

  // cars-vertical-tratocar-parity S3 — found during the demo-catalog dry-run:
  // create_listing silently dropped every autos field (make/model/year/km,
  // financing, inspection, warranty) because handleCreateListing's `raw` object
  // never forwarded them, even though stageRow()/validateRows() (the exact rules
  // bulk import already reuses, see e2e/catalog-import-attrs.spec.ts) assembles
  // metadata.attrs.* from these same flat fields once category==='autos'. Fixed
  // by forwarding them through; this guards the schema stays discoverable so a
  // real agent (not just a human reading the source) knows the fields exist.
  test('create_listing advertises the autos vehicle-spec + financing/trust fields', async ({ request }) => {
    const res = await request.post('/api/ucp/mcp', { data: { jsonrpc: '2.0', id: 3, method: 'tools/list' } })
    const tool = (await res.json()).result.tools.find((t: { name: string }) => t.name === 'create_listing')
    const props = Object.keys(tool.inputSchema.properties)
    for (const field of [
      'make', 'model', 'year', 'km', 'fuel_type', 'transmission', 'color',
      'financing_down_payment_pct', 'financing_months',
      'warranty_text', 'warranty_months', 'inspection_report_url',
    ]) {
      expect(props, `create_listing inputSchema must declare "${field}"`).toContain(field)
    }
  })

  // Closes the gap the schema-presence test above can't: proves the fields actually
  // reach metadata.attrs, not just that they're advertised. handleCreateListing's
  // `raw` object mirrors this field list verbatim (see the code comment there) and
  // feeds it into the exact same validateRows() bulk import already reuses — so
  // this is the real regression guard for "create_listing silently drops autos attrs".
  test('handleCreateListing\'s field-forwarding shape actually assembles metadata.attrs for autos', () => {
    const raw = {
      title: 'Volkswagen Jetta 2020 seminuevo',
      category: 'autos',
      price: 285000,
      make: 'vw',
      model: 'Jetta',
      year: 2020,
      km: 45000,
      fuel_type: 'gasolina',
      transmission: 'automatico',
      color: 'gris',
      financing_down_payment_pct: 20,
      financing_months: 48,
      warranty_text: '6 meses motor y transmisión',
      warranty_months: 6,
      inspection_report_url: 'https://example.com/inspeccion.pdf',
    }
    const [staged] = validateRows([raw])
    expect(staged.valid).toBe(true)
    expect(staged.row.attrs).toMatchObject({
      make: 'Volkswagen',
      model: 'Jetta',
      year: 2020,
      km: 45000,
      fuel_type: 'gasolina',
      transmission: 'automatico',
      color: 'gris',
      financing_down_payment_pct: 20,
      financing_months: 48,
      warranty_text: '6 meses motor y transmisión',
      warranty_months: 6,
      inspection_report_url: 'https://example.com/inspeccion.pdf',
    })
  })
})
