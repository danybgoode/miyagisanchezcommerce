import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { literalUiCandidates } from './derive-buyer-locale-population'

const SELLER_PORTAL_DIRS = [
  'app/(shell)/shop/manage',
  'app/(shell)/sell',
] as const

export interface SellerLocalePopulation {
  readonly generatedBy: 'scripts/derive-seller-locale-population.ts'
  readonly direct: string[]
  readonly files: Array<{ file: string; keys: string[] }>
  readonly entries: Array<{ key: string; source: string }>
}

function filesBelow(root: string): string[] {
  if (!existsSync(root)) return []
  return readdirSync(root).flatMap((name) => {
    const absolute = path.join(root, name)
    return statSync(absolute).isDirectory() ? filesBelow(absolute) : [absolute]
  })
}

function relative(root: string, absolute: string): string {
  return path.relative(root, absolute).split(path.sep).join('/')
}

/** Stable, path-safe key for one original string. The source stays the SSOT. */
export function sellerCopyKey(source: string): string {
  return `s_${createHash('sha256').update(source).digest('hex').slice(0, 16)}`
}

const COPY_PROPERTY_NAMES = new Set([
  'action', 'body', 'bullets', 'caption', 'cta', 'description', 'desc', 'eyebrow',
  'empty', 'error', 'features', 'helper', 'hint', 'items', 'label', 'lead',
  'errorMsg', 'message', 'name', 'note', 'placeholder', 'steps', 'sub', 'subtitle', 'success',
  'text', 'title', 'warning',
])

const COPY_SETTERS = /^(?:alert|confirm|set(?:Error|Message|Toast|Notice|Feedback|[A-Z].*(?:Error|Message|Toast|Notice|Feedback)))$/

function normalizedTemplate(expression: ts.Expression): string | null {
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return expression.text
  if (!ts.isTemplateExpression(expression)) return null
  return expression.templateSpans.reduce(
    (value, span, index) => `${value}{${index}}${span.literal.text}`,
    expression.head.text,
  )
}

function addExpressionStrings(expression: ts.Expression, add: (value: string) => void): void {
  if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) ||
      ts.isTypeAssertionExpression(expression) || ts.isNonNullExpression(expression)) {
    addExpressionStrings(expression.expression, add)
    return
  }
  const value = normalizedTemplate(expression)
  if (value !== null) {
    add(value)
    return
  }
  if (ts.isConditionalExpression(expression)) {
    addExpressionStrings(expression.whenTrue, add)
    addExpressionStrings(expression.whenFalse, add)
    return
  }
  if (
    ts.isBinaryExpression(expression) &&
    [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken]
      .includes(expression.operatorToken.kind)
  ) {
    addExpressionStrings(expression.left, add)
    addExpressionStrings(expression.right, add)
    return
  }
  if (ts.isArrayLiteralExpression(expression)) {
    for (const element of expression.elements) {
      if (ts.isExpression(element)) addExpressionStrings(element, add)
    }
  }
}

/**
 * Copy that reaches JSX indirectly through status/config tables or client state.
 * A JSX-only walk misses these even though the browser eventually renders them.
 */
export function indirectSellerUiCandidates(source: string, file = 'fixture.tsx'): string[] {
  const found = new Set<string>()
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const add = (raw: string) => {
    const value = raw.replace(/&apos;/g, "'").replace(/\s+/g, ' ').trim()
    if (/[\p{L}]/u.test(value)) found.add(value)
  }

  function visit(node: ts.Node) {
    if (ts.isPropertyAssignment(node)) {
      const name = node.name.getText(parsed).replace(/["']/g, '')
      if (COPY_PROPERTY_NAMES.has(name)) addExpressionStrings(node.initializer, add)
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(parsed).split('.').at(-1) ?? ''
      if (COPY_SETTERS.test(callee)) {
        for (const argument of node.arguments) addExpressionStrings(argument, add)
      }
    }
    if (
      ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) &&
      /(?:labels|options|steps|statuses|types)$/i.test(node.name.text) && node.initializer
    ) {
      addExpressionStrings(node.initializer, add)
    }
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  return [...found].sort()
}

export function deriveSellerLocalePopulation(root: string): SellerLocalePopulation {
  const direct = SELLER_PORTAL_DIRS
    .flatMap((dir) => filesBelow(path.join(root, dir)))
    .filter((file) => file.endsWith('.tsx'))
    .map((file) => relative(root, file))
    .sort()

  const sourceByKey = new Map<string, string>()
  const files = direct.flatMap((file) => {
    const source = readFileSync(path.join(root, file), 'utf8')
    const candidates = [...new Set([
      ...literalUiCandidates(source, file),
      ...indirectSellerUiCandidates(source, file),
    ])].sort()
    if (candidates.length === 0) return []
    const keys = candidates.map((source) => {
      const key = sellerCopyKey(source)
      const previous = sourceByKey.get(key)
      if (previous && previous !== source) {
        throw new Error(`Seller-copy key collision for ${key}: ${JSON.stringify(previous)} / ${JSON.stringify(source)}`)
      }
      sourceByKey.set(key, source)
      return key
    })
    return [{ file, keys }]
  })

  const entries = [...sourceByKey]
    .map(([key, source]) => ({ key, source }))
    .sort((a, b) => a.key.localeCompare(b.key))

  return {
    generatedBy: 'scripts/derive-seller-locale-population.ts',
    direct,
    files,
    entries,
  }
}

export function serializeSellerLocalePopulation(population: SellerLocalePopulation): string {
  return `${JSON.stringify(population, null, 2)}\n`
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  const root = process.cwd()
  const output = path.join(root, 'locales/seller-population.json')
  writeFileSync(output, serializeSellerLocalePopulation(deriveSellerLocalePopulation(root)))
  process.stdout.write(`Wrote ${relative(root, output)}\n`)
}
