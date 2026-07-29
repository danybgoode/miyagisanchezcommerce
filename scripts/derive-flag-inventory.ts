import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import ts from 'typescript'
import { FLAG_CATALOG, FLAG_KEYS, type FlagKey } from '../lib/flag-catalog'

export const FLAG_INVENTORY_REPORT_PATH = 'artifacts/flag-inventory.frontend.json'

export type FrontendFlagInventoryReport = {
  schemaVersion: 1
  source: 'typescript-callsite-derivation'
  flags: Array<{
    key: FlagKey
    compileDefault: boolean
    polarity: 'killswitch' | 'enablement'
    criticality: 'low' | 'medium' | 'high'
    enforcement: 'frontend' | 'backend' | 'both'
    callsites: string[]
  }>
  typedDynamicCallsites: string[]
}

function sourceFiles(program: ts.Program, root: string): ts.SourceFile[] {
  const roots = ['app', 'components', 'lib']
    .map((directory) => path.join(root, directory))
    .filter((directory) => fs.existsSync(directory))
  return program.getSourceFiles().filter((source) => {
    const absolute = path.resolve(source.fileName)
    if (
      !roots.some((directory) => absolute.startsWith(`${directory}${path.sep}`)) &&
      absolute !== path.join(root, 'middleware.ts')
    )
      return false
    const relative = path.relative(root, absolute)
    return (
      !relative.includes(`${path.sep}node_modules${path.sep}`) &&
      !/\.(?:spec|test)\.[cm]?[jt]sx?$/.test(relative) &&
      !relative.endsWith('.d.ts')
    )
  })
}

function lineRef(root: string, source: ts.SourceFile, node: ts.Node): string {
  const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
  return `${path.relative(root, source.fileName).split(path.sep).join('/')}:${line}`
}

function calledIsEnabled(
  expression: ts.LeftHandSideExpression,
  checker: ts.TypeChecker,
  root: string,
): boolean {
  if (ts.isPropertyAccessExpression(expression) && expression.name.text === 'isEnabled') return true
  if (!ts.isIdentifier(expression)) return false
  let symbol = checker.getSymbolAtLocation(expression)
  if (!symbol) return expression.text === 'isEnabled'
  if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)
  return (
    symbol.getName() === 'isEnabled' &&
    (symbol.declarations ?? []).some(
      (declaration) =>
        path.resolve(declaration.getSourceFile().fileName) === path.join(root, 'lib', 'flags.ts'),
    )
  )
}

function literalKeys(type: ts.Type): string[] | undefined {
  if (type.isStringLiteral()) return [type.value]
  if (!type.isUnion()) return undefined
  const values: string[] = []
  for (const member of type.types) {
    if (!member.isStringLiteral()) return undefined
    values.push(member.value)
  }
  return values
}

export function deriveFlagInventory(root = process.cwd()): FrontendFlagInventoryReport {
  const configPath = ts.findConfigFile(root, ts.sys.fileExists, 'tsconfig.json')
  if (!configPath) throw new Error(`tsconfig.json not found below ${root}`)
  const config = ts.readConfigFile(configPath, ts.sys.readFile)
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'))
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root)
  const program = ts.createProgram(parsed.fileNames, parsed.options)
  const checker = program.getTypeChecker()
  const known = new Set<string>(FLAG_KEYS)
  const callsites = new Map<FlagKey, Set<string>>(
    FLAG_KEYS.map((key) => [key, new Set<string>()]),
  )
  const typedDynamicCallsites = new Set<string>()
  const errors: string[] = []

  for (const source of sourceFiles(program, root)) {
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        calledIsEnabled(node.expression, checker, root) &&
        node.arguments.length > 0
      ) {
        const argument = node.arguments[0]
        const ref = lineRef(root, source, node)
        const keys =
          ts.isStringLiteralLike(argument)
            ? [argument.text]
            : literalKeys(checker.getTypeAtLocation(argument))
        if (!keys) {
          errors.push(`unresolved isEnabled argument at ${ref}`)
        } else if (keys.length === FLAG_KEYS.length && keys.every((key) => known.has(key))) {
          // A typed `FlagKey` loop (for example seller navigation) is safe but
          // cannot prove which concrete catalog entries reach it at runtime.
          typedDynamicCallsites.add(ref)
        } else {
          for (const key of keys) {
            if (!known.has(key)) errors.push(`unknown flag ${JSON.stringify(key)} at ${ref}`)
            else callsites.get(key as FlagKey)!.add(ref)
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }

  if (errors.length > 0) throw new Error(errors.sort().join('\n'))

  return {
    schemaVersion: 1,
    source: 'typescript-callsite-derivation',
    flags: FLAG_KEYS.map((key) => ({
      key,
      compileDefault: FLAG_CATALOG[key].default,
      polarity: FLAG_CATALOG[key].polarity,
      criticality: FLAG_CATALOG[key].criticality,
      enforcement: FLAG_CATALOG[key].enforcement,
      callsites: [...callsites.get(key)!].sort(),
    })).sort((left, right) => left.key.localeCompare(right.key)),
    typedDynamicCallsites: [...typedDynamicCallsites].sort(),
  }
}

export function renderFlagInventory(report: FrontendFlagInventoryReport): string {
  return `${JSON.stringify(report, null, 2)}\n`
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined
if (invokedPath === path.resolve(new URL(import.meta.url).pathname)) {
  const root = process.cwd()
  const destination = path.join(root, FLAG_INVENTORY_REPORT_PATH)
  const rendered = renderFlagInventory(deriveFlagInventory(root))
  if (process.argv.includes('--write')) {
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.writeFileSync(destination, rendered)
  } else if (!fs.existsSync(destination) || fs.readFileSync(destination, 'utf8') !== rendered) {
    console.error(
      `Flag inventory drifted. Run: npx tsx scripts/derive-flag-inventory.ts --write`,
    )
    process.exitCode = 1
  }
}
