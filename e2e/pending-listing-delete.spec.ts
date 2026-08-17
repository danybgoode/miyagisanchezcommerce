import { expect, test } from '@playwright/test'
import {
  EMPTY_PENDING_LISTING_DELETE,
  LISTING_DELETE_UNDO_MS,
  pendingListingDeleteReducer,
} from '../lib/pending-listing-delete'

test.describe('pending listing delete · delayed commit contract', () => {
  test('schedule → undo returns idle before any expiry event', () => {
    const waiting = pendingListingDeleteReducer(EMPTY_PENDING_LISTING_DELETE, {
      type: 'schedule', ids: ['prod_1'], label: 'Un anuncio',
    })
    expect(waiting).toMatchObject({ phase: 'waiting', ids: ['prod_1'] })
    expect(pendingListingDeleteReducer(waiting, { type: 'undo' })).toEqual(EMPTY_PENDING_LISTING_DELETE)
  })

  test('only expiry enters committing, and settle restores idle', () => {
    const waiting = pendingListingDeleteReducer(EMPTY_PENDING_LISTING_DELETE, {
      type: 'schedule', ids: ['prod_1', 'prod_2'], label: '2 anuncios',
    })
    const committing = pendingListingDeleteReducer(waiting, { type: 'expire' })
    expect(committing).toMatchObject({ phase: 'committing', ids: ['prod_1', 'prod_2'] })
    expect(pendingListingDeleteReducer(committing, { type: 'settle' })).toEqual(EMPTY_PENDING_LISTING_DELETE)
    expect(LISTING_DELETE_UNDO_MS).toBe(10_000)
  })

  test('a second schedule cannot replace an active escape window', () => {
    const waiting = pendingListingDeleteReducer(EMPTY_PENDING_LISTING_DELETE, {
      type: 'schedule', ids: ['prod_1'], label: 'Uno',
    })
    expect(pendingListingDeleteReducer(waiting, {
      type: 'schedule', ids: ['prod_2'], label: 'Dos',
    })).toBe(waiting)
  })
})
