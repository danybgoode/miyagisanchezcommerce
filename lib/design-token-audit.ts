import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

export type SourceFile = {
  filePath: string
  content: string
}

export type RawColorOffense = {
  filePath: string
  lineNumber: number
  literal: string
  line: string
}

export type AllowedLiteralRule = {
  path: string
  literal: string
  contains: string
  reason: string
}

export type ContrastPair = {
  name: string
  foregroundToken: string
  backgroundToken: string
  minimumRatio: number
  textSize: 'body' | 'large'
  rationale?: string
}

export type ContrastResult = ContrastPair & {
  foreground: string
  background: string
  ratio: number
  passes: boolean
}

const sourceExtensions = new Set(['.css', '.js', '.jsx', '.ts', '.tsx'])
const arbitraryHexClassPattern = /(?:bg|text|border|from|to|via|fill|stroke|ring|outline|decoration)-\[#[0-9a-fA-F]{3,8}\]/g
const rawHexPattern = /#[0-9a-fA-F]{3,8}\b/g

export const guardExcludedPrefixes = [
  'app/admin/',
  'app/api/',
  'app/style-sandbox/',
]

export const guardExcludedFiles = new Set([
  'app/apple-icon.tsx',
  'app/components/PrintAdBlock.tsx',
  'app/components/PrintAdPreview.tsx',
  'app/globals.css',
  'app/icon.svg',
  'app/layout.tsx',
  'app/opengraph-image.tsx',
  'app/shop/manage/PrintAdBlock.tsx',
  'app/shop/manage/PrintAdPreview.tsx',
  'lib/email.ts',
  'lib/design-token-audit.ts',
  'lib/platform-theme.ts',
  'lib/print-export.ts',
  'lib/print-layout.ts',
  'lib/print-qr.ts',
])

export const allowedLiteralRules: AllowedLiteralRule[] = [
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
    path: 'app/shop/manage/settings/_sections/Diseno.tsx',
    literal: '#1d6f42',
    contains: "t.accent_color ?? '#1d6f42'",
    reason: 'native color input state needs a concrete hex value (extracted from ShopSettings monolith)',
  },
  {
    path: 'app/shop/manage/settings/page.tsx',
    literal: '#1d6f42',
    contains: "themeSettings.accent_color !== '#1d6f42'",
    reason: 'setup-completion check compares saved data against the core accent default',
  },
  {
    path: 'lib/settings-import.ts',
    literal: '#1d6f42',
    contains: "accent_color: '#1d6f42'",
    reason: 'Storefront-as-Code example manifest needs a concrete persisted accent default',
  },
]

export const documentedContrastPairs: ContrastPair[] = [
  { name: 'Primary text on page canvas', foregroundToken: '--fg', backgroundToken: '--bg', minimumRatio: 4.5, textSize: 'body' },
  { name: 'Muted text on page canvas', foregroundToken: '--fg-muted', backgroundToken: '--bg', minimumRatio: 4.5, textSize: 'body' },
  { name: 'Primary text on raised surface', foregroundToken: '--fg', backgroundToken: '--bg-elevated', minimumRatio: 4.5, textSize: 'body' },
  { name: 'Muted text on raised surface', foregroundToken: '--fg-muted', backgroundToken: '--bg-elevated', minimumRatio: 4.5, textSize: 'body' },
  { name: 'Primary text on recessed surface', foregroundToken: '--fg', backgroundToken: '--bg-sunk', minimumRatio: 4.5, textSize: 'body' },
  { name: 'Inverse text on accent', foregroundToken: '--fg-inverse', backgroundToken: '--accent', minimumRatio: 4.5, textSize: 'body' },
  { name: 'Accent ink on accent soft', foregroundToken: '--accent-ink', backgroundToken: '--accent-soft', minimumRatio: 4.5, textSize: 'body' },
  { name: 'Success text on success soft', foregroundToken: '--success', backgroundToken: '--success-soft', minimumRatio: 4.5, textSize: 'body' },
  { name: 'Warning text on warning soft', foregroundToken: '--warning', backgroundToken: '--warning-soft', minimumRatio: 4.5, textSize: 'body' },
  { name: 'Danger text on danger soft', foregroundToken: '--danger', backgroundToken: '--danger-soft', minimumRatio: 4.5, textSize: 'body' },
  { name: 'Info text on info soft', foregroundToken: '--info', backgroundToken: '--info-soft', minimumRatio: 4.5, textSize: 'body' },
  { name: 'Energy text on energy soft', foregroundToken: '--energy', backgroundToken: '--energy-soft', minimumRatio: 4.5, textSize: 'body' },
  { name: 'Promo text on promo soft', foregroundToken: '--promo', backgroundToken: '--promo-soft', minimumRatio: 4.5, textSize: 'body' },
  { name: 'Agent text on agent soft', foregroundToken: '--agent', backgroundToken: '--agent-soft', minimumRatio: 4.5, textSize: 'body' },
  {
    name: 'Subtle text on page canvas',
    foregroundToken: '--fg-subtle',
    backgroundToken: '--bg',
    minimumRatio: 3,
    textSize: 'large',
    rationale: '--fg-subtle is reserved for placeholder/metadata affordances; body copy must use --fg-muted or stronger.',
  },
]

