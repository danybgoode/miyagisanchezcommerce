#!/usr/bin/env node
/**
 * hyper-performant-website S2 · Story 2.1 — regenerate `app/iconoir-subset.css`
 * from the pinned `iconoir` npm package + this codebase's actual usage.
 *
 * Run: npm run build:iconoir
 *
 * Fails loudly (non-zero exit) if any `iconoir-*` class referenced in source
 * doesn't resolve against the real pinned bundle — that's either a typo'd
 * class (the exact silent-failure class of bug the emoji-to-iconoir-sweep
 * epic's retro flagged as a known, un-built gap: "nothing stops a 12th
 * broken class being introduced") or a genuinely new icon that needs adding
 * to the pinned `iconoir` package first. Either way, a human needs to look —
 * this script won't silently ship a subset with a hole in it.
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildIconoirSubsetCss,
  findIconoirClassUsage,
  formatUsage,
  parseIconoirBundleRules,
} from '../lib/iconoir-subset.ts'

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const BUNDLE_CSS_PATH = path.join(REPO_ROOT, 'node_modules/iconoir/css/iconoir.css')
const OUTPUT_PATH = path.join(REPO_ROOT, 'app/iconoir-subset.css')

async function main() {
  const usage = await findIconoirClassUsage(REPO_ROOT)
  const usedClassNames = usage.map((u) => u.className)

  let bundleCss: string
  try {
    bundleCss = await readFile(BUNDLE_CSS_PATH, 'utf8')
  } catch {
    console.error(
      `Could not read ${BUNDLE_CSS_PATH} — is the pinned "iconoir" devDependency installed? Run npm install.`,
    )
    process.exitCode = 1
    return
  }

  const bundleRules = parseIconoirBundleRules(bundleCss)
  const { css, found, missing } = buildIconoirSubsetCss(usedClassNames, bundleRules)

  if (missing.length > 0) {
    console.error(`\n${missing.length} class(es) used in source do not exist in the pinned iconoir bundle:\n`)
    for (const name of missing) {
      const offense = usage.find((u) => u.className === name)
      console.error(`  - ${offense ? formatUsage(offense) : name}`)
    }
    console.error(
      '\nFix the typo, or confirm the class is genuinely new and bump the pinned "iconoir" version in package.json ' +
      'if it only exists in a newer release. Not writing app/iconoir-subset.css.',
    )
    process.exitCode = 1
    return
  }

  await writeFile(OUTPUT_PATH, css, 'utf8')
  const sizeKb = (Buffer.byteLength(css, 'utf8') / 1024).toFixed(1)
  console.log(`Wrote ${OUTPUT_PATH}: ${found.length} icon classes, ${sizeKb} KiB.`)
}

main()
