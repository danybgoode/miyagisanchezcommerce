import { expect, test } from '@playwright/test'
import { authEnabled, requireEnv, sellerEmail, signIn } from './_helpers/auth'

/**
 * Credentialed seller smoke for the rendered preview → cancel → apply ledger.
 * The route responses are intercepted so the test never mutates a real order;
 * the server-rendered inbox still comes from the seller fixture and therefore
 * proves the interaction is wired into the real page rather than a test harness.
 */
test.describe('seller orders · staged bulk status (browser)', () => {
  test('cancel writes nothing; apply reports advanced and skipped rows', async ({ page }) => {
    test.skip(!authEnabled(), 'Set MS_TEST_BROWSER_AUTH=1 (+ dev Clerk keys) to run this seller smoke.')
    const email = requireEnv(sellerEmail(), 'MS_TEST_SELLER_EMAIL')
    let patchCalls = 0

    await page.route('**/api/orders/bulk-status', async (route) => {
      const request = route.request()
      const body = request.postDataJSON() as { order_ids: string[]; status: string }
      if (request.method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            plans: [
              { order_id: body.order_ids[0], title: 'Pedido listo', current_status: 'paid', proposed_status: body.status, eligible: true, reason: null },
              { order_id: body.order_ids[1], title: 'Pedido por corregir', current_status: 'pending_payment', proposed_status: body.status, eligible: false, reason: 'Aún no confirmas el pago de este pedido.' },
            ],
          }),
        })
        return
      }

      patchCalls += 1
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          advanced: [body.order_ids[0]],
          skipped: [{ order_id: body.order_ids[1], reason: 'Aún no confirmas el pago de este pedido.' }],
        }),
      })
    })

    await signIn(page, email)
    await page.goto('/shop/manage/orders')
    const choices = page.getByRole('checkbox', { name: /Seleccionar pedido/ })
    test.skip(await choices.count() < 2, 'MS_TEST_SELLER_EMAIL needs at least two visible orders for the mixed-row smoke.')
    await choices.nth(0).check()
    await choices.nth(1).check()

    await page.getByRole('button', { name: 'Enviado' }).click()
    const preview = page.getByRole('dialog', { name: 'Revisa el cambio de estado' })
    await expect(preview.getByText('Pedido listo')).toBeVisible()
    await expect(preview.getByText('Pedido por corregir')).toBeVisible()
    await expect(preview.getByText('Listo', { exact: true })).toBeVisible()
    await expect(preview.getByText('Sin cambio', { exact: true })).toBeVisible()
    await preview.getByRole('button', { name: 'Cancelar' }).click()
    expect(patchCalls).toBe(0)

    await page.getByRole('button', { name: 'Enviado' }).click()
    await page.getByRole('button', { name: 'Aplicar 1 cambio' }).click()
    await expect(page.getByRole('region', { name: 'Resultado del cambio en bloque' }).getByText('Pedido listo')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Resultado del cambio en bloque' }).getByText('Pedido por corregir')).toBeVisible()
    expect(patchCalls).toBe(1)
    await expect(choices.nth(0)).not.toBeChecked()
    await expect(choices.nth(1)).toBeChecked()
  })
})
