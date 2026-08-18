import { test, expect } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import {
  MAX_SETTINGS_COMPONENT_LINES,
  SETTINGS_DIR,
  CANAL_PROPIO_DIR,
  SHOP_STUDIO_DIR,
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
 *
 * Also scans `CANAL_PROPIO_DIR` (catalog-management S6.2) — the federation page
 * split out of the old `canal` settings section lives OUTSIDE `SETTINGS_DIR`, and
 * an independent review caught it crept to 977 lines right after the split before
 * a follow-up extraction fixed it. Without this second root the guard would have
 * silently stopped covering that surface the moment it moved out of Settings.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

async function scanGuardedTree() {
  const [settingsFiles, canalPropioFiles, studioFiles] = await Promise.all([
    scanSettingsTree(repoRoot, SETTINGS_DIR),
    scanSettingsTree(repoRoot, CANAL_PROPIO_DIR),
    // Living Shop studio (epic 07, D8) — guarded from its first commit, not after
    // it grows. See SHOP_STUDIO_DIR's comment.
    scanSettingsTree(repoRoot, SHOP_STUDIO_DIR),
  ])
  return [...settingsFiles, ...canalPropioFiles, ...studioFiles]
}

test.describe('shop-settings-no-monolith · guard', () => {
  test(`no settings component exceeds ${MAX_SETTINGS_COMPONENT_LINES} lines`, async () => {
    const files = await scanGuardedTree()
    // sanity: the scan actually found the refactored tree
    expect(files.length).toBeGreaterThan(5)
    const offenders = findOversizedSettingsFiles(files)
    expect(offenders.map(formatMonolithOffense)).toEqual([])
  })

  // A guarded root that scans nothing passes forever, and a root asserted only
  // against ITSELF passes even when it points somewhere else entirely — the first
  // version of this test did exactly that and survived a mutation repointing
  // SHOP_STUDIO_DIR at canal-propio. So it names a file the studio actually owns:
  // the assertion is pinned to the POPULATION, not to the constant.
  test('the Living Shop studio root is actually covered, not just declared', async () => {
    const files = await scanGuardedTree()
    const studioFiles = files.filter((f) => f.filePath.startsWith('app/(shell)/shop/manage/tienda/'))
    expect(studioFiles.map((f) => f.filePath.split('/').pop()).sort())
      .toEqual(expect.arrayContaining(['StudioClient.tsx', 'WallComposer.tsx', 'WallTab.tsx', 'page.tsx']))
  })

  test('the ShopSettings.tsx monolith stays deleted', async () => {
    const files = await scanGuardedTree()
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
