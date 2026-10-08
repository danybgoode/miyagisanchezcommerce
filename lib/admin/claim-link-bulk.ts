import { mapWithConcurrency } from './tenant-directory'

export type ClaimLinkShopInput = { shopSlug: string; market: 'mx' | 'us' }

/** One stale seller must not turn the whole outreach batch into a partial success. */
export async function prepareClaimLinkBatch<T extends ClaimLinkShopInput, R>(
  shops: readonly T[],
  prepare: (shop: T) => Promise<R>,
  describeFailure: (error: unknown) => string,
): Promise<{ results: R[]; failures: Array<T & { error: string }> }> {
  const outcomes = await mapWithConcurrency(shops, 8, async (shop) => {
    try { return { result: await prepare(shop), failure: null } }
    catch (error) { return { result: null, failure: { ...shop, error: describeFailure(error) } } }
  })
  return {
    results: outcomes.flatMap(({ result }) => result === null ? [] : [result]),
    failures: outcomes.flatMap(({ failure }) => failure === null ? [] : [failure]),
  }
}
