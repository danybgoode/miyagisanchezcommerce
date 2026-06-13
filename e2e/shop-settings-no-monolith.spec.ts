import { test, expect } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import {
  MAX_SETTINGS_COMPONENT_LINES,
  SETTINGS_DIR,
  findOversizedSettingsFiles,
  findBannedSettingsFiles,
  formatMonolithOffense,
  scanSettingsTree,
} from '../lib/shop-settings/monolith-guard'

/**
 * Shop Settings refactor · Sprint 4 — the anti-monolith guard.
 *
 * Sprint 4 deleted the 4,076-line `ShopSettings.tsx` monolith; every section now
 * lives in its own component. This guard keeps the surface from silently eroding
 * back: no settings component may exceed the line cap, and `ShopSettings.tsx` may
 * never reappear. Same shape as the raw-color guard — pure offender-finders run
 * against the real tree plus in-memory negative fixtures. No network/auth.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

test.describe('shop-settings-no-monolith · guard', () => {
  test(`no settings component exceeds ${MAX_SETTINGS_COMPONENT_LINES} lines`, async () => {
    const files = await scanSettingsTree(repoRoot)
    // sanity: the scan actually found the refactored tree
    expect(files.length).toBeGreaterThan(5)
    const offenders = findOversizedSettingsFiles(files)
    expect(offenders.map(formatMonolithOffense)).toEqual([])
  })

  test('the ShopSettings.tsx monolith stays deleted', async () => {
    const files = await scanSettingsTree(repoRoot)
    const offenders = findBannedSettingsFiles(files)
    expect(offenders.map(formatMonolithOffense)).toEqual([])
  })

  test('negative fixture: an oversized settings file goes red', () => {
    const fat = `${SETTINGS_DIR}/_sections/Fat.tsx`
    const offenders = findOversizedSettingsFiles([
      { filePath: fat, content: 'x\n'.repeat(MAX_SETTINGS_COMPONENT_LINES + 1) },
    ])
    expect(offenders.map((o) => o.filePath)).toEqual([fat])
    expect(offenders[0].kind).toBe('oversized')
  })

  test('negative fixture: a reappeared ShopSettings.tsx goes red', () => {
    const monolith = `${SETTINGS_DIR}/ShopSettings.tsx`
    const offenders = findBannedSettingsFiles([
      { filePath: monolith, content: 'export default function ShopSettingsPanel() { return null }' },
    ])
    expect(offenders.map((o) => o.filePath)).toEqual([monolith])
    expect(offenders[0].kind).toBe('banned')
  })

  test('a file exactly at the cap is allowed', () => {
    const ok = `${SETTINGS_DIR}/_sections/Edge.tsx`
    // exactly MAX lines (no trailing-newline inflation) → allowed
    const content = Array.from({ length: MAX_SETTINGS_COMPONENT_LINES }, () => 'x').join('\n')
    expect(findOversizedSettingsFiles([{ filePath: ok, content }])).toEqual([])
  })
})
