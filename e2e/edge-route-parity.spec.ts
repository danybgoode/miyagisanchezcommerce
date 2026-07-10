import { expect, test } from '@playwright/test'

// frontend-vercel-to-cloudrun Sprint 1, Story 1.1: /api/splash and /api/icon
// dropped `export const runtime = 'edge'` (Cloud Run has no edge runtime).
// Both routes only ever used next/og ImageResponse + NextRequest — nothing
// edge-exclusive — so this spec proves the Node-runtime output is still a
// valid, correctly-sized, deterministic PNG rather than diffing byte-for-byte
// against a now-nonexistent edge deployment.

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function readPngDimensions(buf: Buffer): { width: number; height: number } {
  // IHDR is always the first chunk: 8-byte signature, 4-byte length, 4-byte
  // "IHDR" type, then 4-byte width + 4-byte height (big-endian).
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  }
}

test.describe('edge→Node route parity (/api/splash, /api/icon)', () => {
  test('/api/splash returns a valid PNG at the default size', async ({ request }) => {
    const res = await request.get('/api/splash')
    expect(res.ok()).toBeTruthy()
    expect(res.headers()['content-type']).toContain('image/png')

    const buf = await res.body()
    expect(buf.subarray(0, 8)).toEqual(PNG_SIGNATURE)
    expect(readPngDimensions(buf)).toEqual({ width: 1170, height: 2532 })
  })

  test('/api/splash honors w/h query params', async ({ request }) => {
    const res = await request.get('/api/splash?w=500&h=900')
    expect(res.ok()).toBeTruthy()
    const buf = await res.body()
    expect(readPngDimensions(buf)).toEqual({ width: 500, height: 900 })
  })

  test('/api/splash renders deterministically under Node', async ({ request }) => {
    const [first, second] = await Promise.all([
      request.get('/api/splash?w=600&h=1200'),
      request.get('/api/splash?w=600&h=1200'),
    ])
    expect(first.ok()).toBeTruthy()
    expect(second.ok()).toBeTruthy()
    expect(await first.body()).toEqual(await second.body())
  })

  test('/api/icon returns a valid PNG at the default size', async ({ request }) => {
    const res = await request.get('/api/icon')
    expect(res.ok()).toBeTruthy()
    expect(res.headers()['content-type']).toContain('image/png')

    const buf = await res.body()
    expect(buf.subarray(0, 8)).toEqual(PNG_SIGNATURE)
    expect(readPngDimensions(buf)).toEqual({ width: 192, height: 192 })
  })

  test('/api/icon honors the size query param', async ({ request }) => {
    const res = await request.get('/api/icon?size=256')
    expect(res.ok()).toBeTruthy()
    const buf = await res.body()
    expect(readPngDimensions(buf)).toEqual({ width: 256, height: 256 })
  })

  test('/api/icon renders deterministically under Node', async ({ request }) => {
    const [first, second] = await Promise.all([
      request.get('/api/icon?size=300'),
      request.get('/api/icon?size=300'),
    ])
    expect(first.ok()).toBeTruthy()
    expect(second.ok()).toBeTruthy()
    expect(await first.body()).toEqual(await second.body())
  })
})
