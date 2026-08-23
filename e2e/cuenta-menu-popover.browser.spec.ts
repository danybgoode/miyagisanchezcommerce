import { expect, test } from '@playwright/test'

test('S3.3 · D15 — a closed native account popover is not visible before its trigger is pressed', async ({ page }) => {
  await page.setContent(`
    <style>.cuenta-menu-popover:popover-open { display: flex; }</style>
    <button type="button" popovertarget="cuenta-menu-test">Cuenta</button>
    <div id="cuenta-menu-test" popover="auto" class="cuenta-menu-popover">Menu</div>
  `)
  test.skip(!(await page.evaluate(() => 'showPopover' in HTMLElement.prototype)), 'browser lacks native Popover support')

  const menu = page.locator('#cuenta-menu-test')
  await expect(menu).not.toBeVisible()
  await page.getByRole('button', { name: 'Cuenta' }).click()
  await expect(menu).toBeVisible()
})
