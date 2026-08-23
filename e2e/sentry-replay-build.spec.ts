import { expect, test } from '@playwright/test'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const candidate = path.join(dir, entry.name)
    return entry.isDirectory() ? walk(candidate) : [candidate]
  })
}

test('S3.1 · D13 — built client chunks exclude Sentry Replay while the client SDK remains configured', () => {
  const sentry = readFileSync('sentry.client.config.ts', 'utf8')
  expect(sentry).toContain('Sentry.init')
  expect(sentry).toContain('tracesSampleRate')
  expect(sentry).not.toContain('replayIntegration')
  expect(sentry).not.toContain('replaysSessionSampleRate')
  expect(sentry).not.toContain('replaysOnErrorSampleRate')

  const chunksDir = path.join('.next', 'static', 'chunks')
  const chunks = walk(chunksDir).filter((file) => file.endsWith('.js'))
  expect(chunks.length, 'UNAVAILABLE — no built client chunks').toBeGreaterThan(0)
  const replayChunks = chunks.filter((file) => /replayIntegration|replaysSessionSampleRate/.test(readFileSync(file, 'utf8')))
  expect(replayChunks).toEqual([])
})
