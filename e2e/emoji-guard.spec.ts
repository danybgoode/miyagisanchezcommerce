import { expect, test } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import {
  findEmojiChromeOffenders,
  findEmojiChromeOffendersInSourceFiles,
  formatOffense,
  withinEnforcedSweep,
} from '../lib/emoji-guard'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

test.describe('emoji-to-iconoir guard', () => {
  test("the Sprint 1 sweep's enforced coverage has no remaining bare emoji chrome", async () => {
    const offenders = withinEnforcedSweep(await findEmojiChromeOffenders(repoRoot))
    expect(offenders.map(formatOffense)).toEqual([])
  })

  test('negative fixture: a new bare emoji in a swept file goes red; an unswept file stays advisory-only', () => {
    const files = [
      { filePath: 'app/components/BuyButton.tsx', content: '<span>🚀</span>' },
      { filePath: 'app/components/SomeUnsweptComponent.tsx', content: '<span>🚀</span>' },
    ]
    const offenders = findEmojiChromeOffendersInSourceFiles(files)
    expect(offenders.map(formatOffense)).toEqual([
      'app/components/BuyButton.tsx:1: 🚀 in <span>🚀</span>',
      'app/components/SomeUnsweptComponent.tsx:1: 🚀 in <span>🚀</span>',
    ])
    // Only the swept file's offense gates; the unswept sibling is advisory-only.
    expect(withinEnforcedSweep(offenders).map(formatOffense)).toEqual([
      'app/components/BuyButton.tsx:1: 🚀 in <span>🚀</span>',
    ])
  })

  test('allowlist fixture: the celebratory 🎉 voice exceptions stay green', () => {
    const files = [
      {
        filePath: 'app/(shell)/v/[slug]/VoteClient.tsx',
        content: '<p>🎉 ¡Se alcanzó la meta! Quien votó recibirá el cupón de impresión por correo.</p>',
      },
      {
        filePath: 'app/components/SellerBundleSection.tsx',
        content: "<p>🎉 {activeTier.percent_off}% de descuento aplicado</p>",
      },
    ]
    expect(findEmojiChromeOffendersInSourceFiles(files).map(formatOffense)).toEqual([])
  })

  test('negative fixture: the same 🎉 glyph in a DIFFERENT sentence is not covered by the allowlist', () => {
    const offenders = findEmojiChromeOffendersInSourceFiles([
      { filePath: 'app/(shell)/v/[slug]/VoteClient.tsx', content: '<span>🎉</span>' },
    ])
    expect(offenders.map(formatOffense)).toEqual([
      'app/(shell)/v/[slug]/VoteClient.tsx:1: 🎉 in <span>🎉</span>',
    ])
  })

  test('exclusion fixture: admin/api/style-sandbox stay green regardless of emoji content', () => {
    const files = [
      { filePath: 'app/(shell)/admin/page.tsx', content: '<span>📦</span>' },
      { filePath: 'app/api/some-route/route.ts', content: 'export const note = "📦"' },
      { filePath: 'app/style-sandbox/page.tsx', content: '<span>📦</span>' },
    ]
    expect(findEmojiChromeOffendersInSourceFiles(files).map(formatOffense)).toEqual([])
  })

  test('negative fixture: the blocks the pattern was blind to are now caught', () => {
    // Every glyph here sat in an ENFORCED file, green, because the pattern's
    // ranges did not include its block. The file list was right; the detector
    // had the hole. That is why this fixture exists and why it names the
    // specific glyphs rather than asserting "some emoji is caught".
    const offenders = findEmojiChromeOffendersInSourceFiles([
      { filePath: 'app/components/BuyButton.tsx', content: '<span>🆕</span>' },   // U+1F195, Enclosed Alphanumeric Supp.
      { filePath: 'app/components/BuyButton.tsx', content: '<span>⏳</span>' },   // U+23F3, Misc Technical
      { filePath: 'app/components/BuyButton.tsx', content: '<span>⏰</span>' },   // U+23F0
      { filePath: 'app/components/BuyButton.tsx', content: '<span>⏸</span>' },   // U+23F8
      { filePath: 'app/components/BuyButton.tsx', content: "flag: '🇲🇽'" },       // regional indicators
    ])
    expect(offenders.map((o) => o.literal)).toEqual(['🆕', '⏳', '⏰', '⏸', '🇲', '🇽'])
  })

  test('allowlist fixture: keyboard glyphs in the SAME Unicode block stay legal', () => {
    // ⌘ ⌥ ⌫ ⏎ live in Miscellaneous Technical alongside ⏳, and they are real text
    // in a shortcut hint, not icon chrome. Banning a whole block because part of
    // it is emoji would reject correct output — and a guard that does that gets
    // bypassed rather than fixed.
    const offenders = findEmojiChromeOffendersInSourceFiles([
      { filePath: 'app/components/BuyButton.tsx', content: '<kbd>⌘</kbd> + <kbd>⏎</kbd> para enviar' },
    ])
    expect(offenders.map(formatOffense)).toEqual([])
  })

  test('negative fixture: an arrow glyph used for navigation is untouched by this guard (different convention, out of scope)', () => {
    const offenders = findEmojiChromeOffendersInSourceFiles([
      { filePath: 'app/components/BuyButton.tsx', content: '<a href="/back">← Volver</a>' },
    ])
    expect(offenders.map(formatOffense)).toEqual([])
  })
})
