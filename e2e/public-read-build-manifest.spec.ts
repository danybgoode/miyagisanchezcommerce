import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PUBLIC_READ_ISR_ROUTES,
  publicReadBuildFindings,
} from '../scripts/assert-public-read-build.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test.describe('public-read build manifest · D7/D19/D21', () => {
  test('both internal templates are runtime ISR routes, not dynamic server routes', () => {
    const manifest = {
      dynamicRoutes: Object.fromEntries(PUBLIC_READ_ISR_ROUTES.map((route) => [route, {
        fallback: null,
        dataRoute: `${route}.rsc`,
        routeRegex: '^example$',
      }])),
    }
    expect(publicReadBuildFindings(manifest)).toEqual([])
  })

  test('a route absent from the prerender manifest fails explicitly', () => {
    expect(publicReadBuildFindings({ dynamicRoutes: {} })).toEqual(
      PUBLIC_READ_ISR_ROUTES.map((route) => `${route}: absent from dynamicRoutes`),
    )
  })

  test('a present key without runtime fallback and data-route semantics still fails', () => {
    const dynamicRoutes = Object.fromEntries(PUBLIC_READ_ISR_ROUTES.map((route) => [route, {}]))
    expect(publicReadBuildFindings({ dynamicRoutes })).toEqual(PUBLIC_READ_ISR_ROUTES.flatMap((route) => [
      `${route}: fallback must be null for on-demand ISR`,
      `${route}: dataRoute must be the matching .rsc route`,
      `${route}: routeRegex missing`,
    ]))
  })

  test('npm build runs the manifest assertion after Next has finalized output', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>
    }
    expect(packageJson.scripts?.postbuild).toBe('node scripts/assert-public-read-build.mjs')
  })
})
