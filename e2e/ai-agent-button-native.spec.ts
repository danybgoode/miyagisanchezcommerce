import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

test('S3.3 · D15 — AIAgentButton keeps client context but delegates modality to dialog', () => {
  const source = readFileSync('app/components/AIAgentButton.tsx', 'utf8')
  expect(source).toContain("'use client'")
  expect(source).toContain('<dialog')
  expect(source).toContain('showModal()')
  expect(source).toContain('onClose={() => setOpen(false)}')
  expect(source).toContain('event.target === event.currentTarget')
  expect(source).not.toContain('sheet-backdrop')
})
