import { expect, test } from '@playwright/test'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

const arbitraryHexClassPattern = /(?:bg|text|border|from|to|via|fill|stroke|ring|outline|decoration)-\[#[0-9a-fA-F]{3,8}\]/g
const rawHexPattern = /#[0-9a-fA-F]{3,8}\b/g

const sourceExtensions = new Set(['.css', '.js', '.jsx', '.ts', '.tsx'])

const excludedPrefixes = [
  'app/admin/',
  'app/api/',
  'app/style-sandbox/',
]

const excludedFiles = new Set([
  'app/apple-icon.tsx',
  'app/components/PrintAdBlock.tsx',
  'app/components/PrintAdPreview.tsx',
  'app/icon.svg',
  'app/opengraph-image.tsx',
  'app/shop/manage/PrintAdBlock.tsx',
  'app/shop/manage/PrintAdPreview.tsx',
  'lib/print-export.ts',
  'lib/print-layout.ts',
  'lib/print-qr.ts',
])

const tokenizedSurfaceFiles = [
  'app/account/favorites/page.tsx',
  'app/account/referrals/ReferralsClient.tsx',
  'app/agent/page.tsx',
  'app/checkout/CheckoutExperience.tsx',
  'app/components/CartButton.tsx',
  'app/components/CartDrawer.tsx',
  'app/components/CheckoutPayButton.tsx',
  'app/components/DesktopUnreadBadge.tsx',
  'app/components/MakeOfferButton.tsx',
  'app/components/MobileTabBar.tsx',
  'app/components/OfferCheckoutButton.tsx',
  'app/components/SellerBundleSection.tsx',
  'app/embed/s/[slug]/page.tsx',
  'app/l/page.tsx',
  'app/l/SearchBar.tsx',
  'app/l/[id]/page.tsx',
  'app/l/[id]/SubscriptionSection.tsx',
  'app/messages/page.tsx',
  'app/messages/[id]/ConversationClient.tsx',
  'app/s/[slug]/ChannelLayout.tsx',
  'app/s/[slug]/ClaimButton.tsx',
  'app/s/[slug]/ClaimForm.tsx',
  'app/s/[slug]/claim/page.tsx',
  'app/shop/manage/ManageDashboard.tsx',
  'app/shop/manage/PrintEditionCard.tsx',
  'app/shop/manage/import/ImportClient.tsx',
  'app/shop/manage/promotions/PromotionsClient.tsx',
  'app/shop/manage/settings/EmbedSnippetSection.tsx',
  'app/shop/manage/settings/ShopSettings.tsx',
  'app/shop/manage/settings/SupportWidgetSection.tsx',
  'app/shop/manage/settings/import/SettingsImportClient.tsx',
  'app/shop/manage/settings/page.tsx',
  'app/supply/SupplyClient.tsx',
]

const allowedLiteralRules = [
  {
    path: 'app/shop/manage/settings/EmbedSnippetSection.tsx',
    literal: '#111',
    contains: "accent && accent !== '#111'",
    reason: 'embed snippet data-accent default is serialized for third-party hosts',
  },
  {
    path: 'app/shop/manage/settings/SupportWidgetSection.tsx',
    literal: '#1d6f42',
    contains: "accent || '#1d6f42'",
    reason: 'support-widget preview serializes a fallback accent into iframe markup',
  },
  {
    path: 'app/shop/manage/settings/SupportWidgetSection.tsx',
    literal: '#111',
    contains: "accent && accent !== '#111'",
    reason: 'support-widget snippet data-accent default is serialized for third-party hosts',
  },
  {
    path: 'app/shop/manage/settings/SupportWidgetSection.tsx',
    literal: '#fbfaf7',
    contains: '#fbfaf7',
    reason: 'self-contained iframe preview cannot depend on parent CSS vars',
  },
  {
    path: 'app/shop/manage/settings/SupportWidgetSection.tsx',
    literal: '#26231f',
    contains: '#26231f',
    reason: 'self-contained iframe preview cannot depend on parent CSS vars',
  },
  {
    path: 'app/shop/manage/settings/SupportWidgetSection.tsx',
    literal: '#eeece8',
    contains: '#eeece8',
    reason: 'self-contained iframe preview cannot depend on parent CSS vars',
  },
  {
    path: 'app/shop/manage/settings/SupportWidgetSection.tsx',
    literal: '#dedbd4',
    contains: '#dedbd4',
    reason: 'self-contained iframe preview cannot depend on parent CSS vars',
  },
  {
    path: 'app/shop/manage/settings/SupportWidgetSection.tsx',
    literal: '#f0efeb',
    contains: '#f0efeb',
    reason: 'self-contained iframe preview cannot depend on parent CSS vars',
  },
  {
    path: 'app/shop/manage/settings/ShopSettings.tsx',
    literal: '#1d6f42',
    contains: "t.accent_color ?? '#1d6f42'",
    reason: 'native color input state needs a concrete hex value',
  },
  {
    path: 'app/shop/manage/settings/page.tsx',
    literal: '#1d6f42',
    contains: "themeSettings.accent_color !== '#1d6f42'",
    reason: 'setup-completion check compares saved data against the core accent default',
  },
]

async function collectSourceFiles(dir: string): Promise<string[]> {
  const absoluteDir = path.join(repoRoot, dir)
  const entries = await readdir(absoluteDir, { withFileTypes: true })
  const files = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) return collectSourceFiles(entryPath)
    if (!sourceExtensions.has(path.extname(entry.name))) return []
    return [entryPath]
  }))

  return files.flat()
}

function isExcluded(filePath: string) {
  return excludedFiles.has(filePath) || excludedPrefixes.some((prefix) => filePath.startsWith(prefix))
}

function lineForOffset(content: string, offset: number) {
  const lineStart = content.lastIndexOf('\n', offset - 1) + 1
  const lineEnd = content.indexOf('\n', offset)
  return content.slice(lineStart, lineEnd === -1 ? content.length : lineEnd)
}

function isAllowedLiteral(filePath: string, literal: string, line: string) {
  return allowedLiteralRules.some((rule) =>
    rule.path === filePath &&
    rule.literal.toLowerCase() === literal.toLowerCase() &&
    line.includes(rule.contains)
  )
}

test.describe('design-token foundation', () => {
  test('customer-facing source does not use arbitrary hex utility classes', async () => {
    const files = (await Promise.all(['app', 'lib'].map(collectSourceFiles)))
      .flat()
      .filter((filePath) => !isExcluded(filePath))

    const offenders: string[] = []
    for (const filePath of files) {
      const content = await readFile(path.join(repoRoot, filePath), 'utf8')
      for (const match of content.matchAll(arbitraryHexClassPattern)) {
        offenders.push(`${filePath}: ${match[0]}`)
      }
    }

    expect(offenders).toEqual([])
  })

  test('Sprint 2 tokenized surfaces keep raw hex behind the allowlist', async () => {
    const offenders: string[] = []

    for (const filePath of tokenizedSurfaceFiles) {
      const content = await readFile(path.join(repoRoot, filePath), 'utf8')
      for (const match of content.matchAll(rawHexPattern)) {
        const literal = match[0]
        const line = lineForOffset(content, match.index ?? 0)
        if (!isAllowedLiteral(filePath, literal, line)) {
          offenders.push(`${filePath}: ${literal} in ${line.trim()}`)
        }
      }
    }

    expect(offenders).toEqual([])
  })
})
