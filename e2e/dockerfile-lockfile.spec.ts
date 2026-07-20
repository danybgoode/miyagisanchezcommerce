import { test, expect } from '@playwright/test'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

/**
 * Deploy-pipeline-tuning · Sprint 1 — locks in the lockfile + `npm ci` switch.
 *
 * Before this: no committed `package-lock.json`, the Dockerfile's `deps`
 * stage ran `npm install` against caret-pinned deps — a rebuild of the
 * identical commit could resolve a different transitive dependency tree,
 * and no Docker layer cache (Sprint 2) could have a stable key. Pure
 * fs-read/regex checks, no browser/request fixture — runs in the `api`
 * project (the CI gate) alongside the other pure-logic specs.
 *
 * See Roadmap/09-platform-infra/deploy-pipeline-tuning/sprint-1.md.
 */

const ROOT = process.cwd()
const dockerfile = readFileSync(join(ROOT, 'Dockerfile'), 'utf8')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

test.describe('frontend Dockerfile + lockfile — deploy-pipeline-tuning S1 self-check', () => {
  test('all image stages use the supported Node.js 22 runtime required by Supabase', () => {
    expect(dockerfile.match(/^FROM node:22-slim AS (deps|builder|runner)$/gm)).toHaveLength(3)
    expect(dockerfile).not.toContain('node:20')
  })

  test('package-lock.json is committed', () => {
    expect(existsSync(join(ROOT, 'package-lock.json'))).toBe(true)
  })

  test('package-lock.json name matches package.json name', () => {
    const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'))
    expect(lock.name).toBe(pkg.name)
  })

  test('deps stage copies the lockfile before install and uses npm ci', () => {
    expect(dockerfile).toMatch(/COPY package\.json package-lock\.json .*\n\s*RUN npm ci\b/)
  })

  test('the deps-stage install does not regress to a bare npm install', () => {
    // Scoped to the `deps` stage only — the runner stage's `RUN npm install sharp`
    // is a deliberate, unrelated standalone-tracing workaround (see the Dockerfile's
    // own header comment) and must stay untouched by this guard.
    const depsStage = dockerfile.slice(dockerfile.indexOf('AS deps'), dockerfile.indexOf('AS builder'))
    expect(depsStage).not.toMatch(/RUN npm install\b/)
    expect(depsStage).toMatch(/RUN npm ci\b/)
  })

  test('the runner stage keeps its deliberate npm install sharp workaround', () => {
    expect(dockerfile).toMatch(/RUN npm install sharp/)
  })

  test('CI also installs via npm ci (with the lockfile-hash cache), not npm install', () => {
    const workflow = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8')
    const installLines = workflow.match(/run: npm (ci|install) --no-audit --no-fund/g) ?? []
    expect(installLines.length).toBeGreaterThan(0)
    expect(installLines.every((l) => l.includes('npm ci'))).toBe(true)
    expect(workflow).toMatch(/cache:\s*npm/)
  })
})
