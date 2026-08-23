import { expect, test } from '@playwright/test'
import { existsSync } from 'node:fs'
import { findForbiddenBuyerVendors, readBuyerRouteReports, reportRouteManifest } from '../scripts/route-client-budget.mjs'

test('S3.2 · D14 — buyer route manifests exclude vendors that already belong elsewhere', () => {
  const manifestsDir = '.next/server/app'
  test.skip(
    process.env.REMOTE_PREVIEW_ONLY === 'true' && !existsSync(manifestsDir),
    'built-artifact guard runs in the typecheck-build job; this job verifies the remote preview',
  )
  const reports = readBuyerRouteReports()
  for (const [route, report] of Object.entries(reports)) {
    expect(findForbiddenBuyerVendors(report), `${route} resolved chunk graph contains a forbidden vendor`).toEqual([])
  }
})

test('S3.2 mechanism — a transitive dnd-kit chunk is caught even when the manifest never names the package', () => {
  const report = reportRouteManifest({
    manifestSource: 'globalThis.__fixture={"clientModules":{"app.tsx":{"chunks":["static/chunks/vendor.js"]}}};',
    readChunk: () => 'function DndContext(){ return "dragging" }',
  })
  expect(report.manifestSource).not.toContain('@dnd-kit')
  expect(findForbiddenBuyerVendors(report)).toEqual(['@dnd-kit'])
})
