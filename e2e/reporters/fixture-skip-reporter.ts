import fs from 'node:fs'
import path from 'node:path'
import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter'

type SkippedTest = {
  file: string
  title: string
  missingFixtures: string[]
}

const AUTH_PREREQUISITES = [
  'MS_TEST_BROWSER_AUTH',
  'CLERK_PUBLISHABLE_KEY',
  'CLERK_SECRET_KEY',
]

function sourceFor(file: string): string {
  return fs.readFileSync(file, 'utf8')
}

/**
 * Derive the fixtures from the test source, rather than maintaining a second
 * hand-written workflow list. Optional strictness toggles are deliberately not
 * fixtures: their absence changes assertion strength, not whether a test runs.
 */
function requiredFixtures(source: string): string[] {
  const fixtures = new Set<string>()
  const isAuthed = source.includes('authEnabled(')

  if (isAuthed) {
    for (const name of AUTH_PREREQUISITES) fixtures.add(name)
  }

  for (const match of source.matchAll(/MS_TEST_[A-Z0-9_]+/g)) {
    const name = match[0]
    if (name !== 'MS_TEST_BROWSER_AUTH' && name !== 'MS_TEST_PERSONALIZATION_STRICT') {
      fixtures.add(name)
    }
  }

  return [...fixtures]
}

/** Writes the real Playwright skip result without ever serialising environment values. */
export default class FixtureSkipReporter implements Reporter {
  private readonly skippedAuthed: SkippedTest[] = []

  onTestEnd(test: TestCase, result: TestResult): void {
    if (result.status !== 'skipped') return

    // Runtime `test.skip()` records its reason as an annotation. Checking that
    // reason, rather than classifying every skipped test in a file that happens
    // to contain an authed test, excludes adjacent anonymous fixture skips.
    const skipReason = [
      ...test.annotations.map((annotation) => annotation.description ?? ''),
      ...result.errors.map((error) => error.message ?? ''),
    ].join('\n')
    if (!skipReason.includes('MS_TEST_BROWSER_AUTH')) return

    const source = sourceFor(test.location.file)

    const missingFixtures = requiredFixtures(source).filter((name) => {
      if (name === 'MS_TEST_BROWSER_AUTH') return process.env[name] !== '1'
      return !process.env[name]
    })

    this.skippedAuthed.push({
      file: path.relative(process.cwd(), test.location.file),
      title: test.titlePath().join(' › '),
      missingFixtures,
    })
  }

  onEnd(): void {
    const fixtures = new Map<string, string[]>()
    for (const skipped of this.skippedAuthed) {
      for (const fixture of skipped.missingFixtures) {
        fixtures.set(fixture, [...(fixtures.get(fixture) ?? []), skipped.title])
      }
    }

    const report = {
      skippedAuthedTests: this.skippedAuthed.length,
      skippedAuthedSpecFiles: new Set(this.skippedAuthed.map(({ file }) => file)).size,
      missingFixtures: Object.fromEntries(fixtures),
      skippedTests: this.skippedAuthed,
    }
    const output = process.env.MS_TEST_SKIP_REPORT_PATH ?? 'test-results/browser-smoke-fixture-skips.json'
    fs.mkdirSync(path.dirname(output), { recursive: true })
    fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`)
  }
}
