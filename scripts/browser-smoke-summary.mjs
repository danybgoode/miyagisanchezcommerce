import fs from 'node:fs'

const reportPath = process.argv[2] ?? 'test-results/browser-smoke-fixture-skips.json'
const summaryPath = process.env.GITHUB_STEP_SUMMARY

if (!fs.existsSync(reportPath)) {
  const message = `## Credentialed browser-smoke fixtures\n\nNo skip report was produced at \`${reportPath}\`. The browser test process may have stopped before Playwright started.\n`
  if (summaryPath) fs.appendFileSync(summaryPath, message)
  console.log(message)
  process.exit(0)
}

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'))
const lines = [
  '## Credentialed browser-smoke fixtures',
  '',
  `- Authed tests skipped: **${report.skippedAuthedTests}** across **${report.skippedAuthedSpecFiles}** spec files.`,
  '- Fixture values are intentionally never printed.',
  '',
]

const missing = Object.entries(report.missingFixtures)
if (missing.length === 0) {
  lines.push('All fixtures required by skipped authed tests were present; inspect the Playwright output for their skip reasons.')
} else {
  lines.push('| Missing fixture | Skipped authed tests |', '| --- | ---: |')
  for (const [fixture, tests] of missing) lines.push(`| \`${fixture}\` | ${tests.length} |`)
}
lines.push('', `Machine-readable report: \`${reportPath}\`.`, '')

const message = lines.join('\n')
if (summaryPath) fs.appendFileSync(summaryPath, message)
console.log(message)
