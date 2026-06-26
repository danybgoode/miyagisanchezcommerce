import { test, expect } from '@playwright/test'
import { buildAgentPrompt } from '../lib/agent-prompt'

test.describe('buildAgentPrompt · generic es-MX hand-off (S1.2)', () => {
  const prompt = buildAgentPrompt({ kind: 'generic' })

  test('is fully es-MX (no leftover English body line)', () => {
    expect(prompt).toContain('Eres mi asistente de compras')
    // The old prompt carried these English lines + a bilingual close; they must be gone.
    expect(prompt).not.toContain('You are my personal shopping assistant')
    expect(prompt).not.toContain('What are you looking for today')
    expect(prompt).not.toContain('Before helping me')
  })

  test('keeps the cold-agent preamble pointing at /agent + ucp.dev', () => {
    expect(prompt).toContain('https://miyagisanchez.com/agent')
    expect(prompt).toContain('https://ucp.dev')
  })

  test('ends with the generic ask (never empty)', () => {
    expect(prompt.trim().length).toBeGreaterThan(0)
    expect(prompt).toContain('¿Qué estás buscando hoy?')
  })
})
