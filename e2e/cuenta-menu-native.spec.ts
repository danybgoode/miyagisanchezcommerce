import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

test('S3.3 · D15 — CuentaMenu uses a native popover with a CSS anchor enhancement', () => {
  const source = readFileSync('app/components/CuentaMenu.tsx', 'utf8')
  const css = readFileSync('app/globals.css', 'utf8')
  expect(source).toContain("'showPopover' in HTMLElement.prototype")
  expect(source).toContain('useId')
  expect(source).toContain('popoverTarget={supportsPopover ? menuId : undefined}')
  expect(source).toContain("popover={supportsPopover ? 'auto' : undefined}")
  expect(source).toContain('ref={menuRef}')
  expect(source).toContain('menuRef.current?.hidePopover()')
  expect(source).toContain("supportsPopover === false && event.key === 'Escape'")
  expect(source).toContain("!event.relatedTarget || !event.currentTarget.contains(event.relatedTarget)")
  expect(source).toContain("display: supportsPopover ? undefined : open ? 'flex' : 'none'")
  expect(source).not.toContain('addEventListener')
  expect(source).toMatch(/position:\s*'fixed'/)
  expect(source).toMatch(/top:\s*56/)
  expect(source).toContain('// header height')
  expect(source).toContain('// viewport edge margin')
  expect(css).toContain('anchor-name: var(--cuenta-menu-anchor)')
  expect(css).toContain('position-anchor: var(--cuenta-menu-anchor)')
  expect(css).toContain('.cuenta-menu-popover:popover-open { display: flex; }')
})
