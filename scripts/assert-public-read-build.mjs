#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const PUBLIC_READ_ISR_ROUTES = Object.freeze([
  '/internal-public-read/[channel]/[identity]/[slug]/listing/[id]',
  '/internal-public-read/[channel]/[identity]/[slug]/shop/[[...rest]]',
])

export function publicReadBuildFindings(manifest) {
  const dynamicRoutes = manifest?.dynamicRoutes
  if (!dynamicRoutes || typeof dynamicRoutes !== 'object') {
    return ['prerender manifest has no dynamicRoutes object']
  }
  return PUBLIC_READ_ISR_ROUTES.flatMap((route) => (
    Object.hasOwn(dynamicRoutes, route) ? [] : [`${route}: absent from dynamicRoutes`]
  ))
}

export function assertPublicReadBuild(root = process.cwd()) {
  const manifestPath = path.join(root, '.next', 'prerender-manifest.json')
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`UNAVAILABLE — build manifest missing: ${manifestPath}`)
  }
  let manifest
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    throw new Error(`UNAVAILABLE — build manifest unreadable: ${error instanceof Error ? error.message : String(error)}`)
  }
  const findings = publicReadBuildFindings(manifest)
  if (findings.length) throw new Error(`public-read build is not ISR:\n${findings.join('\n')}`)
  return `public-read-build: EXACT — ${PUBLIC_READ_ISR_ROUTES.length} runtime ISR route templates`
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  try {
    console.log(assertPublicReadBuild())
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
