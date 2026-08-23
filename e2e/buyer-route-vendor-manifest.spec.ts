import { expect, test } from '@playwright/test'
import { existsSync } from 'node:fs'
import { FORBIDDEN_BUYER_VENDORS, readBuyerRouteReports } from '../scripts/route-client-budget.mjs'

test('S3.2 · D14 — buyer route manifests exclude vendors that already belong elsewhere', () => {
  const manifestsDir = '.next/server/app'
  test.skip(
    process.env.REMOTE_PREVIEW_ONLY === 'true' && !existsSync(manifestsDir),
    'built-artifact guard runs in the typecheck-build job; this job verifies the remote preview',
  )
  const reports = readBuyerRouteReports()
  for (const [route, report] of Object.entries(reports)) {
    const joined = report.manifestSource.toLowerCase()
    for (const vendor of FORBIDDEN_BUYER_VENDORS) {
      expect(joined, `${route} manifest unexpectedly includes ${vendor}`).not.toContain(vendor)
    }
  }
})
