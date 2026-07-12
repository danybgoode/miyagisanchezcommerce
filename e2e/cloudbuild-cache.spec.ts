import { test, expect } from '@playwright/test'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * Deploy-pipeline-tuning · Sprint 2 — locks in the buildx registry-cache
 * switch in cloudbuild.yaml, and guards the load-bearing image-only-deploy
 * contract against a future edit accidentally reintroducing full-deploy
 * semantics (env vars/secrets/scaling flags) into the CI deploy step.
 *
 * Mirrors the backend's cloudbuild-cache.unit.spec.ts (same reasoning: a
 * plain inline-cache method was tried first and measured — locally AND
 * against real Cloud Build — to cache almost nothing; switched to buildx
 * `--cache-to type=registry,...,mode=max`). This app's Dockerfile has a
 * cleaner single-`npm ci`-stage shape than the backend's, so the win here
 * is a full one — confirmed live against real Cloud Build (ad hoc `gcloud
 * builds submit`, throwaway tags, no deploy step): an identical
 * resubmission dropped from ~5 minutes to ~15 seconds with CACHED markers
 * on the deps stage.
 *
 * Pure fs-read/regex checks, no browser/request fixture — runs in the
 * `api` gate project alongside dockerfile-lockfile.spec.ts.
 *
 * See Roadmap/09-platform-infra/deploy-pipeline-tuning/sprint-2.md.
 */

const ROOT = process.cwd()
const cloudbuildFull = readFileSync(join(ROOT, 'cloudbuild.yaml'), 'utf8')
// Assertions about the ACTIVE config must not trip on the header comment's
// prose, which legitimately explains the rejected inline-cache approach.
const cloudbuild = cloudbuildFull.slice(cloudbuildFull.indexOf('\nsteps:'))
const preamble = cloudbuildFull.slice(0, cloudbuildFull.indexOf('\nsteps:'))

test.describe('cloudbuild.yaml — deploy-pipeline-tuning S2 self-check', () => {
  test('bootstraps a docker-container buildx builder (the classic docker driver cannot export cache)', () => {
    expect(cloudbuild).toMatch(/buildx\s*\n\s*-\s*create/)
    expect(cloudbuild).toMatch(/--driver\s*\n\s*-\s*docker-container/)
  })

  test('builds with buildx using a registry-backed mode=max cache (not the weaker inline-cache method)', () => {
    expect(cloudbuild).toMatch(/type=registry,ref=.*buildcache/)
    expect(cloudbuild).toMatch(/mode=max/)
    expect(cloudbuild).not.toMatch(/--build-arg/)
  })

  test('pushes directly via buildx build --push (not a separate docker push step)', () => {
    expect(cloudbuild).toMatch(/--push/)
    expect(cloudbuild).not.toMatch(/\n\s*-\s*push\s*\n\s*name:\s*gcr\.io\/cloud-builders\/docker/)
  })

  test('has no top-level images: list (buildx --push already pushes both tags)', () => {
    expect(cloudbuild).not.toMatch(/^images:/m)
  })

  test('the preamble comment still points to the reasoning for the cache mechanism chosen', () => {
    expect(preamble).toMatch(/inline cache/)
    expect(preamble).toMatch(/buildx/)
  })

  test('the deploy step remains image-only — no env/secrets/scaling flags reintroduced into CI', () => {
    const deployStepMatch = cloudbuild.match(/- id: deploy[\s\S]*$/)
    expect(deployStepMatch).toBeTruthy()
    const deployStep = deployStepMatch![0]
    expect(deployStep).toMatch(/--image=/)
    expect(deployStep).not.toMatch(/--set-env-vars/)
    expect(deployStep).not.toMatch(/--set-secrets/)
    expect(deployStep).not.toMatch(/--min-instances/)
    expect(deployStep).not.toMatch(/--max-instances/)
    expect(deployStep).not.toMatch(/--concurrency/)
  })

  test('still deploys to the same service/region substitutions as before', () => {
    expect(cloudbuildFull).toMatch(/_SERVICE:\s*miyagi-web/)
    expect(cloudbuildFull).toMatch(/_REGION:\s*us-east4/)
  })
})
