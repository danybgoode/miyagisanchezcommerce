import { test, expect } from '@playwright/test'
import { raceWithTimeout, isTimeoutError, TimeoutError } from '../lib/fetch-timeout'

test.describe('fetch-timeout · raceWithTimeout (S3.3)', () => {
  test('rejects with a TimeoutError when the promise never settles in time', async () => {
    const never = new Promise<string>(() => {}) // never resolves
    const err = await raceWithTimeout(never, 50).then(() => null, e => e)
    expect(isTimeoutError(err)).toBe(true)
    expect(err).toBeInstanceOf(TimeoutError)
  })

  test('resolves untouched when the promise beats the timeout', async () => {
    const fast = new Promise<string>(resolve => setTimeout(() => resolve('rates'), 10))
    await expect(raceWithTimeout(fast, 1_000)).resolves.toBe('rates')
  })

  test('propagates the original rejection (not a timeout) when the promise fails fast', async () => {
    const boom = Promise.reject(new Error('carrier exploded'))
    const err = await raceWithTimeout(boom, 1_000).then(() => null, e => e)
    expect(isTimeoutError(err)).toBe(false)
    expect((err as Error).message).toBe('carrier exploded')
  })

  test('isTimeoutError discriminates a TimeoutError from a generic error', () => {
    expect(isTimeoutError(new TimeoutError(9_000))).toBe(true)
    expect(isTimeoutError(new Error('AbortError'))).toBe(false)
    expect(isTimeoutError(null)).toBe(false)
  })
})
