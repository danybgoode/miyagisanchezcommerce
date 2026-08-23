import { expect, test } from '@playwright/test'
import { FORBIDDEN_BUYER_VENDORS, readBuyerRouteReports } from '../scripts/route-client-budget.mjs'

test('S3.2 · D14 — buyer route manifests exclude vendors that already belong elsewhere', () => {
  const reports = readBuyerRouteReports()
  for (const [route, report] of Object.entries(reports)) {
    const joined = report.manifestSource.toLowerCase()
    for (const vendor of FORBIDDEN_BUYER_VENDORS) {
      expect(joined, `${route} manifest unexpectedly includes ${vendor}`).not.toContain(vendor)
    }
  }
})
