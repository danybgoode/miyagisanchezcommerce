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
  return PUBLIC_READ_ISR_ROUTES.flatMap((route) => {
    if (!Object.hasOwn(dynamicRoutes, route)) return [`${route}: absent from dynamicRoutes`]
    const entry = dynamicRoutes[route]
    if (!entry || typeof entry !== 'object') return [`${route}: dynamicRoutes entry is not an object`]
    const findings = []
    if (entry.fallback !== null) findings.push(`${route}: fallback must be null for on-demand ISR`)
    if (entry.dataRoute !== `${route}.rsc`) findings.push(`${route}: dataRoute must be the matching .rsc route`)
    if (typeof entry.routeRegex !== 'string' || entry.routeRegex.length === 0) findings.push(`${route}: routeRegex missing`)
    return findings
  })
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
