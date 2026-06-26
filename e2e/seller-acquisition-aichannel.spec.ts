import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

// US-4 (Sprint 3) — the AI-channel value-prop section. Locked copy from COPY-BRIEF.md §5
// (approved 2026-06-25). Pure fs read (no server) so it runs in the always-on api gate.
type AiChannel = {
  eyebrow: string
  title: string
  body: string
  steps: { title: string; body: string }[]
  note: string
}
const es = JSON.parse(readFileSync(new URL('../locales/es.json', import.meta.url), 'utf8')) as {
  sellerAcquisition: { aiChannel?: AiChannel }
}
const aiChannel = es.sellerAcquisition.aiChannel

test.describe('seller acquisition · AI-channel section (US-4)', () => {
  test('aiChannel block exists with eyebrow, title, body, and a three-step "cómo funciona"', () => {
    expect(aiChannel, 'sellerAcquisition.aiChannel must exist').toBeTruthy()
    expect(aiChannel!.eyebrow.length).toBeGreaterThan(0)
    expect(aiChannel!.title.length).toBeGreaterThan(0)
    expect(aiChannel!.steps).toHaveLength(3)
    for (const step of aiChannel!.steps) {
      expect(step.title.length).toBeGreaterThan(0)
      expect(step.body.length).toBeGreaterThan(0)
    }
    expect(aiChannel!.note.length).toBeGreaterThan(0)
  })

  test('frames the channel via the open UCP/MCP standard (truthful, not vapor)', () => {
    expect(aiChannel!.body).toContain('UCP/MCP')
    expect(aiChannel!.body.toLowerCase()).toContain('estándar abierto')
  })

  test('makes no unverified named-assistant purchase claim (anti-vaporware guardrail)', () => {
    const blob = JSON.stringify(aiChannel).toLowerCase()
    const banned = ['compra en chatgpt', 'compra en claude', 'compra en gemini', 'botón de compra', 'boton de compra']
    for (const phrase of banned) {
      expect(blob, `banned named-buy claim "${phrase}" must not appear`).not.toContain(phrase)
    }
  })
})