export async function collectSourceFiles(repoRoot: string, dir: string): Promise<string[]> {
  const absoluteDir = path.join(repoRoot, dir)
  const entries = await readdir(absoluteDir, { withFileTypes: true })
  const files = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) return collectSourceFiles(repoRoot, entryPath)
    if (!sourceExtensions.has(path.extname(entry.name))) return []
    return [entryPath]
  }))

  return files.flat()
}

export function isGuardExcluded(filePath: string) {
  return guardExcludedFiles.has(filePath) || guardExcludedPrefixes.some((prefix) => filePath.startsWith(prefix))
}

export async function readSourceFiles(repoRoot: string, dirs = ['app', 'lib']): Promise<SourceFile[]> {
  const files = (await Promise.all(dirs.map((dir) => collectSourceFiles(repoRoot, dir))))
    .flat()
    .filter((filePath) => !isGuardExcluded(filePath))

  return Promise.all(files.map(async (filePath) => ({
    filePath,
    content: await readFile(path.join(repoRoot, filePath), 'utf8'),
  })))
}

export async function findArbitraryHexClassOffenders(repoRoot: string) {
  return findArbitraryHexClassOffendersInSourceFiles(await readSourceFiles(repoRoot))
}

export async function findRawHexLiteralOffenders(repoRoot: string) {
  return findRawHexLiteralOffendersInSourceFiles(await readSourceFiles(repoRoot))
}

export function findArbitraryHexClassOffendersInSourceFiles(files: SourceFile[]) {
  const offenders: RawColorOffense[] = []

  for (const file of files) {
    if (isGuardExcluded(file.filePath)) continue
    for (const match of file.content.matchAll(arbitraryHexClassPattern)) {
      offenders.push(buildOffense(file, match))
    }
  }

  return offenders
}

export function findRawHexLiteralOffendersInSourceFiles(files: SourceFile[]) {
  const offenders: RawColorOffense[] = []

  for (const file of files) {
    if (isGuardExcluded(file.filePath)) continue
    for (const match of file.content.matchAll(rawHexPattern)) {
      const offense = buildOffense(file, match)
      if (!isAllowedLiteral(offense)) offenders.push(offense)
    }
  }

  return offenders
}

export function formatOffense(offense: RawColorOffense) {
  return `${offense.filePath}:${offense.lineNumber}: ${offense.literal} in ${offense.line.trim()}`
}

function buildOffense(file: SourceFile, match: RegExpMatchArray): RawColorOffense {
  const offset = match.index ?? 0
  return {
    filePath: file.filePath,
    lineNumber: lineNumberForOffset(file.content, offset),
    literal: match[0],
    line: lineForOffset(file.content, offset),
  }
}

function isAllowedLiteral(offense: RawColorOffense) {
  return allowedLiteralRules.some((rule) =>
    rule.path === offense.filePath &&
    rule.literal.toLowerCase() === offense.literal.toLowerCase() &&
    offense.line.includes(rule.contains)
  )
}

