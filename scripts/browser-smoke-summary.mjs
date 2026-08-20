import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

/**
 * Reports what the credentialed browser-smoke layer actually did.
 *
 * The reason this file grew a pure seam and a third state: for as long as this job
 * has existed, `ci.yml` set `MS_TEST_BROWSER_AUTH: "1"` and mapped
 * `secrets.MS_TEST_CLERK_PUBLISHABLE_KEY` / `MS_TEST_CLERK_SECRET_KEY`, neither of
 * which exists (the repo's are `CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY`). GitHub
 * resolves a missing secret to an empty string, so `authEnabled()` was false on every
 * run, 29 authed tests skipped, and this summary reported that number as though it
 * were the ordinary state of an anonymous job. It was not — credentials had been
 * REQUESTED and had not arrived, which is a wiring fault, and it stayed invisible for
 * months because "off" and "asked for but missing" printed the same sentence.
 *
 * Known-on, known-off, and unavailable are three different facts. Collapsing the
 * third into the second is how a broken pipeline reads as a deliberate choice.
 */

/** Which of the three states the credentialed layer is in, from the env alone. */
export function authCredentialState(env) {
  const requested = env.MS_TEST_BROWSER_AUTH === '1'
  const missing = ['CLERK_PUBLISHABLE_KEY', 'CLERK_SECRET_KEY'].filter((name) => !env[name])
  if (!requested) return { state: 'off', missing: [] }
  if (missing.length > 0) return { state: 'unavailable', missing }
  return { state: 'on', missing: [] }
}

export function buildSummary(report, env) {
  const auth = authCredentialState(env)
  const lines = ['## Credentialed browser-smoke fixtures', '']

  if (auth.state === 'unavailable') {
    // Loud, and named, because the failure mode is a workflow referencing a secret
    // that does not exist — which produces an empty string, never an error.
    lines.push(
      `> [!WARNING]`,
      `> **Authed smokes were REQUESTED but could not run.** \`MS_TEST_BROWSER_AUTH=1\` is set and`,
      `> ${auth.missing.map((n) => `\`${n}\``).join(', ')} ${auth.missing.length === 1 ? 'is' : 'are'} empty,`,
      `> so every authed spec skipped. A workflow that maps a secret name which does not exist gets an`,
      `> empty string, not an error. Check the name against \`gh secret list\`.`,
      '',
    )
  } else if (auth.state === 'off') {
    lines.push('Authed smokes are deliberately off in this job (anonymous layer).', '')
  } else {
    lines.push('Authed smokes were enabled with credentials present.', '')
  }

  lines.push(
    `- Authed tests skipped: **${report.skippedAuthedTests}** across **${report.skippedAuthedSpecFiles}** spec files.`,
    '- Fixture values are intentionally never printed.',
    '',
  )

  const missingFixtures = Object.entries(report.missingFixtures ?? {})
  if (missingFixtures.length === 0) {
    lines.push('All fixtures required by skipped authed tests were present; inspect the Playwright output for their skip reasons.')
  } else {
    lines.push('| Missing fixture | Skipped authed tests |', '| --- | ---: |')
    for (const [fixture, tests] of missingFixtures) lines.push(`| \`${fixture}\` | ${tests.length} |`)
  }
  lines.push('')
  return lines.join('\n')
}

function main() {
  const reportPath = process.argv[2] ?? 'test-results/browser-smoke-fixture-skips.json'
  const summaryPath = process.env.GITHUB_STEP_SUMMARY

  const message = fs.existsSync(reportPath)
    ? `${buildSummary(JSON.parse(fs.readFileSync(reportPath, 'utf8')), process.env)}\nMachine-readable report: \`${reportPath}\`.\n`
    : `## Credentialed browser-smoke fixtures\n\nNo skip report was produced at \`${reportPath}\`. The browser test process may have stopped before Playwright started.\n`

  if (summaryPath) fs.appendFileSync(summaryPath, message)
  console.log(message)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
