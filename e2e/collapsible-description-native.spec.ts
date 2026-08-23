import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

test('S3.3 · D15 — CollapsibleDescription is server-rendered native details with a findable body', () => {
  const source = readFileSync('app/(shell)/l/[id]/CollapsibleDescription.tsx', 'utf8')
  const css = readFileSync('app/globals.css', 'utf8')
  expect(source).not.toContain("'use client'")
  expect(source).not.toContain('useState')
  expect(source).toMatch(/return \(\s*<details\b/)
  expect(source).toContain('<summary')
  expect(source).toContain('collapsible-description-teaser')
  expect(source).toContain('const clipped = text.slice(0, CLAMP_THRESHOLD).trimEnd()')
  expect(source).toContain("const teaser = clipped.slice(0, clipped.lastIndexOf(' ')).trimEnd() || clipped")
  expect(source).toContain('l.id.CollapsibleDescription.32e540cb')
  expect(source).toContain('l.id.CollapsibleDescription.d587022f')
  expect(css).toContain('.collapsible-description[open] .collapsible-description-teaser')
  expect(css).toContain('.collapsible-description > summary { display: block; list-style: none; }')
  expect(css).toContain('.collapsible-description > summary::-webkit-details-marker { display: none; }')
})
