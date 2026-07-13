import { test, expect } from '@playwright/test'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * nextpublic-docker-buildargs-hardening — locks in that the Cloud Run frontend
 * Docker build actually receives every NEXT_PUBLIC_* var as a build-arg.
 *
 * This is a fast-follow from two live prod bugs (home-dynamic-rows-restore-
 * and-polish S1, checkout-cloudrun-localhost-fallback-outage): Next.js inlines
 * NEXT_PUBLIC_* into the CLIENT bundle at `next build` time, but the Docker
 * build never received them as build-args — only Cloud Run RUNTIME env vars
 * (set by infra/gcp/deploy-frontend.sh, applied after the image already
 * exists) — so any 'use client' file reading one directly baked in
 * `undefined` permanently.
 *
 * REPO BOUNDARY NOTE: `infra/gcp/deploy-frontend.sh` lives in a SEPARATE,
 * independently-hosted repo (danybgoode/miyagi-product-management) from this
 * one — neither repo's CI can see the other's files (no cross-repo PAT was
 * taken on for this hardening task). This spec is therefore anchored to the
 * SAME explicit `NEXT_PUBLIC_VARS` list as
 * infra/gcp/test/frontend-build-args.test.js in that other repo (kept
 * identical by convention) — a residual manual-sync risk, but far smaller
 * than a guard that silently can't run at all across the boundary.
 *
 * Pure fs-read/regex checks, no browser/request fixture — runs in the `api`
 * project alongside cloudbuild-cache.spec.ts / dockerfile-lockfile.spec.ts.
 */

const ROOT = process.cwd()
const dockerfileFull = readFileSync(join(ROOT, 'Dockerfile'), 'utf8')
const cloudbuild = readFileSync(join(ROOT, 'cloudbuild.yaml'), 'utf8')

// MUST stay identical to the NEXT_PUBLIC_VARS array in the root repo's
// infra/gcp/test/frontend-build-args.test.js.
const NEXT_PUBLIC_VARS = [
  'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_MEDUSA_MXN_REGION_ID',
  'NEXT_PUBLIC_MP_PUBLIC_KEY',
  'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_VAPID_PUBLIC_KEY',
  'NEXT_PUBLIC_MEDUSA_STORE_URL',
  'NEXT_PUBLIC_SITE_URL',
  'NEXT_PUBLIC_CLERK_SIGN_IN_URL',
  'NEXT_PUBLIC_CLERK_SIGN_UP_URL',
  'NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL',
  'NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL',
]

const SUBSTITUTION_VARS = [
  'NEXT_PUBLIC_MEDUSA_STORE_URL',
  'NEXT_PUBLIC_SITE_URL',
  'NEXT_PUBLIC_CLERK_SIGN_IN_URL',
  'NEXT_PUBLIC_CLERK_SIGN_UP_URL',
  'NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL',
  'NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL',
]
const SECRET_VARS = NEXT_PUBLIC_VARS.filter((n) => !SUBSTITUTION_VARS.includes(n))

const dockerfileBuilderStage = dockerfileFull.slice(
  dockerfileFull.indexOf('AS builder'),
  dockerfileFull.indexOf('AS runner'),
)
const dockerfileRunnerStage = dockerfileFull.slice(dockerfileFull.indexOf('AS runner'))

test.describe('Dockerfile — NEXT_PUBLIC_* builder-stage ARG/ENV', () => {
  test('every NEXT_PUBLIC_* var is declared as a builder-stage ARG', () => {
    for (const name of NEXT_PUBLIC_VARS) {
      expect(dockerfileBuilderStage, `missing ARG ${name}`).toMatch(new RegExp(`^ARG ${name}$`, 'm'))
    }
  })

  test('every NEXT_PUBLIC_* ARG is ENV-exported (else `next build` cannot see it)', () => {
    for (const name of NEXT_PUBLIC_VARS) {
      expect(dockerfileBuilderStage, `missing ENV export for ${name}`).toMatch(
        new RegExp(`${name}=\\$${name}`),
      )
    }
  })

  test('no NEXT_PUBLIC_* var leaks into the runner stage', () => {
    for (const name of NEXT_PUBLIC_VARS) {
      expect(dockerfileRunnerStage, `${name} must not appear in the runner stage — it gets a real value at Cloud Run runtime`).not.toContain(name)
    }
  })
})

test.describe('cloudbuild.yaml — NEXT_PUBLIC_* build-args', () => {
  test('every NEXT_PUBLIC_* var is passed as a --build-arg', () => {
    for (const name of NEXT_PUBLIC_VARS) {
      expect(cloudbuild, `missing --build-arg ${name}`).toMatch(new RegExp(`--build-arg ${name}=`))
    }
  })

  test('the 6 default-bearing vars resolve from substitutions, not secrets', () => {
    for (const name of SUBSTITUTION_VARS) {
      expect(cloudbuild, `missing _${name}: under substitutions:`).toMatch(new RegExp(`_${name}:`))
      expect(cloudbuild, `${name} build-arg must reference the substitution`).toMatch(
        new RegExp(`--build-arg ${name}="\\$\\{_${name}\\}"`),
      )
    }
  })

  test('the 8 real-key vars resolve from Secret Manager secretEnv, not substitutions', () => {
    for (const name of SECRET_VARS) {
      expect(cloudbuild, `missing ${name} under secretEnv:`).toMatch(new RegExp(`^\\s*- ${name}\\s*$`, 'm'))
      expect(cloudbuild, `${name} build-arg must reference the secretEnv var`).toMatch(
        new RegExp(`--build-arg ${name}="\\$\\$${name}"`),
      )
    }
  })

  test('NEXT_PUBLIC_SUPABASE_URL reuses the existing SUPABASE_URL secret (not a duplicate)', () => {
    expect(cloudbuild).toMatch(
      /versionName:\s*projects\/\$PROJECT_ID\/secrets\/SUPABASE_URL\/versions\/latest\s*\n\s*env:\s*NEXT_PUBLIC_SUPABASE_URL/,
    )
  })

  test('the build-and-push step still ends with --push and the two image tags (unchanged by the secretEnv/bash conversion)', () => {
    expect(cloudbuild).toMatch(/--push/)
    expect(cloudbuild).toMatch(/-t \$\{_REGION\}-docker\.pkg\.dev\/\$PROJECT_ID\/\$\{_AR_REPO\}\/frontend:\$SHORT_SHA/)
    expect(cloudbuild).toMatch(/-t \$\{_REGION\}-docker\.pkg\.dev\/\$PROJECT_ID\/\$\{_AR_REPO\}\/frontend:latest/)
  })
})