function lineNumberForOffset(content: string, offset: number) {
  return content.slice(0, offset).split('\n').length
}

function lineForOffset(content: string, offset: number) {
  const lineStart = content.lastIndexOf('\n', offset - 1) + 1
  const lineEnd = content.indexOf('\n', offset)
  return content.slice(lineStart, lineEnd === -1 ? content.length : lineEnd)
}

export function parseBaseCssTokens(css: string) {
  const tokens = new Map<string, string>()
  for (const block of [extractBlock(css, '@theme inline'), extractBlock(css, ':root')]) {
    for (const match of block.matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g)) {
      tokens.set(match[1], match[2].trim())
    }
  }
  return tokens
}

export function auditDocumentedContrastPairs(css: string, pairs = documentedContrastPairs): ContrastResult[] {
  const tokens = parseBaseCssTokens(css)
  return pairs.map((pair) => {
    const foreground = resolveTokenToHex(tokens, pair.foregroundToken)
    const background = resolveTokenToHex(tokens, pair.backgroundToken)
    const ratio = contrastRatio(foreground, background)
    return {
      ...pair,
      foreground,
      background,
      ratio,
      passes: ratio >= pair.minimumRatio,
    }
  })
}

export function formatContrastResult(result: ContrastResult) {
  const status = result.passes ? 'PASS' : result.rationale ? 'FLAGGED' : 'FAIL'
  return `${status} ${result.name}: ${result.foregroundToken} ${result.foreground} on ${result.backgroundToken} ${result.background} = ${result.ratio.toFixed(2)} (min ${result.minimumRatio})`
}

function extractBlock(css: string, marker: string) {
  const blockPattern = marker === ':root'
    ? /^\s*:root\s*\{/m
    : /^\s*@theme\s+inline\s*\{/m
  const match = blockPattern.exec(css)
  if (!match) throw new Error(`Missing CSS block marker: ${marker}`)
  const openIndex = match.index + match[0].lastIndexOf('{')

  let depth = 0
  for (let index = openIndex; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1
    if (css[index] === '}') {
      depth -= 1
      if (depth === 0) return css.slice(openIndex + 1, index)
    }
  }

  throw new Error(`Missing closing brace for CSS block: ${marker}`)
}

function resolveTokenToHex(tokens: Map<string, string>, tokenName: string, seen = new Set<string>()): string {
  const value = tokens.get(tokenName)
  if (!value) throw new Error(`Missing CSS token: ${tokenName}`)
  if (seen.has(tokenName)) throw new Error(`Circular CSS token reference: ${Array.from(seen).join(' -> ')} -> ${tokenName}`)

  const direct = parseHexColor(value)
  if (direct) return direct

  const varMatch = value.match(/^var\((--[a-zA-Z0-9-]+)(?:,\s*([^)]+))?\)$/)
  if (varMatch) {
    seen.add(tokenName)
    const referenced = tokens.has(varMatch[1]) ? varMatch[1] : null
    if (referenced) return resolveTokenToHex(tokens, referenced, seen)
    if (varMatch[2]) {
      const fallback = parseHexColor(varMatch[2])
      if (fallback) return fallback
    }
  }

  throw new Error(`Token ${tokenName} does not resolve to a supported hex color: ${value}`)
}

function parseHexColor(value: string) {
  const match = value.trim().match(/^(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6})$/)
  if (!match) return null
  const hex = match[1].toLowerCase()
  if (hex.length === 4) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
  }
  return hex
}

function contrastRatio(foreground: string, background: string) {
  const foregroundLuminance = relativeLuminance(foreground)
  const backgroundLuminance = relativeLuminance(background)
  const lighter = Math.max(foregroundLuminance, backgroundLuminance)
  const darker = Math.min(foregroundLuminance, backgroundLuminance)
  return (lighter + 0.05) / (darker + 0.05)
}

function relativeLuminance(hex: string) {
  const [red, green, blue] = [0, 2, 4]
    .map((offset) => parseInt(hex.slice(1 + offset, 3 + offset), 16) / 255)
    .map((channel) => channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4)

  return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue)
}
