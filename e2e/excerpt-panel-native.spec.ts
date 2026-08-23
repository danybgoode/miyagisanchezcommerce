import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

test('S3.3 · D15 — ExcerptPanel is server-rendered native details', () => {
  const source = readFileSync('app/(shell)/l/[id]/ExcerptPanel.tsx', 'utf8')
  const css = readFileSync('app/globals.css', 'utf8')
  expect(source).not.toContain("'use client'")
  expect(source).not.toContain('useState')
  expect(source).toContain('<details')
  expect(source).toContain('<summary')
  expect(source).toContain('excerpt-panel-arrow')
  expect(css).toContain('details[open] > summary .excerpt-panel-arrow')
})
