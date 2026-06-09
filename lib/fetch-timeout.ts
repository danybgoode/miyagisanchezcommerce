/**
 * raceWithTimeout — the pure, next-free timeout seam for Sprint 3 (S3.3).
 *
 * The buyer's shipping quote is a `fetch('/api/checkout/shipping-rates')` that
 * proxies to the backend, which calls every carrier with no timeout of its own.
 * A single hung carrier makes "Cotizando…" spin forever. Wrapping the fetch in
 * `raceWithTimeout` guarantees the spinner resolves within a bound; on timeout the
 * checkout surfaces the S3.2 coordinated fallback instead of hanging.
 *
 * Kept free of any `next/*` import so the Playwright `api` runner can unit-test it.
 * The caller still aborts its own AbortController on timeout to cancel the request.
 */

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Timed out after ${ms}ms`)
    this.name = 'TimeoutError'
  }
}

export function isTimeoutError(err: unknown): err is TimeoutError {
  return err instanceof TimeoutError || (err instanceof Error && err.name === 'TimeoutError')
}

/**
 * Resolve with `promise`'s value, or reject with a `TimeoutError` after `ms`.
 * The timer is cleared as soon as the promise settles either way (no leak).
 */
export function raceWithTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(ms)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>
}
