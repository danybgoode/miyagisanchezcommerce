import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

test('S3.3 · D15 — CuentaMenu uses a native popover with a CSS anchor enhancement', () => {
  const source = readFileSync('app/components/CuentaMenu.tsx', 'utf8')
  const css = readFileSync('app/globals.css', 'utf8')
  expect(source).toContain('popoverTarget="cuenta-menu"')
  expect(source).toContain('popover="auto"')
  expect(source).not.toContain('addEventListener')
  expect(source).toMatch(/position:\s*'fixed'/)
  expect(source).toMatch(/top:\s*56/)
  expect(css).toContain('anchor-name: --cuenta-menu-trigger')
  expect(css).toContain('position-anchor: --cuenta-menu-trigger')
})
